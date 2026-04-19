import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    // API Gateway sometimes delivers cognito:groups as "[g1 g2]".
    return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  }
  return [];
};

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sub: claims.sub,
      email: claims.email,
      groups: parseGroups(claims['cognito:groups']),
      tokenUse: claims.token_use,
    }),
  };
};
