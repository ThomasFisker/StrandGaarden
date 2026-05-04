import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { json, requireAdmin, USER_PK_PREFIX } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;
const tableName = process.env.TABLE_NAME!;

const cognito = new CognitoIdentityProviderClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const attrOf = (u: UserType, name: string): string | undefined =>
  u.Attributes?.find((a) => a.Name === name)?.Value;

interface UserRowExtras {
  houseNumber: number | null;
  gdprAcceptedAt: string | null;
  gdprAcceptedVersion: string | null;
}

const loadUserExtras = async (): Promise<Map<string, UserRowExtras>> => {
  const map = new Map<string, UserRowExtras>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :sk',
        ExpressionAttributeValues: { ':pfx': USER_PK_PREFIX, ':sk': 'META' },
        ExclusiveStartKey,
      }),
    );
    for (const it of r.Items ?? []) {
      const pk = String(it.PK ?? '');
      const sub = pk.startsWith(USER_PK_PREFIX) ? pk.slice(USER_PK_PREFIX.length) : '';
      if (!sub) continue;
      map.set(sub, {
        houseNumber:
          typeof it.houseNumber === 'number' ? it.houseNumber : null,
        gdprAcceptedAt:
          typeof it.gdprAcceptedAt === 'string' ? it.gdprAcceptedAt : null,
        gdprAcceptedVersion:
          typeof it.gdprAcceptedVersion === 'string' ? it.gdprAcceptedVersion : null,
      });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return map;
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  const all: UserType[] = [];
  let PaginationToken: string | undefined;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken }));
    for (const u of r.Users ?? []) all.push(u);
    PaginationToken = r.PaginationToken;
  } while (PaginationToken);

  const extras = await loadUserExtras();

  const items = await Promise.all(
    all.map(async (u) => {
      const username = u.Username ?? '';
      const sub = attrOf(u, 'sub') ?? '';
      const g = await cognito.send(
        new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
      );
      const extra = sub ? extras.get(sub) : undefined;
      return {
        username,
        sub,
        email: attrOf(u, 'email') ?? '',
        loginName: attrOf(u, 'preferred_username') ?? '',
        status: u.UserStatus ?? '',
        enabled: u.Enabled === true,
        createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : null,
        groups: (g.Groups ?? []).map((x) => x.GroupName ?? '').filter(Boolean),
        houseNumber: extra?.houseNumber ?? null,
        gdprAcceptedAt: extra?.gdprAcceptedAt ?? null,
        gdprAcceptedVersion: extra?.gdprAcceptedVersion ?? null,
      };
    }),
  );

  items.sort((a, b) => a.email.localeCompare(b.email, 'da'));
  return json(200, { items });
};
