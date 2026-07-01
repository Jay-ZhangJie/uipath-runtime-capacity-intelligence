import type { MachineTemplate, RuntimeBucket, ScheduleRisk } from '../types';

export const tenants = ['Enterprise Tenant', 'Finance Prod', 'Shared Services'];

export const folders = ['All permitted folders', 'Finance', 'Supply Chain', 'Customer Operations', 'Shared Services'];

export const machineTemplates: MachineTemplate[] = [
  {
    id: 'mt-prod-windows',
    name: 'MT-Prod-Windows',
    folders: ['Finance', 'Shared Services'],
    configuredRuntimes: 10,
    effectiveRuntimes: 8,
    onlineHosts: 5,
    totalHosts: 6,
    runtimeType: 'Unattended',
  },
  {
    id: 'mt-backoffice-highdensity',
    name: 'MT-BackOffice-HighDensity',
    folders: ['Supply Chain'],
    configuredRuntimes: 6,
    effectiveRuntimes: 6,
    onlineHosts: 3,
    totalHosts: 3,
    runtimeType: 'Unattended',
  },
  {
    id: 'mt-monthend-burst',
    name: 'MT-MonthEnd-Burst',
    folders: ['Finance'],
    configuredRuntimes: 2,
    effectiveRuntimes: 2,
    onlineHosts: 1,
    totalHosts: 1,
    runtimeType: 'Unattended',
  },
];

const hours = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const dayRows = [
  ['Mon', 31, 28, 63, 71, 89, 76, 48, 42, 68, 87, 70, 38],
  ['Tue', 24, 35, 64, 91, 116, 96, 73, 52, 67, 88, 74, 46],
  ['Wed', 22, 26, 44, 72, 85, 69, 51, 46, 62, 79, 55, 34],
  ['Thu', 30, 32, 60, 78, 90, 86, 70, 49, 75, 93, 82, 41],
  ['Fri', 27, 29, 61, 84, 94, 80, 58, 65, 92, 121, 109, 76],
] as const;

export const runtimeBuckets: RuntimeBucket[] = dayRows.flatMap(([day, ...values]) =>
  values.map((value, index) => ({
    day,
    hour: hours[index],
    observedDemand: Math.round((value / 100) * 18),
    projectedDemand: Math.round((value / 100) * 18),
    capacity: 18,
    topDrivers:
      value > 100
        ? ['Month End Close', 'Invoice Posting']
        : value > 85
          ? ['Invoice Posting', 'Order Reconciliation']
          : ['Claim Intake'],
  })),
);

export const scheduleRisks: ScheduleRisk[] = [
  {
    id: 'risk-month-end',
    folder: 'Finance',
    process: 'Month End Close',
    nextRun: 'Friday 18:00',
    expectedMinutesP90: 132,
    expectedMinutesP95: 171,
    runtimeDemand: 8,
    availableCapacity: 6,
    slaMinutes: 120,
    projectedLateMinutes: 46,
    risk: 'critical',
    cause: 'Runtime wait plus long p95 duration',
  },
  {
    id: 'risk-invoice',
    folder: 'Finance',
    process: 'Invoice Posting',
    nextRun: 'Tuesday 08:00',
    expectedMinutesP90: 75,
    expectedMinutesP95: 92,
    runtimeDemand: 7,
    availableCapacity: 5,
    slaMinutes: 60,
    projectedLateMinutes: 31,
    risk: 'high',
    cause: 'Schedule overlap with daily reconciliation',
  },
  {
    id: 'risk-order-recon',
    folder: 'Supply Chain',
    process: 'Order Reconciliation',
    nextRun: 'Thursday 18:00',
    expectedMinutesP90: 64,
    expectedMinutesP95: 86,
    runtimeDemand: 4,
    availableCapacity: 5,
    slaMinutes: 75,
    projectedLateMinutes: 12,
    risk: 'medium',
    cause: 'Long p95 duration in constrained window',
  },
  {
    id: 'risk-claim-intake',
    folder: 'Customer Operations',
    process: 'Claim Intake',
    nextRun: 'Wednesday 13:00',
    expectedMinutesP90: 28,
    expectedMinutesP95: 35,
    runtimeDemand: 2,
    availableCapacity: 5,
    slaMinutes: 60,
    projectedLateMinutes: 0,
    risk: 'low',
    cause: 'Capacity available',
  },
];
