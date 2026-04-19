import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ALLOWED_GROUPS, json, requireAdmin, type AllowedGroup } from './users-shared';

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

  const target = body.group as string;
  if (!ALLOWED_GROUPS.includes(target as AllowedGroup)) {
    return json(400, { error: `group must be one of: ${ALLOWED_GROUPS.join(', ')}` });
  }

  try {
    const existing = await cognito.send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    const current = (existing.Groups ?? []).map((g) => g.GroupName ?? '').filter(Boolean);

    for (const g of current) {
      if (g !== target) {
        await cognito.send(
          new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: g }),
        );
      }
    }
    if (!current.includes(target)) {
      await cognito.send(
        new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: target }),
      );
    }
  } catch (err) {
    if (err instanceof UserNotFoundException) {
      return json(404, { error: 'Brugeren findes ikke' });
    }
    throw err;
  }

  return json(200, { username, group: target });
};
