import type { Claims } from './auth';

/**
 * Mirror of `infra/lambdas/permissions.ts`. Single source of truth on
 * the SPA side for what each role is allowed to do. UI gating (menu
 * items, route gates, button visibility) goes through these predicates.
 *
 * No SPA file outside this module should reference the literal Cognito
 * group strings ('admin', 'board', 'administrator', etc.).
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

const groupsOf = (claimsOrGroups: Claims | string[] | undefined | null): string[] => {
  if (!claimsOrGroups) return [];
  if (Array.isArray(claimsOrGroups)) return claimsOrGroups;
  return claimsOrGroups.groups ?? [];
};

const has = (cog: Claims | string[] | undefined | null, group: CognitoGroup): boolean =>
  groupsOf(cog).includes(group);

// Group membership predicates
export const isViewer = (c: Claims | string[] | undefined | null) => has(c, GROUP_VIEWER);
export const isMember = (c: Claims | string[] | undefined | null) => has(c, GROUP_MEMBER);
export const isUdvalg = (c: Claims | string[] | undefined | null) => has(c, GROUP_UDVALG);
export const isBoard = (c: Claims | string[] | undefined | null) => has(c, GROUP_BOARD);
export const isAdministrator = (c: Claims | string[] | undefined | null) =>
  has(c, GROUP_ADMINISTRATOR);

/** True if the caller belongs to at least one of the given groups. */
export const isAny = (c: Claims | string[] | undefined | null, groups: CognitoGroup[]): boolean => {
  const g = groupsOf(c);
  return groups.some((x) => g.includes(x));
};

// Capability predicates — what each role is allowed to DO. These are
// the only checks the SPA outside this module should call. Multi-group
// users get the union, so "highest permission wins" falls out for free.
export const canViewPhotos = (_c: Claims | string[] | undefined | null) => true;
export const canUploadPhotos = (c: Claims | string[] | undefined | null) =>
  isAny(c, [GROUP_MEMBER, GROUP_UDVALG, GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManagePhotos = (c: Claims | string[] | undefined | null) =>
  isAny(c, [GROUP_UDVALG, GROUP_ADMINISTRATOR]);
export const canViewDocs = (c: Claims | string[] | undefined | null) =>
  isAny(c, [GROUP_MEMBER, GROUP_UDVALG, GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageDocs = (c: Claims | string[] | undefined | null) =>
  isAny(c, [GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageUsers = (c: Claims | string[] | undefined | null) =>
  isAny(c, [GROUP_BOARD, GROUP_ADMINISTRATOR]);
export const canManageSystemConfig = (c: Claims | string[] | undefined | null) =>
  isAdministrator(c);

/**
 * Effective single role for display. Highest privilege wins. Returns
 * null when the caller is in none of our groups.
 */
export const effectiveRole = (
  claimsOrGroups: Claims | string[] | undefined | null,
): CognitoGroup | null => {
  const g = groupsOf(claimsOrGroups);
  if (g.includes(GROUP_ADMINISTRATOR)) return GROUP_ADMINISTRATOR;
  if (g.includes(GROUP_BOARD)) return GROUP_BOARD;
  if (g.includes(GROUP_UDVALG)) return GROUP_UDVALG;
  if (g.includes(GROUP_MEMBER)) return GROUP_MEMBER;
  if (g.includes(GROUP_VIEWER)) return GROUP_VIEWER;
  return null;
};

/** Danish UI labels for the 5 roles. */
export const ROLE_LABEL: Record<CognitoGroup, string> = {
  [GROUP_VIEWER]: 'Kigger',
  [GROUP_MEMBER]: 'Medlem',
  [GROUP_UDVALG]: 'Udvalg',
  [GROUP_BOARD]: 'Bestyrelse',
  [GROUP_ADMINISTRATOR]: 'Administrator',
};
