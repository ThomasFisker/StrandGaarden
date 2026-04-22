import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { json, requireAdmin } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region });

const attrOf = (u: UserType, name: string): string | undefined =>
  u.Attributes?.find((a) => a.Name === name)?.Value;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  const all: UserType[] = [];
  let PaginationToken: string | undefined;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken }));
    for (const u of r.Users ?? []) all.push(u);
    PaginationToken = r.PaginationToken;
  } while (PaginationToken);

  const items = await Promise.all(
    all.map(async (u) => {
      const username = u.Username ?? '';
      const g = await cognito.send(
        new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
      );
      return {
        username,
        sub: attrOf(u, 'sub') ?? '',
        email: attrOf(u, 'email') ?? '',
        loginName: attrOf(u, 'preferred_username') ?? '',
        status: u.UserStatus ?? '',
        enabled: u.Enabled === true,
        createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : null,
        groups: (g.Groups ?? []).map((x) => x.GroupName ?? '').filter(Boolean),
      };
    }),
  );

  items.sort((a, b) => a.email.localeCompare(b.email, 'da'));
  return json(200, { items });
};
