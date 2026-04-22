import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InvalidPasswordException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { json, requireAdmin } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region });

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

  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8) {
    return json(400, { error: 'newPassword must be at least 8 characters' });
  }

  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: newPassword,
        Permanent: true,
      }),
    );
  } catch (err) {
    if (err instanceof UserNotFoundException) return json(404, { error: 'Brugeren findes ikke' });
    if (err instanceof InvalidPasswordException) {
      return json(400, { error: 'Adgangskoden opfylder ikke kravene (mindst 8 tegn)' });
    }
    throw err;
  }

  return json(200, { username });
};
