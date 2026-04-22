import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { json, requireAdmin } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region });

const LOGIN_NAME_RE = /^[A-Za-zÆØÅæøå0-9 ._-]{2,30}$/;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  const username = event.pathParameters?.username;
  if (!username) return json(400, { error: 'Missing username' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const loginName = typeof body.loginName === 'string' ? body.loginName.trim() : '';
  if (!loginName || !LOGIN_NAME_RE.test(loginName)) {
    return json(400, { error: 'loginName must be 2–30 chars (letters, digits, space, . _ -)' });
  }

  try {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [{ Name: 'preferred_username', Value: loginName }],
      }),
    );
  } catch (err) {
    if (err instanceof UserNotFoundException) return json(404, { error: 'Brugeren findes ikke' });
    throw err;
  }

  return json(200, { username, loginName });
};
