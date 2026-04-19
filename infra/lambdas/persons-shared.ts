import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

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

const parseGroups = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  return [];
};

export const callerGroups = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string[] =>
  parseGroups(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']);

export const isAdmin = (event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean =>
  callerGroups(event).includes('admin');

const DANISH_MAP: Record<string, string> = {
  æ: 'ae', ø: 'oe', å: 'aa',
  Æ: 'ae', Ø: 'oe', Å: 'aa',
  ä: 'ae', ö: 'oe', ü: 'ue',
  Ä: 'ae', Ö: 'oe', Ü: 'ue',
  é: 'e', è: 'e', ê: 'e',
};

export const slugify = (input: string): string => {
  const mapped = [...input].map((c) => DANISH_MAP[c] ?? c).join('');
  const ascii = mapped
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
};

export const PERSON_SK_PREFIX = 'PERSON#';
export const PERSONLIST_PK = 'PERSONLIST';

export const normalizeDisplayName = (raw: string): string =>
  raw.replace(/\s+/g, ' ').trim();
