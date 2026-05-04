import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  isValidHouse,
  json,
  requireAdmin,
  userPk,
  USER_SK,
} from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;
const tableName = process.env.TABLE_NAME!;

const cognito = new CognitoIdentityProviderClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

interface Body {
  houseNumber?: unknown;
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  const username = event.pathParameters?.username;
  if (!username) return json(400, { error: 'Missing username' });

  let body: Body;
  try {
    body = JSON.parse(event.body ?? '{}') as Body;
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  let houseNumber: number | null;
  if (body.houseNumber === null || body.houseNumber === undefined || body.houseNumber === '') {
    houseNumber = null;
  } else {
    const n = Number(body.houseNumber);
    if (!isValidHouse(n)) {
      return json(400, { error: 'houseNumber must be a valid Strandgaarden house number, or null to clear' });
    }
    houseNumber = n;
  }

  // Resolve sub from username (email). The /users/{username}/* convention
  // uses email as the route key; the USER row keys on the immutable sub.
  let sub: string | null = null;
  let email: string | null = null;
  let loginName: string | null = null;
  try {
    const r = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    for (const a of r.UserAttributes ?? []) {
      if (a.Name === 'sub') sub = a.Value ?? null;
      if (a.Name === 'email') email = a.Value ?? null;
      if (a.Name === 'preferred_username') loginName = a.Value ?? null;
    }
  } catch (err) {
    if (err instanceof UserNotFoundException) return json(404, { error: 'Bruger ikke fundet' });
    throw err;
  }
  if (!sub) return json(500, { error: 'User has no sub attribute' });

  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const editorSub = typeof claims.sub === 'string' ? claims.sub : '';
  const editorEmail = typeof claims.email === 'string' ? claims.email : '';
  const at = new Date().toISOString();

  // Upsert. Initial fields written on first set; subsequent updates only
  // touch houseNumber + last-edited stamps. Email/loginName are kept on the
  // row as a denormalized convenience for admin views.
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: userPk(sub), SK: USER_SK },
      UpdateExpression:
        'SET entity = if_not_exists(entity, :ent), createdAt = if_not_exists(createdAt, :at), ' +
        '#hn = :hn, lastEditedAt = :at, lastEditedBy = :by, lastEditedByEmail = :byE, ' +
        'email = :em, loginName = :ln',
      ExpressionAttributeNames: { '#hn': 'houseNumber' },
      ExpressionAttributeValues: {
        ':ent': 'User',
        ':at': at,
        ':hn': houseNumber,
        ':by': editorSub,
        ':byE': editorEmail,
        ':em': email,
        ':ln': loginName,
      },
    }),
  );

  return json(200, { username, sub, houseNumber });
};
