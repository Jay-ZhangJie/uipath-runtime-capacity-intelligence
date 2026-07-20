import type { LiveJobSummary, LiveMachineSummary, LiveTriggerSummary } from '../types/live';
import type { MachineTemplate, RiskLevel, RuntimeBucket, ScheduleRisk } from '../types';
import { formatDateTime, tenantDateHour, weekdayShortForDate } from './dateTime';

interface RuntimeInterval {
  startMs: number;
  endMs: number;
  laneKey: string;
}

function normalizeKey(value: string | number | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function knownRuntimeValue(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  return text && !['Unknown', 'Unknown host', 'Unknown machine', 'Unassigned'].includes(text) ? text : '';
}

function configuredRuntimeCount(machine: LiveMachineSummary) {
  return machine.unattendedSlots +
    machine.automationCloudSlots +
    machine.headlessSlots +
    machine.nonProductionSlots +
    machine.testingSlots;
}

function connectedMachineCount(machine: LiveMachineSummary) {
  return Math.max(machine.onlineHosts, machine.totalHosts, 0);
}

function configuredMaxCapacity(machine: LiveMachineSummary) {
  return configuredRuntimeCount(machine) * connectedMachineCount(machine);
}

function machineRuntimeType(machine: LiveMachineSummary): MachineTemplate['runtimeType'] {
  if (machine.automationCloudSlots > 0 && machine.unattendedSlots === 0 && machine.nonProductionSlots === 0 && machine.testingSlots === 0) return 'Serverless';
  if (machine.testingSlots > machine.unattendedSlots && machine.testingSlots >= machine.nonProductionSlots) return 'Testing';
  return machine.nonProductionSlots > machine.unattendedSlots ? 'NonProduction' : 'Unattended';
}

function validDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackEndDate(job: LiveJobSummary, startAt: Date) {
  const running = job.state.toLowerCase() === 'running';
  if (running) return new Date();
  return new Date(startAt.getTime() + 3_600_000);
}

function bucketKeysForInterval(startMs: number, endMs: number) {
  const keys = new Set<string>();
  if (endMs <= startMs) return keys;

  const addKey = (timeMs: number) => {
    const slot = tenantDateHour(new Date(timeMs).toISOString());
    if (slot) keys.add(`${slot.date}-${slot.hour}`);
  };

  addKey(startMs);
  addKey(endMs - 1);

  const firstHourBoundary = Math.floor(startMs / 3_600_000) * 3_600_000 + 3_600_000;
  for (let timeMs = firstHourBoundary; timeMs < endMs; timeMs += 3_600_000) {
    addKey(timeMs);
  }

  return keys;
}

function parseBucketKey(bucketKey: string) {
  const separator = bucketKey.lastIndexOf('-');
  return {
    date: bucketKey.slice(0, separator),
    hour: bucketKey.slice(separator + 1),
  };
}

function runtimeConsumptionLaneKey(job: LiveJobSummary, machineTemplateId: string) {
  const host = knownRuntimeValue(job.hostMachineName) || knownRuntimeValue(job.machineName);
  const account = knownRuntimeValue(job.userName) || knownRuntimeValue(job.robotName);
  const lane = host && account
    ? `${host} / ${account}`
    : account || (job.runtimeLaneKey.startsWith('job:') ? job.runtimeLaneKey : `job:${job.key}`);

  return `${machineTemplateId}|${job.runtimeType}|${normalizeKey(lane) || normalizeKey(job.key)}`;
}

function peakRuntimeLanes(intervals: RuntimeInterval[], capacity: number) {
  const events = intervals.flatMap((interval) => [
    { time: interval.startMs, laneKey: interval.laneKey, delta: 1 },
    { time: interval.endMs, laneKey: interval.laneKey, delta: -1 },
  ]);

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  const activeLaneCounts = new Map<string, number>();
  let peak = 0;

  events.forEach((event) => {
    const current = activeLaneCounts.get(event.laneKey) ?? 0;
    const next = current + event.delta;

    if (next <= 0) {
      activeLaneCounts.delete(event.laneKey);
    } else {
      activeLaneCounts.set(event.laneKey, next);
    }

    peak = Math.max(peak, activeLaneCounts.size);
  });

  return Math.min(Math.max(0, peak), Math.max(1, capacity));
}

export function liveMachineToTemplate(machine: LiveMachineSummary): MachineTemplate {
  const templateRuntimeSlots = configuredRuntimeCount(machine);
  const connectedMachines = connectedMachineCount(machine);

  return {
    id: machine.key,
    name: machine.name,
    machineType: machine.type,
    folders: machine.folderNames.length ? machine.folderNames : ['Unknown folder'],
    hostNames: machine.hostNames,
    templateRuntimeSlots,
    connectedMachines,
    configuredMaxCapacity: templateRuntimeSlots * connectedMachines,
    onlineHosts: machine.onlineHosts,
    totalHosts: Math.max(machine.totalHosts, machine.onlineHosts),
    runtimeType: machineRuntimeType(machine),
  };
}

export function buildLiveRuntimeBuckets(
  jobs: LiveJobSummary[],
  triggers: LiveTriggerSummary[],
  capacity: number,
  liveMachines: LiveMachineSummary[],
  todayDate: string,
  machineTemplateIdFilter = 'all',
): RuntimeBucket[] {
  if (!jobs.length && !triggers.length) return [];

  const machineCapacity = new Map(liveMachines.map((machine) => [machine.key, Math.max(1, configuredMaxCapacity(machine))]));
  const selectedMachineCapacity = machineTemplateIdFilter === 'all'
    ? capacity
    : Math.min(capacity, machineCapacity.get(machineTemplateIdFilter) ?? capacity);
  const safeCapacity = Math.max(1, selectedMachineCapacity);
  const bucketMap = new Map<string, RuntimeBucket>();
  const bucketIntervals = new Map<string, RuntimeInterval[]>();
  const machineByName = new Map<string, string>();

  liveMachines.forEach((machine) => {
    [machine.name, machine.key, String(machine.id), ...machine.hostNames].forEach((name) => {
      const normalized = normalizeKey(name);
      if (normalized) machineByName.set(normalized, machine.key);
    });
  });

  const resolveMachineTemplateId = (job: LiveJobSummary) => {
    const candidates = [job.hostMachineName, job.machineName];
    const match = candidates.map((candidate) => machineByName.get(normalizeKey(candidate))).find(Boolean);
    return match ?? 'all';
  };

  const ensureBucket = (date: string, hour: string) => {
    const key = `${date}-${hour}`;
    const existing = bucketMap.get(key);
    if (existing) return existing;

    const bucket: RuntimeBucket = {
      date,
      weekday: weekdayShortForDate(date),
      hour,
      machineTemplateId: 'all',
      observedDemand: 0,
      projectedDemand: 0,
      capacity: safeCapacity,
      topDrivers: [],
    };
    bucketMap.set(key, bucket);
    return bucket;
  };

  jobs.forEach((job) => {
    // API timestamps are UTC instants; tenantDateHour maps them into the configured business timezone.
    const startAt = validDate(job.startTime) ?? validDate(job.createdTime);
    if (!startAt) return;

    const start = tenantDateHour(startAt.toISOString());
    if (!start) return;
    if (start.date > todayDate) return;
    const machineTemplateId = resolveMachineTemplateId(job);
    if (machineTemplateIdFilter !== 'all' && machineTemplateId !== machineTemplateIdFilter) return;

    const endAt = validDate(job.endTime) ?? fallbackEndDate(job, startAt);
    const endMs = Math.max(endAt.getTime(), startAt.getTime() + 1);
    const templateForLane = machineTemplateIdFilter === 'all' ? machineTemplateId : machineTemplateIdFilter;
    const laneKey = runtimeConsumptionLaneKey(job, templateForLane);

    bucketKeysForInterval(startAt.getTime(), endMs).forEach((bucketKey) => {
      const { date, hour } = parseBucketKey(bucketKey);
      const bucket = ensureBucket(date, hour);
      const intervalKey = `${date}-${hour}`;
      bucket.machineTemplateId = machineTemplateIdFilter === 'all' ? 'all' : machineTemplateId;
      const intervals = bucketIntervals.get(intervalKey) ?? [];
      intervals.push({ startMs: startAt.getTime(), endMs, laneKey });
      bucketIntervals.set(intervalKey, intervals);
      if (!bucket.topDrivers.includes(job.processName)) bucket.topDrivers.push(job.processName);
    });
  });

  bucketIntervals.forEach((intervals, bucketKey) => {
    const bucket = bucketMap.get(bucketKey);
    if (!bucket) return;
    const peak = peakRuntimeLanes(intervals, bucket.capacity);
    bucket.observedDemand = peak;
    bucket.projectedDemand = Math.max(bucket.projectedDemand, peak);
  });

  triggers.forEach((trigger) => {
    if (!trigger.enabled || !trigger.nextRun) return;
    // Future schedule predictions use the same business timezone as historical job buckets.
    const nextRun = tenantDateHour(trigger.nextRun);
    if (!nextRun || nextRun.date <= todayDate) return;

    const bucket = ensureBucket(nextRun.date, nextRun.hour);
    bucket.projectedDemand += 1;
    bucket.machineTemplateId = machineTemplateIdFilter;
    if (!bucket.topDrivers.includes(trigger.processName)) bucket.topDrivers.push(trigger.processName);
  });

  return Array.from(bucketMap.values()).map((bucket) => ({
    ...bucket,
    topDrivers: bucket.topDrivers.length ? bucket.topDrivers.slice(0, 3) : ['No live signal observed'],
  }));
}

export function buildLiveScheduleRisks(triggers: LiveTriggerSummary[], capacity: number): ScheduleRisk[] {
  if (!triggers.length) return [];
  const availableCapacity = Math.max(1, capacity);

  return triggers.map((trigger) => {
    const disabled = !trigger.enabled;
    const runtimeDemand = 1;
    const risk: RiskLevel = disabled ? 'low' : availableCapacity <= runtimeDemand ? 'high' : 'medium';
    const nextRun = trigger.nextRun
      ? formatDateTime(trigger.nextRun)
      : trigger.cronSummary || trigger.cron || 'Schedule not exposed';

    return {
      id: `live-trigger-${trigger.key}`,
      folder: trigger.folderName,
      process: trigger.processName || trigger.name,
      nextRun,
      expectedMinutesP90: 0,
      expectedMinutesP95: 0,
      runtimeDemand,
      availableCapacity,
      slaMinutes: 0,
      projectedLateMinutes: risk === 'high' ? 1 : 0,
      risk,
      cause: disabled
        ? 'Trigger disabled'
        : `Live ${trigger.triggerType.toLowerCase()} trigger; ${trigger.runtimeType} runtime; priority ${trigger.jobPriority}`,
    };
  });
}
