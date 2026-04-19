import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { json, jsonNoContent, requireAdmin } from './users-shared';

const region = process.env.AWS_REGION ?? 'eu-west-1';
const userPoolId = process.env.USER_POOL_ID!;

const cognito = new CognitoIdentityProviderClient({ region });

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  if (!requireAdmin(event)) return json(403, { error: 'Admin only' });

  const username = event.pathParameters?.username;
  if (!username) return json(400, { error: 'Missing username' });

  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const callerSub = typeof claims.sub === 'string' ? claims.sub : null;
  const callerEmail = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;

  // Resolve the target user's sub so we can compare with the caller regardless
  // of whether the URL path carries the sub or the email.
  try {
    const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    const targetSub = got.UserAttributes?.find((a) => a.Name === 'sub')?.Value ?? '';
    const targetEmail = got.UserAttributes?.find((a) => a.Name === 'email')?.Value?.toLowerCase() ?? '';
    if ((callerSub && callerSub === targetSub) || (callerEmail && callerEmail === targetEmail)) {
      return json(400, { error: 'Du kan ikke slette din egen bruger' });
    }
  } catch (err) {
    if (err instanceof UserNotFoundException) return json(404, { error: 'Brugeren findes ikke' });
    throw err;
  }

  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
  } catch (err) {
    if (err instanceof UserNotFoundException) return json(404, { error: 'Brugeren findes ikke' });
    throw err;
  }
  return jsonNoContent(204);
};
