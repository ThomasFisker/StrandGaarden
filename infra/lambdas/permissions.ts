import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/**
 * Single source of truth for the 5 logical roles.
 *
 * Cognito group name on the left, Danish UI label on the right. The
 * Cognito group `admin` is intentionally kept under that name — the
 * destructive migration cost of renaming an existing group isn't
 * justified. The UI labels it "Udvalg".
 *
 * No Lambda outside this module should reference the literal group
 * strings — go through the predicates below instead.
 */
export const GROUP_VIEWER = 'viewer' as const;
export const GROUP_MEMBER = 'member' as const;
export const GROUP_UDVALG = 'admin' as const;
export const GROUP_BOARD = 'board' as const;
export const GROUP_ADMINISTRATOR = 'administrator' as const;

export const ALL_GROUPS = [
  GROUP_VIEWER,
  GROUP_MEMBER,
  GROUP_UDVALG,
  GROUP_BOARD,
  GROUP_ADMINISTRATOR,
] as const;
export type CognitoGroup = (typeof ALL_GROUPS)[number];

export const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

export const callerGroups = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] =>
  parseGroups(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']);

const has = (event: APIGatewayProxyEventV2WithJWTAuthorizer, group: CognitoGroup): boolean =>
  callerGroups(event).includes(group);

// Group membership predicates
export const isViewer = (e: APIGatewayProxyEventV2WithJWTAuthorizer) => has(e, GROUP_VIEWER);
export const isMember = (e: APIGatewayProxyEventV2WithJWTAuthorizer) => has(e, GROUP_MEMBER);
export const isUdvalg = (e: APIGatewayProxyEventV2WithJWTAuthorizer) => has(e, GROUP_UDVALG);
export const isBoard = (e: APIGatewayProxyEventV2WithJWTAuthorizer) => has(e, GROUP_BOARD);
export const isAdministrator = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  has(e, GROUP_ADMINISTRATOR);

/** True if the caller belongs to at least one of the given groups. */
export const isAny = (e: APIGatewayProxyEventV2WithJWTAuthorizer, groups: CognitoGroup[]): boolean => {
  const cg = callerGroups(e);
  return groups.some((g) => cg.includes(g));
};

/**
 * Backward-compat alias used by photo-admin Lambdas (review, photos-*,
 * persons-*, activities-*, config-*). After the role split, both
 * Udvalg (Cognito group `admin`) and Administrator have photo-admin
 * powers — administrator is a superset role. Same behaviour as
 * `canManagePhotos`; prefer that name in new code.
 */
export const isAdmin = (e: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  isAny(e, [GROUP_UDVALG, GROUP_ADMINISTRATOR]);

// Capability predicates — what each role is allowed to DO. These are
// the only checks Lambdas outside this module should call.
//
// Multi-group users get the union of their groups' capabilities; the
// "highest permission wins" rule falls out for free.
export const canViewPhotos = (_e: APIGatewayProxyEventV2WithJWTAuthorizer) => true; // any authed user
export const canUploadPhotos = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAny(e, [GROUP_MEMBER, GROUP_UDVALG, GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManagePhotos = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAny(e, [GROUP_UDVALG, GROUP_ADMINISTRATOR]);
export const canViewDocs = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAny(e, [GROUP_MEMBER, GROUP_UDVALG, GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageDocs = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAny(e, [GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageUsers = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAny(e, [GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageSystemConfig = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  isAdministrator(e);

/**
 * Effective single role for display. Highest privilege wins. Returns
 * null when the caller is in none of our groups (shouldn't happen
 * for authed users but guard anyway).
 */
export const effectiveRole = (groups: string[]): CognitoGroup | null => {
  if (groups.includes(GROUP_ADMINISTRATOR)) return GROUP_ADMINISTRATOR;
  if (groups.includes(GROUP_BOARD)) return GROUP_BOARD;
  if (groups.includes(GROUP_UDVALG)) return GROUP_UDVALG;
  if (groups.includes(GROUP_MEMBER)) return GROUP_MEMBER;
  if (groups.includes(GROUP_VIEWER)) return GROUP_VIEWER;
  return null;
};
