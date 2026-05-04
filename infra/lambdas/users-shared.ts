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

/** Valid Strandgaarden house numbers — odd-numbered houses 3..17 plus
 * even-numbered houses 4..32. The set is fixed by the physical layout
 * of the club; numbers are NOT contiguous (no house 1, 2, 19, 21, etc.).
 * Order here is the canonical UI display order: odds first, then evens.
 *
 * Must stay in sync with `HOUSES` in packages/web/src/types.ts. */
export const VALID_HOUSES: readonly number[] = [
  3, 5, 7, 9, 11, 13, 15, 17,
  4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
];
const VALID_HOUSE_SET: ReadonlySet<number> = new Set(VALID_HOUSES);
export const isValidHouse = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && VALID_HOUSE_SET.has(n);

export const userPk = (sub: string): string => `${USER_PK_PREFIX}${sub}`;

/** Per-house text row keys (one short paragraph per house, used as a
 * chapter intro in the jubilee book). PK = HOUSETEXT#<n>, SK = META. */
export const HOUSETEXT_PK_PREFIX = 'HOUSETEXT#';
export const HOUSETEXT_SK = 'META';
export const houseTextPk = (n: number): string => `${HOUSETEXT_PK_PREFIX}${n}`;
