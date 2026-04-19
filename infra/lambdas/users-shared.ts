import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export const ALLOWED_GROUPS = ['admin', 'member', 'viewer'] as const;
export type AllowedGroup = (typeof ALLOWED_GROUPS)[number];

export const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const jsonNoContent = (statusCode: number) => ({
  statusCode,
  headers: {},
  body: '',
});

export const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

export const requireAdmin = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean => {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const groups = parseGroups(claims['cognito:groups']);
  return groups.includes('admin');
};
