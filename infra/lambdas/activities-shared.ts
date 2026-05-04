export const ACTIVITYLIST_PK = 'ACTIVITYLIST';
export const ACTIVITY_SK_PREFIX = 'ACTIVITY#';

export interface ActivityRow {
  key: string;
  displayName: string;
  displayOrder: number;
  createdAt: string | null;
  createdBy: string | null;
}
