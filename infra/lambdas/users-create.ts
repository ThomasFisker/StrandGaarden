import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ALLOWED_GROUPS, json, requireAdmin, type AllowedGroup } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Request body must be valid JSON' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const group = body.group as string;
  const initialPassword = typeof body.initialPassword === 'string' ? body.initialPassword : '';

  const errors: string[] = [];
  if (!email || !EMAIL_RE.test(email)) errors.push('Valid email required');
  if (!ALLOWED_GROUPS.includes(group as AllowedGroup)) errors.push(`group must be one of: ${ALLOWED_GROUPS.join(', ')}`);
  if (initialPassword.length < 8) errors.push('initialPassword must be at least 8 characters');
  if (errors.length) return json(400, { error: 'Validation failed', details: errors });

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }),
    );
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      return json(409, { error: 'En bruger med denne e-mail findes allerede' });
    }
    throw err;
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: email,
      Password: initialPassword,
      Permanent: true,
    }),
  );

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: group,
    }),
  );

  return json(201, { username: email, email, group });
};
