import type { DateRange } from '../types';

export const tenantTimezone = 'America/New_York';
export const tenantTimezoneLabel = 'America/New_York (Eastern Time)';

export const requiredScopes = [
  'OR.Execution.Read',
  'OR.Folders.Read',
  'OR.Jobs.Read',
  'OR.License.Read',
  'OR.Machines.Read',
  'OR.Robots.Read',
  'OR.Settings.Read',
  'OR.Users.Read',
];

export const requiredScopeText = requiredScopes.join(' ');

export const odataPageSize = 100;
export const defaultApiLookbackDays = 30;
export const defaultDateRange: DateRange = 'last-month';
export const maxScopedFolders = 50;

export const connectionStorageKey = 'runtime-capacity-connections-v1';
export const selectedConnectionStorageKey = 'runtime-capacity-selected-connection-v1';
export const liveSessionStorageKey = 'runtime-capacity-live-session-v1';
export const heatmapCacheSessionStorageKey = 'runtime-capacity-heatmap-cache-v1';

export const dateRanges: Array<{ value: DateRange; label: string }> = [
  { value: 'last-day', label: 'Last day' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-month', label: 'Last 30 days' },
  { value: 'last-quarter', label: 'Last quarter' },
];

export const weekdayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
