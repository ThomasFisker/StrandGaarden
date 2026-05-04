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

/** Per-user metadata row in the single DynamoDB table.
 *
 * PK = `USER#<sub>` (Cognito sub UUID, immutable across email/loginName changes)
 * SK = `META`
 *
 * Holds platform-side state that doesn't belong in Cognito attributes:
 * - houseNumber (1..23 or null) — assigned by admin, used to auto-fill the
 *   uploader's house in Stage 1 + Stage 3 forms.
 * - gdprAcceptedAt / gdprAcceptedVersion — first-login consent timestamp.
 *   (Phase 1; not yet wired.)
 */
export const USER_PK_PREFIX = 'USER#';
export const USER_SK = 'META';
export const HOUSE_MIN = 1;
export const HOUSE_MAX = 23;

export const userPk = (sub: string): string => `${USER_PK_PREFIX}${sub}`;

/** Per-house text row keys (one short paragraph per house, used as a
 * chapter intro in the jubilee book). PK = HOUSETEXT#<n>, SK = META. */
export const HOUSETEXT_PK_PREFIX = 'HOUSETEXT#';
export const HOUSETEXT_SK = 'META';
export const houseTextPk = (n: number): string => `${HOUSETEXT_PK_PREFIX}${n}`;
