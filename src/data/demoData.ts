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

export const hours24 = Array.from({ length: 24 }, (_, hour) => hour.toString().padStart(2, '0'));
export const weekDates = ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
export const monthDates = Array.from({ length: 31 }, (_, index) => `2026-07-${(index + 1).toString().padStart(2, '0')}`);
export const quarterDates = Array.from(new Set([...weekDates, ...monthDates]));
export const defaultFocusDate = '2026-07-01';

const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayFor(date: string) {
  return weekdayShort[new Date(`${date}T00:00:00`).getDay()];
}

function machineTemplateFor(date: string, hour: number) {
  const weekday = weekdayFor(date);
  if (date === '2026-07-31' || (weekday === 'Tue' && hour >= 7 && hour <= 10) || (weekday === 'Fri' && hour >= 18)) {
    return 'mt-prod-windows';
  }
  if (weekday === 'Thu' || weekday === 'Sat' || weekday === 'Sun') {
    return 'mt-backoffice-highdensity';
  }
  return 'mt-monthend-burst';
}

function utilizationFor(date: string, hour: number) {
  const weekday = weekdayFor(date);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  let utilization = isWeekend ? 18 : 34;

  if (!isWeekend && hour >= 6 && hour <= 7) utilization += 18;
  if (!isWeekend && hour >= 8 && hour <= 10) utilization += 38;
  if (!isWeekend && hour >= 11 && hour <= 14) utilization += 22;
  if (!isWeekend && hour >= 17 && hour <= 20) utilization += 34;
  if (isWeekend && hour >= 2 && hour <= 5) utilization += 20;
  if (weekday === 'Tue' && hour >= 8 && hour <= 10) utilization += 26;
  if (weekday === 'Fri' && hour >= 18 && hour <= 21) utilization += 38;
  if (date === '2026-07-04' && hour >= 1 && hour <= 4) utilization += 36;
  if (date === '2026-07-07' && hour >= 8 && hour <= 10) utilization += 26;
  if (date === '2026-07-15' && hour >= 17 && hour <= 19) utilization += 18;
  if (date === '2026-07-31' && hour >= 18 && hour <= 22) utilization += 58;
  if (hour <= 1 || hour >= 23) utilization -= 10;

  return Math.max(6, utilization);
}

function driversFor(date: string, hour: number, utilization: number) {
  if (date === '2026-07-31' && hour >= 18) return ['Month End Close', 'Invoice Posting', 'Cash Application'];
  if (weekdayFor(date) === 'Fri' && hour >= 18) return ['Month End Close', 'Invoice Posting'];
  if (weekdayFor(date) === 'Tue' && hour >= 8 && hour <= 10) return ['Invoice Posting', 'Order Reconciliation'];
  if (weekdayFor(date) === 'Sat' || weekdayFor(date) === 'Sun') return ['Weekend Queue Drain', 'Claim Intake'];
  if (utilization >= 85) return ['Order Reconciliation', 'Invoice Posting'];
  return ['Claim Intake'];
}

export const runtimeBuckets: RuntimeBucket[] = quarterDates.flatMap((date) =>
  hours24.map((hour) => {
    const hourNumber = Number(hour);
    const utilization = utilizationFor(date, hourNumber);
    const capacity = 18;
    const projectedDemand = Math.round((utilization / 100) * capacity);
    const observedDemand = Math.max(0, projectedDemand - (hourNumber % 5 === 0 ? 1 : 0));

    return {
      date,
      weekday: weekdayFor(date),
      hour,
      machineTemplateId: machineTemplateFor(date, hourNumber),
      observedDemand,
      projectedDemand,
      capacity,
      topDrivers: driversFor(date, hourNumber, utilization),
    };
  }),
);

export const scheduleRisks: ScheduleRisk[] = [
  {
    id: 'risk-month-end',
    folder: 'Finance',
    process: 'Month End Close',
    nextRun: '2026-07-31 18:00',
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
    nextRun: '2026-07-07 08:00',
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
    nextRun: '2026-07-02 18:00',
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
    nextRun: '2026-07-01 13:00',
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
