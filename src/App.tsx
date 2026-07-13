import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FolderTree,
  Info,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { hours24 } from './data/calendarData';
import {
  dateRanges,
  defaultDateRange,
  requiredScopes,
  requiredScopeText,
  heatmapCacheSessionStorageKey,
  liveSessionStorageKey,
  selectedConnectionStorageKey,
  tenantTimezoneLabel,
  weekdayHeaders,
} from './config/appConfig';
import {
  filterBucketsByTemplate,
  filterRisks,
  groupRiskByFolder,
  peakDemand,
  riskFromPercent,
  totalConnectedMachines,
  totalConfiguredMaxCapacity,
  totalTemplateRuntimeSlots,
  utilizationPercent,
} from './lib/analytics';
import {
  defaultConnectionProfile,
  inferEnvironment,
  loadConnectionProfiles,
  saveConnectionProfiles,
  tenantNameFromConnection,
} from './lib/connectionProfiles';
import { formatDate, tenantNowSlot } from './lib/dateTime';
import { buildLiveRuntimeBuckets, buildLiveScheduleRisks, liveMachineToTemplate } from './lib/liveTransforms';
import { buildRecommendations } from './lib/recommendations';
import {
  getDefaultRedirectUri,
  logoutLiveOrchestrator,
  normalizeOrganizationSlug,
  normalizeSdkBaseUrl,
  probeLiveOrchestrator,
} from './lib/uipathLive';
import type {
  LiveFolderSummary,
  LiveProbeResult,
  ProbeConnectionConfig,
} from './lib/uipathLive';
import type { ConnectionModalMode, ConnectionProfile } from './types/connections';
import type {
  DateRange,
  MachineTemplate,
  Recommendation,
  RiskLevel,
  RiskView,
  RuntimeBucket,
  SelectedTile,
  TenantLicenseSummary,
  TimeGrain,
  WhatIfScenario,
} from './types';

type DataSignalTone = 'ok' | 'info' | 'warning' | 'error';

type DataSignal = {
  id: string;
  tone: DataSignalTone;
  title: string;
  detail: string;
  timestamp?: string;
};

type ScenarioAdvisorRecommendation = {
  recommendedDate: string;
  recommendedHour: string;
  title: string;
  action: string;
  impact: string;
  confidence: 'Low' | 'Medium' | 'High';
  rationale: string;
  followUps: string[];
};

type SearchableTableColumn<T> = {
  header: string;
  render: (row: T) => React.ReactNode;
  value: (row: T) => string | number | null | undefined;
};

const grains: TimeGrain[] = ['day', 'week', 'month'];
const riskViews: RiskView[] = ['folder', 'process', 'job', 'sla'];
const dayPeriods = [
  { label: '00:00-05:59', hours: hours24.slice(0, 6) },
  { label: '06:00-11:59', hours: hours24.slice(6, 12) },
  { label: '12:00-17:59', hours: hours24.slice(12, 18) },
  { label: '18:00-23:59', hours: hours24.slice(18, 24) },
];

type LiveConnectionPhase = 'idle' | 'connecting' | 'generating' | 'connected' | 'partial' | 'error';
type GeneratedHeatmapScope = {
  folder: string;
  machineTemplateId: string;
};

type HeatmapCache = Record<string, LiveProbeResult>;
type FolderTreeNode = {
  id: string;
  value: string;
  label: string;
  path: string;
  selectable: boolean;
  children: FolderTreeNode[];
};

const initialTenantSlot = tenantNowSlot();
const heatmapAnchorDate = initialTenantSlot.date;
const allFoldersLabel = 'All permitted folders';
const weekDates = weekDatesFor(heatmapAnchorDate);
const monthDates = monthDatesFor(heatmapAnchorDate);
const quarterDates = Array.from(new Set([...historicalDatesForRange('last-month', heatmapAnchorDate), ...monthDates]));

const emptyScenario: WhatIfScenario = {
  solutionName: '',
  businessDetails: '',
  folder: '',
  machineTemplateId: 'all',
  preferredDate: initialTenantSlot.date,
  preferredHour: initialTenantSlot.hour,
  runtimeDemand: 1,
  durationMinutes: 60,
  priority: 'Normal',
};

function splitFolderPath(folder: LiveFolderSummary) {
  const source = folder.path || folder.name;
  const parts = source
    .split(/\s*(?:[\\/]|>)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [folder.name];
}

function sortFolderTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  return [...nodes]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((node) => ({ ...node, children: sortFolderTree(node.children) }));
}

function buildPathFolderTree(folderDetails: LiveFolderSummary[]) {
  const roots: FolderTreeNode[] = [];
  const nodeByPath = new Map<string, FolderTreeNode>();

  folderDetails.forEach((folder) => {
    const parts = splitFolderPath(folder);
    let parentChildren = roots;
    let path = '';

    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = nodeByPath.get(path);

      if (!node) {
        node = {
          id: isLeaf ? `folder-${folder.key || folder.id}` : `folder-group-${path}`,
          value: isLeaf ? folder.path : path,
          label: part,
          path,
          selectable: isLeaf,
          children: [],
        };
        nodeByPath.set(path, node);
        parentChildren.push(node);
      }

      if (isLeaf) {
        node.id = `folder-${folder.key || folder.id}`;
        node.value = folder.path;
        node.path = folder.path;
        node.selectable = true;
      }

      parentChildren = node.children;
    });
  });

  return sortFolderTree(roots);
}

function buildParentFolderTree(folderDetails: LiveFolderSummary[]) {
  const roots: FolderTreeNode[] = [];
  const nodeById = new Map<number, FolderTreeNode>();
  const nodeByKey = new Map<string, FolderTreeNode>();

  folderDetails.forEach((folder) => {
    const node: FolderTreeNode = {
      id: `folder-${folder.key || folder.id}`,
      value: folder.path,
      label: folder.name,
      path: folder.path,
      selectable: true,
      children: [],
    };
    nodeById.set(folder.id, node);
    nodeByKey.set(folder.key, node);
  });

  folderDetails.forEach((folder) => {
    const node = nodeById.get(folder.id);
    if (!node) return;

    const parent = folder.parentKey
      ? nodeByKey.get(folder.parentKey)
      : folder.parentId
        ? nodeById.get(folder.parentId)
        : undefined;

    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return sortFolderTree(roots);
}

function buildFolderTree(folderDetails: LiveFolderSummary[], folderOptions: string[], includeAllOption: boolean) {
  const allowedFolderOptions = folderOptions.filter((folderOption) => folderOption !== allFoldersLabel);
  const scopedFolderDetails = allowedFolderOptions.length
    ? folderDetails.filter((folder) => allowedFolderOptions.some((folderOption) =>
      folderValuesMatch(folderOption, folder.path) || folderValuesMatch(folderOption, folder.name),
    ))
    : includeAllOption ? [] : folderDetails;
  const hasParentLinks = scopedFolderDetails.some((folder) =>
    Boolean(
      (folder.parentKey && scopedFolderDetails.some((candidate) => candidate.key === folder.parentKey)) ||
      (folder.parentId && scopedFolderDetails.some((candidate) => candidate.id === folder.parentId)),
    ),
  );
  const liveTree = scopedFolderDetails.length
    ? hasParentLinks ? buildParentFolderTree(scopedFolderDetails) : buildPathFolderTree(scopedFolderDetails)
    : [];
  const fallbackTree = folderOptions
    .filter((folderOption) => folderOption !== allFoldersLabel)
    .map((folderOption) => ({
      id: `folder-fallback-${folderOption}`,
      value: folderOption,
      label: folderOption,
      path: folderOption,
      selectable: true,
      children: [],
    }));
  const children = liveTree.length ? liveTree : fallbackTree;

  return includeAllOption
    ? [
      {
        id: 'all-permitted-folders',
        value: allFoldersLabel,
        label: allFoldersLabel,
        path: allFoldersLabel,
        selectable: true,
        children,
      },
    ]
    : children;
}

function findFolderTreeNode(nodes: FolderTreeNode[], value: string): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.value === value) return node;
    const childMatch = findFolderTreeNode(node.children, value);
    if (childMatch) return childMatch;
  }
  return null;
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function folderLeafName(value: string) {
  const parts = value
    .split(/\s*(?:[\\/]|>)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? value.trim();
}

function formatFolderDisplayName(value: string) {
  if (value === allFoldersLabel) return value;
  return folderLeafName(value) || value;
}

function formatFolderPathDisplay(value: string) {
  if (value === allFoldersLabel) return value;
  const parts = value
    .split(/\s*(?:[\\/]|>)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts.join(' / ') : value;
}

function folderValuesMatch(left: string, right: string) {
  const normalizedLeft = normalizeFilterValue(left);
  const normalizedRight = normalizeFilterValue(right);
  return normalizedLeft === normalizedRight ||
    normalizeFilterValue(folderLeafName(left)) === normalizedRight ||
    normalizedLeft === normalizeFilterValue(folderLeafName(right));
}

function templateIsConfiguredInFolder(template: MachineTemplate, selectedFolder: string) {
  if (selectedFolder === allFoldersLabel) return true;
  return template.folders.some((templateFolder) => folderValuesMatch(selectedFolder, templateFolder));
}

function folderIsConfiguredForTemplate(folderOption: string, template: MachineTemplate | null) {
  if (folderOption === allFoldersLabel || !template) return true;
  return template.folders.some((templateFolder) => folderValuesMatch(folderOption, templateFolder));
}

function machineTypeLabel(template: MachineTemplate) {
  const normalized = (template.machineType || 'Machine').trim();
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!compact || compact === 'machine') return 'machine';
  if (compact === 'template' || compact === 'machinetemplate') return 'template';
  if (compact === 'elasticrobotpool' || compact === 'elasticpool') return 'elastic-pool';
  if (compact === 'cloudrobotvm' || compact === 'cloudvm') return 'cloud-vm';
  if (compact === 'cloudrobotserverless' || compact === 'cloudserverless') return 'cloud-serverless';

  return normalized
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function machineOptionLabel(template: MachineTemplate) {
  return `${template.name} (${machineTypeLabel(template)})`;
}

function hostSignalSummary(templates: MachineTemplate[]) {
  return templates.reduce(
    (summary, template) => ({
      online: summary.online + template.onlineHosts,
      total: summary.total + template.totalHosts,
    }),
    { online: 0, total: 0 },
  );
}

function licenseAllocationValue(license: TenantLicenseSummary | null) {
  return license?.runtimeAllocated ?? null;
}

function licenseAllocationLabel(license: TenantLicenseSummary | null) {
  return license ? `${license.label} Allocation` : 'Runtime License Allocation';
}

function licenseAllocationStatus(license: TenantLicenseSummary | null) {
  return license?.runtimeAllocated ?? 'no';
}

function capacityDisplay(value: number | null) {
  return value === null ? 'N/A' : value;
}

function planningCapacityFor(licenseAllocation: number | null, configuredMaxCapacity: number) {
  const configured = configuredMaxCapacity || 0;
  if (licenseAllocation === null) return Math.max(1, configured || 1);
  if (!configured) return Math.max(1, licenseAllocation || 1);
  return Math.max(1, Math.min(licenseAllocation, configured));
}

function riskLabel(risk: RiskLevel) {
  return {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  }[risk];
}

function riskTone(risk: RiskLevel) {
  return `tone-${risk}`;
}

function formatRecommendationType(type: string) {
  return type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function dayNumber(date: string) {
  return Number(date.split('-')[2]);
}

function dateToUtc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

function addDays(date: string, offset: number) {
  const value = dateToUtc(date);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function historicalDatesForRange(range: DateRange, anchorDate: string) {
  const days = range === 'last-day' ? 1 : range === 'last-week' ? 7 : range === 'last-month' ? 30 : 90;
  return Array.from({ length: days }, (_, index) => addDays(anchorDate, index - days + 1));
}

function weekDatesFor(date: string) {
  const day = dateToUtc(date).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, index) => addDays(date, mondayOffset + index));
}

function comparisonWeekDatesFor(date: string) {
  const currentWeek = weekDatesFor(date);
  const previousWeek = currentWeek.map((weekDate) => addDays(weekDate, -7));
  return [...previousWeek, ...currentWeek];
}

function monthDatesWithOffset(date: string, monthOffset: number) {
  const value = dateToUtc(date);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + monthOffset;
  const first = new Date(Date.UTC(year, month, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  const count = Math.round((nextMonth.getTime() - first.getTime()) / 86_400_000);
  return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month, index + 1)).toISOString().slice(0, 10));
}

function monthDatesFor(date: string) {
  return monthDatesWithOffset(date, 0);
}

function comparisonMonthDatesFor(date: string) {
  return [...monthDatesWithOffset(date, -1), ...monthDatesFor(date)];
}

function isFutureDate(date: string, today = initialTenantSlot.date) {
  return date > today;
}

function isBusinessDay(date: string) {
  const day = dateToUtc(date).getUTCDay();
  return day >= 1 && day <= 5;
}

function dateOptionsForRange(range: DateRange, liveCalendar = false) {
  if (liveCalendar) return historicalDatesForRange(range, initialTenantSlot.date);
  if (range === 'last-day') return [initialTenantSlot.date];
  if (range === 'last-week') return weekDates;
  if (range === 'last-month') return monthDates;
  return quarterDates;
}

function dateRangeForDate(date: string, fallback: DateRange, liveCalendar = false) {
  return dateRanges.find((range) => dateOptionsForRange(range.value, liveCalendar).includes(date))?.value ?? fallback;
}

function filterBucketsByDateRange(buckets: RuntimeBucket[], range: DateRange, liveCalendar = false) {
  const allowedDates = new Set(dateOptionsForRange(range, liveCalendar));
  return buckets.filter((bucket) => allowedDates.has(bucket.date));
}

function bucketFor(date: string, hour: string, buckets: RuntimeBucket[]) {
  return buckets.find((bucket) => bucket.date === date && bucket.hour === hour) ?? null;
}

function applyScenarioImpact(buckets: RuntimeBucket[], scenario: WhatIfScenario | null, machineTemplateId: string) {
  if (!scenario) return buckets;
  if (machineTemplateId !== 'all' && scenario.machineTemplateId !== machineTemplateId) return buckets;

  const impactedHours = Math.max(1, Math.ceil(scenario.durationMinutes / 60));
  const startHour = Number(scenario.preferredHour);

  return buckets.map((bucket) => {
    if (bucket.date !== scenario.preferredDate) return bucket;
    if (machineTemplateId !== 'all' && scenario.machineTemplateId !== bucket.machineTemplateId) return bucket;

    const bucketHour = Number(bucket.hour);
    const isImpacted = bucketHour >= startHour && bucketHour < startHour + impactedHours;
    if (!isImpacted) return bucket;

    return {
      ...bucket,
      projectedDemand: bucket.projectedDemand + scenario.runtimeDemand,
      topDrivers: [scenario.solutionName || 'Submitted scenario', ...bucket.topDrivers],
    };
  });
}

function scenarioImpactSummary(
  scenario: WhatIfScenario | null,
  baseBuckets: RuntimeBucket[],
  impactedBuckets: RuntimeBucket[],
) {
  if (!scenario) return null;

  const impactedHours = Math.max(1, Math.ceil(scenario.durationMinutes / 60));
  const startHour = Number(scenario.preferredHour);
  const endHour = Math.min(24, startHour + impactedHours);
  const impactedHourValues = hours24.slice(startHour, endHour);

  const baselineBuckets = impactedHourValues
    .map((hour) => bucketFor(scenario.preferredDate, hour, baseBuckets))
    .filter((bucket): bucket is RuntimeBucket => Boolean(bucket));
  const projectedBuckets = impactedHourValues
    .map((hour) => bucketFor(scenario.preferredDate, hour, impactedBuckets))
    .filter((bucket): bucket is RuntimeBucket => Boolean(bucket));

  if (!projectedBuckets.length) {
    return {
      baselinePeak: 0,
      projectedPeak: 0,
      capacity: 0,
      impactedHours: impactedHourValues,
      riskHours: 0,
      addedDemand: scenario.runtimeDemand,
      totalAddedRuntimeHours: scenario.runtimeDemand * impactedHourValues.length,
    };
  }

  const baselinePeak = Math.max(0, ...baselineBuckets.map((bucket) => bucket.projectedDemand));
  const projectedPeak = Math.max(...projectedBuckets.map((bucket) => bucket.projectedDemand));
  const capacity = projectedBuckets[0]?.capacity ?? 0;
  const riskHours = projectedBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;

  return {
    baselinePeak,
    projectedPeak,
    capacity,
    impactedHours: impactedHourValues,
    riskHours,
    addedDemand: scenario.runtimeDemand,
    totalAddedRuntimeHours: scenario.runtimeDemand * impactedHourValues.length,
  };
}

function buildScenarioAdvisorRecommendation(
  scenario: WhatIfScenario,
  buckets: RuntimeBucket[],
): ScenarioAdvisorRecommendation {
  const durationHours = Math.max(1, Math.ceil(scenario.durationMinutes / 60));
  const startIndex = Math.max(0, quarterDates.indexOf(scenario.preferredDate));
  const candidateDates = quarterDates.slice(startIndex).concat(quarterDates.slice(0, startIndex));
  const candidateSlots = candidateDates.flatMap((date) =>
    hours24.map((hour) => {
      const startHour = Number(hour);
      const impactedHours = hours24.slice(startHour, Math.min(24, startHour + durationHours));
      const slotBuckets = impactedHours
        .map((slotHour) => bucketFor(date, slotHour, buckets))
        .filter((bucket): bucket is RuntimeBucket => Boolean(bucket));

      if (!slotBuckets.length) {
        return {
          date,
          hour,
          projectedPeak: Number.MAX_SAFE_INTEGER,
          projectedUtilization: Number.MAX_SAFE_INTEGER,
          riskHours: Number.MAX_SAFE_INTEGER,
          availableBuffer: -Number.MAX_SAFE_INTEGER,
        };
      }

      const projectedPeak = Math.max(...slotBuckets.map((bucket) => bucket.projectedDemand + scenario.runtimeDemand));
      const capacity = slotBuckets[0]?.capacity ?? 1;
      const projectedUtilization = Math.round((projectedPeak / capacity) * 100);
      const riskHours = slotBuckets.filter((bucket) => ((bucket.projectedDemand + scenario.runtimeDemand) / bucket.capacity) * 100 >= 85).length;
      const availableBuffer = Math.min(...slotBuckets.map((bucket) => bucket.capacity - bucket.projectedDemand - scenario.runtimeDemand));

      return { date, hour, projectedPeak, projectedUtilization, riskHours, availableBuffer };
    }),
  );

  const bestSlot = candidateSlots
    .filter((slot) => Number.isFinite(slot.projectedUtilization))
    .sort((a, b) =>
      a.riskHours - b.riskHours ||
      a.projectedUtilization - b.projectedUtilization ||
      b.availableBuffer - a.availableBuffer,
    )[0];

  const selectedSlot = bucketFor(scenario.preferredDate, scenario.preferredHour, buckets);
  const selectedProjectedDemand = (selectedSlot?.projectedDemand ?? 0) + scenario.runtimeDemand;
  const selectedCapacity = selectedSlot?.capacity ?? 1;
  const selectedUtilization = Math.round((selectedProjectedDemand / selectedCapacity) * 100);
  const bestUtilization = bestSlot?.projectedUtilization ?? selectedUtilization;
  const recommendedDate = bestSlot?.date ?? scenario.preferredDate;
  const recommendedHour = bestSlot?.hour ?? scenario.preferredHour;
  const priorityText = scenario.priority.toLowerCase();
  const detailHint = scenario.businessDetails.trim()
    ? `The draft mentions: ${scenario.businessDetails.trim()}`
    : 'No SLA or volume notes were provided, so this uses runtime demand, duration, priority, and current capacity only.';
  const action =
    bestSlot && (bestSlot.date !== scenario.preferredDate || bestSlot.hour !== scenario.preferredHour)
      ? `Move the proposed start to ${formatDate(recommendedDate)} ${recommendedHour}:00.`
      : 'The selected start time is acceptable for the current capacity data.';
  const confidence: ScenarioAdvisorRecommendation['confidence'] =
    bestSlot && bestSlot.riskHours === 0 && bestSlot.projectedUtilization < 75 ? 'High' : bestSlot && bestSlot.projectedUtilization < 90 ? 'Medium' : 'Low';

  return {
    recommendedDate,
    recommendedHour,
    title: `AI-assisted recommendation for ${scenario.solutionName.trim() || 'this automation'}`,
    action,
    impact: `Projected peak changes from ${selectedUtilization}% in the selected slot to ${bestUtilization}% in the recommended slot.`,
    confidence,
    rationale: `${scenario.runtimeDemand} runtime(s) for ${scenario.durationMinutes} minutes with ${priorityText} priority. ${detailHint}`,
    followUps: [
      'Confirm the business SLA window and blackout dates before scheduling.',
      'Validate p90/p95 duration once live job history is connected.',
      'Review machine capacity if the recommendation confidence is low.',
    ],
  };
}

function peakBucketForDate(date: string, buckets: RuntimeBucket[]) {
  const dayBuckets = buckets.filter((bucket) => bucket.date === date);
  if (!dayBuckets.length) return null;
  return dayBuckets.reduce((peak, bucket) =>
    utilizationPercent(bucket) > utilizationPercent(peak) ? bucket : peak,
  );
}

function utilizationSummaryForDate(date: string, buckets: RuntimeBucket[]) {
  const dayBuckets = buckets.filter((bucket) => bucket.date === date);
  if (!dayBuckets.length) return null;

  const peak = peakBucketForDate(date, buckets);
  const average = Math.round(
    dayBuckets.reduce((sum, bucket) => sum + utilizationPercent(bucket), 0) / dayBuckets.length,
  );
  const lowCapacityHours = dayBuckets.filter((bucket) => utilizationPercent(bucket) < 60).length;
  const riskHours = dayBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;

  return {
    average,
    lowCapacityHours,
    peak,
    peakPercent: peak ? utilizationPercent(peak) : 0,
    riskHours,
  };
}

function dataSignalIcon(tone: DataSignalTone) {
  if (tone === 'ok') return <CheckCircle2 size={17} />;
  if (tone === 'warning') return <AlertTriangle size={17} />;
  if (tone === 'error') return <AlertCircle size={17} />;
  return <Info size={17} />;
}

function connectionToProbeConfig(connection: ConnectionProfile): ProbeConnectionConfig {
  const tenantName = tenantNameFromConnection(connection);
  return {
    baseUrl: normalizeSdkBaseUrl(connection.platformUrl),
    orgName: normalizeOrganizationSlug(connection.organization),
    tenantName,
    clientId: connection.clientId.trim(),
    redirectUri: getDefaultRedirectUri(),
    scope: String(import.meta.env.VITE_UIPATH_SCOPE ?? '').trim() || requiredScopeText,
  };
}

function buildOrchestratorMachineMonitoringUrl(connection: ConnectionProfile | null) {
  const platformUrl = connection?.platformUrl.trim().replace(/\/+$/, '') || 'https://cloud.uipath.com';
  if (!connection) return platformUrl;

  const organization = normalizeOrganizationSlug(connection.organization);
  const tenantName = tenantNameFromConnection(connection).trim();
  if (!organization || !tenantName) return platformUrl;

  return [
    platformUrl,
    encodeURIComponent(organization),
    encodeURIComponent(tenantName),
    'orchestrator_',
    'monitoring',
    'machines',
  ].join('/');
}

function loadHeatmapCache() {
  try {
    if (!window.localStorage.getItem(liveSessionStorageKey)) return {};
    const saved = window.sessionStorage.getItem(heatmapCacheSessionStorageKey);
    return saved ? JSON.parse(saved) as HeatmapCache : {};
  } catch {
    return {};
  }
}

function saveHeatmapCache(cache: HeatmapCache) {
  try {
    if (Object.keys(cache).length) {
      window.sessionStorage.setItem(heatmapCacheSessionStorageKey, JSON.stringify(cache));
    } else {
      window.sessionStorage.removeItem(heatmapCacheSessionStorageKey);
    }
  } catch {
    window.sessionStorage.removeItem(heatmapCacheSessionStorageKey);
  }
}

function safeFilePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'all';
}

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [folder, setFolder] = useState(allFoldersLabel);
  const dateRange: DateRange = defaultDateRange;
  const [machineTemplateId, setMachineTemplateId] = useState('all');
  const [grain, setGrain] = useState<TimeGrain>('day');
  const [riskView, setRiskView] = useState<RiskView>('folder');
  const [selectedDate, setSelectedDate] = useState(initialTenantSlot.date);
  const [selectedTile, setSelectedTile] = useState<SelectedTile>(initialTenantSlot);
  const [scenarioForm, setScenarioForm] = useState<WhatIfScenario>(emptyScenario);
  const [submittedScenario, setSubmittedScenario] = useState<WhatIfScenario | null>(null);
  const [scenarioAdvice, setScenarioAdvice] = useState<ScenarioAdvisorRecommendation | null>(null);
  const [liveConnectionPhase, setLiveConnectionPhase] = useState<LiveConnectionPhase>('idle');
  const [liveProbe, setLiveProbe] = useState<LiveProbeResult | null>(null);
  const [generatedHeatmapScope, setGeneratedHeatmapScope] = useState<GeneratedHeatmapScope | null>(null);
  const [heatmapCache, setHeatmapCache] = useState<HeatmapCache>(loadHeatmapCache);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const restoringSessionRef = useRef(false);
  const inFlightHeatmapScopesRef = useRef(new Set<string>());
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(loadConnectionProfiles);
  const [selectedConnectionId, setSelectedConnectionId] = useState(() =>
    window.localStorage.getItem(selectedConnectionStorageKey) ?? loadConnectionProfiles()[0]?.id ?? 'default-connection',
  );
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [connectionModalMode, setConnectionModalMode] = useState<ConnectionModalMode>('manage');
  const selectedConnection = useMemo(
    () => connectionProfiles.find((connection) => connection.id === selectedConnectionId) ?? connectionProfiles[0] ?? null,
    [connectionProfiles, selectedConnectionId],
  );
  const selectedTenantName = useMemo(() => tenantNameFromConnection(selectedConnection), [selectedConnection]);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionProfile>(() => selectedConnection ?? defaultConnectionProfile());
  const liveMachineTemplates = useMemo(
    () => (liveProbe?.machines.length ? liveProbe.machines.map(liveMachineToTemplate) : []),
    [liveProbe],
  );
  const liveMode = signedIn && Boolean(liveProbe?.authenticated && (liveProbe.status === 'connected' || liveProbe.status === 'partial'));
  const allMachineTemplates = liveMode ? liveMachineTemplates : [];
  const selectedMachineTemplate = machineTemplateId === 'all'
    ? null
    : allMachineTemplates.find((template) => template.id === machineTemplateId) ?? null;
  const currentHeatmapCacheKey = `${selectedConnectionId}|${selectedTenantName}|${folder}|${machineTemplateId}`;
  const cachedHeatmapProbe = heatmapCache[currentHeatmapCacheKey] ?? null;
  const currentScopeHasCache = Boolean(cachedHeatmapProbe);
  const heatmapScopeMatches = !generatedHeatmapScope ||
    (generatedHeatmapScope.folder === folder && generatedHeatmapScope.machineTemplateId === machineTemplateId);
  const liveHeatmapGenerated = liveMode && liveProbe?.mode === 'heatmap' && Boolean(generatedHeatmapScope);
  const liveHeatmapCurrent = liveHeatmapGenerated && heatmapScopeMatches;
  const machineFilterOptions = allMachineTemplates;
  const visibleMachineTemplates = useMemo(
    () => allMachineTemplates.filter((template) =>
      templateIsConfiguredInFolder(template, folder) &&
      (machineTemplateId === 'all' || template.id === machineTemplateId),
    ),
    [allMachineTemplates, folder, machineTemplateId],
  );
  const tenantLicense = liveMode ? liveProbe?.tenantLicense ?? null : null;
  const licenseAllocation = licenseAllocationValue(tenantLicense);
  const licenseRuntimeLabel = tenantLicense?.label ?? 'Unavailable';
  const licenseRuntimeDetail = tenantLicense ? `${tenantLicense.productCode} from license API` : 'License API not returned';
  const configuredMaxCapacity = totalConfiguredMaxCapacity(visibleMachineTemplates);
  const templateRuntimeSlots = totalTemplateRuntimeSlots(visibleMachineTemplates);
  const connectedMachines = totalConnectedMachines(visibleMachineTemplates);
  const planningCapacity = planningCapacityFor(licenseAllocation, configuredMaxCapacity);
  const hostSignals = hostSignalSummary(visibleMachineTemplates);
  const connectedMachineDetail = hostSignals.total
    ? `${connectedMachines} distinct Session API host machine(s), ${hostSignals.online}/${hostSignals.total} active host signal(s)`
    : 'No connected host machines returned by the Session API';
  const liveRuntimeBuckets = useMemo(
    () => buildLiveRuntimeBuckets(
      liveProbe?.jobs ?? [],
      liveProbe?.triggers ?? [],
      planningCapacity,
      liveProbe?.machines ?? [],
      initialTenantSlot.date,
      machineTemplateId,
    ),
    [planningCapacity, liveProbe, machineTemplateId],
  );
  const usingLiveRuntimeBuckets = liveHeatmapCurrent;
  const runtimeBucketSource = useMemo(() => {
    if (liveMode) return liveHeatmapCurrent ? liveRuntimeBuckets : [];
    return [];
  }, [liveHeatmapCurrent, liveMode, liveRuntimeBuckets]);
  const liveScheduleRisks = useMemo(
    () => buildLiveScheduleRisks(liveProbe?.triggers ?? [], planningCapacity),
    [planningCapacity, liveProbe],
  );
  const riskSource = liveMode && liveHeatmapCurrent ? liveScheduleRisks : [];

  const visibleRisks = useMemo(() => filterRisks(riskSource, folder), [folder, riskSource]);
  const dateOptions = useMemo(() => dateOptionsForRange(dateRange, liveMode), [dateRange, liveMode]);
  const focusDateOptions = useMemo(
    () => Array.from(new Set([...dateOptions, ...quarterDates])).filter((date) =>
      dateOptions.includes(date) || date === selectedDate || date === scenarioForm.preferredDate,
    ),
    [dateOptions, scenarioForm.preferredDate, selectedDate],
  );
  const templateBaseBuckets = useMemo(
    () => filterBucketsByTemplate(runtimeBucketSource, machineTemplateId),
    [machineTemplateId, runtimeBucketSource],
  );
  const rangeBaseBuckets = useMemo(
    () => filterBucketsByDateRange(templateBaseBuckets, dateRange, liveMode),
    [dateRange, liveMode, templateBaseBuckets],
  );
  const heatmapWeekDates = useMemo(() => (liveMode ? comparisonWeekDatesFor(heatmapAnchorDate) : weekDates), [liveMode]);
  const heatmapMonthDates = useMemo(() => (liveMode ? comparisonMonthDatesFor(heatmapAnchorDate) : monthDates), [liveMode]);
  const projectedRangeBuckets = useMemo(
    () => applyScenarioImpact(rangeBaseBuckets, submittedScenario, machineTemplateId),
    [machineTemplateId, rangeBaseBuckets, submittedScenario],
  );
  const heatmapBuckets = useMemo(
    () => applyScenarioImpact(templateBaseBuckets, submittedScenario, machineTemplateId),
    [machineTemplateId, submittedScenario, templateBaseBuckets],
  );
  const submittedScenarioImpact = useMemo(
    () => scenarioImpactSummary(submittedScenario, templateBaseBuckets, heatmapBuckets),
    [heatmapBuckets, submittedScenario, templateBaseBuckets],
  );
  const recommendations = useMemo(() => {
    const base = buildRecommendations(visibleRisks);
    if (!submittedScenario) return base;

    const scenarioRec: Recommendation = {
      id: 'what-if-impact',
      type: 'move-schedule',
      owner: 'Release Manager',
      title: `${submittedScenario.solutionName} changes ${formatDate(submittedScenario.preferredDate)} ${submittedScenario.preferredHour}:00 demand`,
      impact: `Adds ${submittedScenario.runtimeDemand} runtime(s) for about ${submittedScenario.durationMinutes} minutes. Review the highlighted heatmap tiles before choosing this slot.`,
      confidence: 'Medium',
      basis: liveMode
        ? 'User-submitted what-if overlay on the current live capacity view'
        : 'User-submitted what-if overlay waiting for live capacity data',
    };
    return [scenarioRec, ...base];
  }, [liveMode, submittedScenario, visibleRisks]);
  const projectedPeakDemand = peakDemand(projectedRangeBuckets);
  const planningUtilization = Math.round((projectedPeakDemand / planningCapacity) * 100);
  const riskWindows = projectedRangeBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;
  const folderRiskRows = groupRiskByFolder(visibleRisks);
  const selectedBucket = selectedTile ? bucketFor(selectedTile.date, selectedTile.hour, heatmapBuckets) : null;
  const allAvailableFolders = useMemo(
    () => (liveMode ? [allFoldersLabel, ...(liveProbe?.folders ?? [])] : [allFoldersLabel]),
    [liveMode, liveProbe],
  );
  const availableFolders = useMemo(
    () => allAvailableFolders.filter((folderOption) => folderIsConfiguredForTemplate(folderOption, selectedMachineTemplate)),
    [allAvailableFolders, selectedMachineTemplate],
  );
  const folderTreeNodes = useMemo(
    () => buildFolderTree(liveMode ? liveProbe?.folderDetails ?? [] : [], availableFolders, true),
    [availableFolders, liveMode, liveProbe],
  );
  const scenarioFolderOptions = useMemo(
    () => availableFolders.filter((item) => item !== allFoldersLabel),
    [availableFolders],
  );
  const selectedMachineTemplateName = machineTemplateId === 'all'
    ? 'All machines'
    : selectedMachineTemplate?.name ?? 'Selected machine';
  const orchestratorMachineMonitoringUrl = useMemo(
    () => buildOrchestratorMachineMonitoringUrl(selectedConnection),
    [selectedConnection],
  );
  const generateHeatmapDisabled = !liveMode || liveConnectionPhase === 'connecting' || liveConnectionPhase === 'generating';
  const connectionLabel = liveConnectionPhase === 'connecting'
    ? 'Connecting...'
    : liveConnectionPhase === 'generating'
      ? 'Generating...'
    : signedIn && liveProbe?.config
      ? `Live - ${liveProbe.config.tenantName}`
      : selectedTenantName ? `Not connected - ${selectedTenantName}` : 'Not connected';
  const dataSignals: DataSignal[] = (() => {
    if (liveConnectionPhase === 'connecting') {
      return [
        {
          id: 'live-connecting',
          tone: 'info',
          title: 'Connecting to UiPath',
          detail: 'Browser OAuth is starting or completing. If prompted, sign in with the target tenant user.',
        },
      ];
    }

    if (liveProbe?.status === 'connected' || liveProbe?.status === 'partial') {
      return [
        {
          id: 'live-connected',
          tone: liveProbe.status === 'connected' ? 'ok' : 'warning',
          title: liveProbe.mode === 'heatmap'
            ? liveProbe.status === 'connected' ? 'Heatmap generated' : 'Heatmap partially generated'
            : liveProbe.status === 'connected' ? 'Live discovery connected' : 'Live discovery partially connected',
          detail: liveProbe.mode === 'heatmap'
            ? `Scoped read returned ${liveProbe.processCount ?? 0} processes, ${liveProbe.jobCount ?? 0} jobs, ${liveProbe.triggers.length} triggers, ${liveProbe.machines.length} machine signal(s), ${liveProbe.sessions.length} session signal(s), and ${licenseAllocationStatus(liveProbe.tenantLicense)} runtime license allocation for ${liveProbe.scopeLabel}.`
            : `Discovery returned ${liveProbe.folders.length} folder signal(s), ${liveProbe.machines.length} machine signal(s), ${liveProbe.sessions.length} session signal(s), and ${licenseAllocationStatus(liveProbe.tenantLicense)} runtime license allocation. Generate the heatmap after choosing a folder and machine.`,
          timestamp: liveProbe.checkedAt,
        },
        {
          id: 'live-scope-gap',
          tone: liveHeatmapCurrent && liveRuntimeBuckets.length ? 'info' : 'warning',
          title: liveHeatmapCurrent
            ? liveRuntimeBuckets.length ? 'Live heatmap demand' : 'No live heatmap rows yet'
            : liveHeatmapGenerated ? 'Heatmap scope changed' : 'Heatmap not generated',
          detail: liveHeatmapCurrent && liveRuntimeBuckets.length
            ? 'Heatmap observed demand is derived from live recent jobs returned by readable folders.'
            : liveHeatmapGenerated
              ? 'Filters changed after the last generation. Click Generate heatmap to refresh this folder/machine scope.'
              : 'The app is signed in with discovery data only. Click Generate heatmap to retrieve jobs and triggers for the selected scope.',
        },
        {
          id: 'live-messages',
          tone: liveProbe.messages.some((message) => message.toLowerCase().includes('failed')) ? 'error' : 'info',
          title: 'Connector detail',
          detail: liveProbe.messages.join(' '),
        },
      ];
    }

    if (liveProbe?.status === 'not-configured' || liveProbe?.status === 'error') {
      return [
        {
          id: 'live-error',
          tone: 'error',
          title: liveProbe.status === 'not-configured' ? 'Live API config missing' : 'Live API connection failed',
          detail: liveProbe.messages.join(' '),
          timestamp: liveProbe.checkedAt,
        },
      ];
    }

    return signedIn
      ? [
        {
          id: 'live-waiting',
          tone: 'warning',
          title: 'Live data not loaded',
          detail: 'Sign in or refresh the configured tenant connection to load license, folder, machine, session, job, and trigger data.',
        },
      ]
      : [
        {
          id: 'auth-required',
          tone: 'info',
          title: 'Sign in required',
          detail: 'Click Sign in to load the single tenant configured for this connection. No tokens or secrets are stored by this app.',
        },
      ];
  })();
  const heatmapSourceDetail = liveMode
    ? liveHeatmapCurrent
      ? liveRuntimeBuckets.length
        ? `Live observed job history for ${liveProbe?.scopeLabel ?? 'the selected scope'}.`
        : `Live connected to ${liveProbe?.config?.tenantName ?? selectedTenantName}, but no readable job history was returned for ${liveProbe?.scopeLabel ?? 'this scope'}.`
      : liveHeatmapGenerated
        ? 'Filters changed after the last live read. Generate the heatmap again to refresh this scope.'
        : 'Live discovery loaded. Generate the heatmap to retrieve scoped job and trigger data.'
    : 'Sign in to load live tenant capacity data.';
  const dataHealth = dataHealthSummary(dataSignals);
  const diagnosticsAvailable = Boolean(liveProbe);

  useEffect(() => {
    if (!availableFolders.includes(folder)) setFolder(availableFolders[0] ?? allFoldersLabel);
  }, [availableFolders, folder]);

  useEffect(() => {
    if (machineTemplateId !== 'all' && !allMachineTemplates.some((template) => template.id === machineTemplateId)) {
      setMachineTemplateId('all');
    }
    const scenarioTemplateExists = visibleMachineTemplates.some((template) => template.id === scenarioForm.machineTemplateId);
    const scenarioFolderExists = scenarioFolderOptions.includes(scenarioForm.folder);

    if (!scenarioTemplateExists || !scenarioFolderExists) {
      setScenarioForm((current) => ({
        ...current,
        folder: scenarioFolderExists ? current.folder : scenarioFolderOptions[0] ?? '',
        machineTemplateId: scenarioTemplateExists
          ? current.machineTemplateId
          : visibleMachineTemplates[0]?.id ?? 'all',
      }));
    }
  }, [allMachineTemplates, machineTemplateId, scenarioFolderOptions, scenarioForm.folder, scenarioForm.machineTemplateId, visibleMachineTemplates]);

  useEffect(() => {
    saveConnectionProfiles(connectionProfiles);
  }, [connectionProfiles]);

  useEffect(() => {
    if (!connectionProfiles.some((connection) => connection.id === selectedConnectionId)) {
      setSelectedConnectionId(connectionProfiles[0]?.id ?? defaultConnectionProfile().id);
    }
  }, [connectionProfiles, selectedConnectionId]);

  useEffect(() => {
    window.localStorage.setItem(selectedConnectionStorageKey, selectedConnectionId);
  }, [selectedConnectionId]);

  useEffect(() => {
    const hasLiveSessionIntent = window.localStorage.getItem(liveSessionStorageKey) === selectedConnectionId;
    if (!signedIn && !hasLiveSessionIntent) {
      window.sessionStorage.removeItem(heatmapCacheSessionStorageKey);
      return;
    }
    saveHeatmapCache(heatmapCache);
  }, [heatmapCache, selectedConnectionId, signedIn]);

  useEffect(() => {
    if (restoringSessionRef.current || signedIn || !selectedConnection) return;

    const params = new URLSearchParams(window.location.search);
    const hasOAuthCallback = params.has('code') || params.has('state');
    const shouldRestoreSession = window.localStorage.getItem(liveSessionStorageKey) === selectedConnectionId;

    if (hasOAuthCallback || shouldRestoreSession) {
      restoringSessionRef.current = true;
      void connectLiveEnvironment({ preserveHeatmapCache: true });
    }
  }, [selectedConnection, selectedConnectionId, signedIn]);

  useEffect(() => {
    if (!liveMode || !cachedHeatmapProbe || liveProbe === cachedHeatmapProbe) return;
    setLiveProbe(cachedHeatmapProbe);
    setGeneratedHeatmapScope({ folder, machineTemplateId });
  }, [cachedHeatmapProbe, folder, liveMode, liveProbe, machineTemplateId]);

  function alignSelectedSlot(tile: SelectedTile, nextGrain?: TimeGrain) {
    setSelectedTile(tile);
    setSelectedDate(tile.date);
    if (nextGrain) setGrain(nextGrain);
  }

  function selectTile(tile: SelectedTile, nextGrain?: TimeGrain) {
    alignSelectedSlot(tile, nextGrain);
    setScenarioAdvice(null);
    setScenarioForm((current) => ({
      ...current,
      preferredDate: tile.date,
      preferredHour: tile.hour,
    }));
  }

  function selectMachine(nextMachineTemplateId: string) {
    setMachineTemplateId(nextMachineTemplateId);
    if (nextMachineTemplateId === 'all') return;

    const nextMachine = allMachineTemplates.find((template) => template.id === nextMachineTemplateId) ?? null;
    if (!nextMachine || folderIsConfiguredForTemplate(folder, nextMachine)) return;

    setFolder(allFoldersLabel);
  }

  function changeHeatmapGrain(nextGrain: TimeGrain) {
    setGrain(nextGrain);
    if (nextGrain === 'day') {
      alignSelectedSlot(initialTenantSlot);
    }
  }

  function updateScenarioForm(nextScenario: WhatIfScenario) {
    const dateChanged = nextScenario.preferredDate !== scenarioForm.preferredDate;
    const hourChanged = nextScenario.preferredHour !== scenarioForm.preferredHour;

    setScenarioForm(nextScenario);
    setScenarioAdvice(null);

    if (dateChanged || hourChanged) {
      alignSelectedSlot({ date: nextScenario.preferredDate, hour: nextScenario.preferredHour }, 'day');
    }
  }

  function submitScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedScenario(scenarioForm);
    alignSelectedSlot({ date: scenarioForm.preferredDate, hour: scenarioForm.preferredHour }, 'day');
  }

  function generateScenarioAdvice() {
    setScenarioAdvice(buildScenarioAdvisorRecommendation(scenarioForm, templateBaseBuckets));
  }

  function applyScenarioAdvice(advice: ScenarioAdvisorRecommendation) {
    const nextScenario = {
      ...scenarioForm,
      preferredDate: advice.recommendedDate,
      preferredHour: advice.recommendedHour,
    };
    setScenarioForm(nextScenario);
    alignSelectedSlot({ date: advice.recommendedDate, hour: advice.recommendedHour }, 'day');
  }

  function resetScenario() {
    setScenarioForm({
      ...emptyScenario,
      folder: scenarioFolderOptions[0] ?? (liveMode ? '' : emptyScenario.folder),
      machineTemplateId: visibleMachineTemplates[0]?.id ?? (liveMode ? 'all' : emptyScenario.machineTemplateId),
    });
    setSubmittedScenario(null);
    setScenarioAdvice(null);
    alignSelectedSlot(initialTenantSlot, 'day');
  }

  async function connectLiveEnvironment(options: { preserveHeatmapCache?: boolean } = {}) {
    if (!selectedConnection) {
      setConnectionModalOpen(true);
      setConnectionModalMode('edit');
      return;
    }

    setLiveConnectionPhase('connecting');
    setShowDiagnostics(false);
    window.localStorage.setItem(liveSessionStorageKey, selectedConnectionId);
    const result = await probeLiveOrchestrator(connectionToProbeConfig(selectedConnection), { mode: 'discovery' });
    setLiveProbe(result);
    setGeneratedHeatmapScope(null);
    if (!options.preserveHeatmapCache) setHeatmapCache({});
    setSignedIn(result.authenticated && (result.status === 'connected' || result.status === 'partial'));
    setLiveConnectionPhase(
      result.status === 'connected'
        ? 'connected'
        : result.status === 'partial'
          ? 'partial'
          : result.status === 'authenticating'
            ? 'connecting'
            : 'error',
    );
    if (result.authenticated && (result.status === 'connected' || result.status === 'partial')) {
      setConnectionModalOpen(false);
      window.localStorage.setItem(liveSessionStorageKey, selectedConnectionId);
    } else if (result.status !== 'authenticating') {
      window.localStorage.removeItem(liveSessionStorageKey);
    }
  }

  async function generateHeatmap() {
    if (!selectedConnection || !liveMode) {
      openSignInDialog();
      return;
    }

    const nextScope = { folder, machineTemplateId };
    const cacheKey = currentHeatmapCacheKey;
    if (heatmapCache[cacheKey]) {
      setLiveProbe(heatmapCache[cacheKey]);
      setGeneratedHeatmapScope(nextScope);
      return;
    }
    if (inFlightHeatmapScopesRef.current.has(cacheKey)) return;

    inFlightHeatmapScopesRef.current.add(cacheKey);
    setLiveConnectionPhase('generating');
    try {
      const result = await probeLiveOrchestrator(connectionToProbeConfig(selectedConnection), {
        mode: 'heatmap',
        selectedFolder: folder,
        selectedMachineTemplateId: machineTemplateId,
        selectedMachineTemplateName,
      });
      setLiveProbe(result);
      setSignedIn(result.authenticated && (result.status === 'connected' || result.status === 'partial'));
      if (result.authenticated && (result.status === 'connected' || result.status === 'partial')) {
        setGeneratedHeatmapScope(nextScope);
        setHeatmapCache((current) => ({ ...current, [cacheKey]: result }));
      }
      setLiveConnectionPhase(
        result.status === 'connected'
          ? 'connected'
          : result.status === 'partial'
            ? 'partial'
            : result.status === 'authenticating'
              ? 'connecting'
              : 'error',
      );
    } finally {
      inFlightHeatmapScopesRef.current.delete(cacheKey);
    }
  }

  function disconnectLiveEnvironment() {
    logoutLiveOrchestrator();
    setSignedIn(false);
    setLiveProbe(null);
    setGeneratedHeatmapScope(null);
    setHeatmapCache({});
    inFlightHeatmapScopesRef.current.clear();
    window.localStorage.removeItem(liveSessionStorageKey);
    window.sessionStorage.removeItem(heatmapCacheSessionStorageKey);
    setLiveConnectionPhase('idle');
    setShowDiagnostics(false);
  }

  function openSignInDialog() {
    setConnectionDraft(selectedConnection ?? defaultConnectionProfile());
    setConnectionModalMode('manage');
    setConnectionModalOpen(true);
  }

  function startAddConnection() {
    setConnectionDraft({
      ...defaultConnectionProfile(),
      id: `connection-${Date.now()}`,
      name: 'New connection',
      organization: '',
      tenants: '',
      clientId: '',
    });
    setConnectionModalMode('edit');
  }

  function startEditConnection() {
    setConnectionDraft(selectedConnection ?? defaultConnectionProfile());
    setConnectionModalMode('edit');
  }

  function saveConnectionDraft() {
    const normalizedDraft = {
      ...connectionDraft,
      name: connectionDraft.organization.trim() || connectionDraft.name.trim() || 'UiPath connection',
      platformUrl: connectionDraft.platformUrl.trim().replace(/\/$/, ''),
      organization: connectionDraft.organization.trim(),
      tenants: tenantNameFromConnection(connectionDraft),
      clientId: connectionDraft.clientId.trim(),
      environment: inferEnvironment(connectionDraft.platformUrl),
    };

    const nextProfiles = connectionProfiles.some((connection) => connection.id === normalizedDraft.id)
      ? connectionProfiles.map((connection) => (connection.id === normalizedDraft.id ? normalizedDraft : connection))
      : [...connectionProfiles, normalizedDraft];

    setConnectionProfiles(nextProfiles);
    setSelectedConnectionId(normalizedDraft.id);
    setHeatmapCache({});
    if (signedIn) disconnectLiveEnvironment();
    setConnectionModalMode('manage');
  }

  function resetConnections() {
    const defaultProfile = defaultConnectionProfile();
    setConnectionProfiles([defaultProfile]);
    setSelectedConnectionId(defaultProfile.id);
    setConnectionDraft(defaultProfile);
    disconnectLiveEnvironment();
  }

  function removeSelectedConnection() {
    const nextProfiles = connectionProfiles.filter((connection) => connection.id !== selectedConnectionId);
    const fallbackProfile = nextProfiles[0] ?? defaultConnectionProfile();
    const safeProfiles = nextProfiles.length ? nextProfiles : [fallbackProfile];
    setConnectionProfiles(safeProfiles);
    setSelectedConnectionId(fallbackProfile.id);
    setConnectionDraft(fallbackProfile);
    disconnectLiveEnvironment();
  }

  function selectConnection(connectionId: string) {
    if (connectionId !== selectedConnectionId) {
      disconnectLiveEnvironment();
    }
    setSelectedConnectionId(connectionId);
  }

  function downloadAggregatedData() {
    const exportedAt = new Date().toISOString();
    const filename = [
      'runtime-capacity',
      safeFilePart(selectedTenantName),
      safeFilePart(formatFolderDisplayName(folder)),
      safeFilePart(selectedMachineTemplateName),
      exportedAt.slice(0, 10),
    ].join('-') + '.json';
    const runtimeBucketsForExport = projectedRangeBuckets.map((bucket) => {
      const utilization = utilizationPercent(bucket);
      return {
        ...bucket,
        utilizationPercent: utilization,
        risk: riskFromPercent(utilization),
      };
    });
    const selectedBucketUtilization = selectedBucket ? utilizationPercent(selectedBucket) : null;

    downloadJsonFile(filename, {
      schemaVersion: 1,
      exportedAt,
      source: {
        mode: liveMode ? 'live' : 'not-connected',
        status: liveProbe?.status ?? 'not-connected',
        connection: connectionLabel,
        probeMode: liveProbe?.mode ?? null,
        scope: liveProbe?.scopeLabel ?? null,
        checkedAt: liveProbe?.checkedAt ?? null,
      },
      filters: {
        tenant: selectedTenantName,
        folder,
        machineTemplateId,
        machineTemplateName: selectedMachineTemplateName,
        dateRange,
        timeGrain: grain,
        riskView,
        timezone: tenantTimezoneLabel,
      },
      summary: {
        licenseAllocation,
        licenseLabel: tenantLicense?.label ?? 'Unavailable',
        licenseProductCode: tenantLicense?.productCode ?? 'unavailable',
        licenseSource: tenantLicense?.source ?? 'unavailable',
        configuredMaxCapacity,
        templateRuntimeSlots,
        connectedMachines,
        planningCapacity,
        planningUtilization,
        hostSignals,
        projectedPeakDemand,
        riskWindows,
        runtimeBucketCount: runtimeBucketsForExport.length,
        scheduleRiskCount: visibleRisks.length,
        recommendationCount: recommendations.length,
      },
      selectedSlot: {
        ...selectedTile,
        bucket: selectedBucket
          ? {
            ...selectedBucket,
            utilizationPercent: selectedBucketUtilization,
            risk: selectedBucketUtilization === null ? null : riskFromPercent(selectedBucketUtilization),
          }
          : null,
      },
      runtimeBuckets: runtimeBucketsForExport,
      scheduleRiskSummary: folderRiskRows,
      scheduleRisks: visibleRisks,
      machineInventory: visibleMachineTemplates,
      recommendations,
      submittedScenario,
      submittedScenarioImpact,
      dataSignals,
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BarChart3 size={22} />
          </div>
          <div className="brand-copy">
            <div className="brand-headline">
              <h1>Runtime Capacity Intelligence</h1>
            </div>
            <p>Read-only UiPath schedule, runtime, and SLA planning</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className={`button secondary diagnose-button data-health-${dataHealth.tone} ${showDiagnostics ? 'active-toggle' : ''}`}
            type="button"
            onClick={() => diagnosticsAvailable && setShowDiagnostics((current) => !current)}
            aria-expanded={showDiagnostics}
            aria-controls="api-diagnostics-panel"
            disabled={!diagnosticsAvailable}
            title={dataHealth.detail}
          >
            {dataSignalIcon(dataHealth.tone)}
            <span>{showDiagnostics ? 'Hide Diagnose' : 'Diagnose'}</span>
            <strong>{dataHealth.statusLabel}</strong>
          </button>
          <div className="session-chip">
            <ShieldCheck size={16} />
            {connectionLabel}
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={downloadAggregatedData}
            title="Download the current aggregated dataset as JSON"
          >
            <Download size={16} />
            Download JSON
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={signedIn ? disconnectLiveEnvironment : openSignInDialog}
            disabled={liveConnectionPhase === 'connecting' || liveConnectionPhase === 'generating'}
          >
            {signedIn ? <LogOut size={16} /> : <LogIn size={16} />}
            {signedIn ? 'Sign out' : 'Sign in'}
          </button>
        </div>
      </header>

      <main>
        <section className="filters-panel" aria-label="Permission scoped filters">
          <FolderTreeSelect
            label="Folder"
            nodes={folderTreeNodes}
            value={folder}
            onChange={setFolder}
          />
          <MachineSelect
            label="Machine"
            machines={machineFilterOptions}
            value={machineTemplateId}
            onChange={selectMachine}
          />
          <label>
            <span>Date Range</span>
            <select value={defaultDateRange} disabled aria-label="Date range locked to Last month">
              {dateRanges.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <div className="filter-action">
            <button
              className="button primary"
              type="button"
              onClick={() => void generateHeatmap()}
              disabled={generateHeatmapDisabled}
              title={liveMode ? `Generate heatmap for ${folder} / ${selectedMachineTemplateName}` : 'Sign in to discover folders before generating the heatmap'}
            >
              <RefreshCw size={16} />
              {liveConnectionPhase === 'generating'
                ? 'Generating...'
                : currentScopeHasCache && !liveHeatmapCurrent
                  ? 'Load cached heatmap'
                  : 'Generate heatmap'}
            </button>
            <span>
              {liveHeatmapCurrent
                ? 'Current scope loaded'
                : currentScopeHasCache
                  ? 'Retrieved data remembered'
                  : liveMode ? 'Runs scoped job and trigger reads' : 'Sign in first'}
            </span>
          </div>
          <div className="access-note">
            <CheckCircle2 size={16} />
            Tenant comes from the selected sign-in connection. Select folder and machine scope, then generate the heatmap.
          </div>
        </section>

        {showDiagnostics && liveProbe ? <ApiDiagnosticsPanel probe={liveProbe} /> : null}

        <section className="kpi-grid" aria-label="Capacity summary">
          <MetricCard label={licenseAllocationLabel(tenantLicense)} value={capacityDisplay(licenseAllocation)} detail={tenantLicense?.message ?? 'License API not returned'} icon={<ShieldCheck />} />
          <MetricCard label="Configured Max Capacity" value={configuredMaxCapacity} detail={`${templateRuntimeSlots} template slot(s), ${connectedMachines} distinct Session API host machine(s)`} icon={<Cpu />} />
          <MetricCard label="Actual Peak Demand" value={projectedPeakDemand} detail="Observed jobs plus what-if overlay" icon={<Clock3 />} />
          <MetricCard label="Utilization" value={`${planningUtilization}%`} detail={`Against planning capacity ${planningCapacity}`} icon={<BarChart3 />} />
          <MetricCard label="Risk Windows" value={riskWindows} detail="Hourly buckets at or above 85%" icon={<AlertTriangle />} tone="warn" />
        </section>

        <section className="workspace-grid single-column">
          <div className="main-column">
            <section className="panel">
              <PanelHeader
                icon={<CalendarClock size={18} />}
                title="Runtime Heatmap"
                subtitle={`${heatmapSourceDetail} All dates and hours use ${tenantTimezoneLabel}.`}
              />
              <div className="heatmap-planner-grid">
                <div>
                  <div className="heatmap-toolbar">
                    <SegmentedControl
                      items={grains}
                      value={grain}
                      onChange={changeHeatmapGrain}
                      labelFormatter={(item) => item.charAt(0).toUpperCase() + item.slice(1)}
                    />
                    {grain === 'day' ? (
                      <label className="inline-filter">
                        <span>Focus date</span>
                        <select
                          value={selectedDate}
                          onChange={(event) => {
                            selectTile({ date: event.target.value, hour: selectedTile.hour });
                          }}
                        >
                          {focusDateOptions.map((date) => (
                            <option key={date} value={date}>{formatDate(date)}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  {grain === 'month' ? (
                    <MonthCalendar
                      buckets={heatmapBuckets}
                      dates={heatmapMonthDates}
                      liveHistorical={liveMode}
                      selectedDate={selectedDate}
                      onDateClick={(date, hour) => selectTile({ date, hour }, 'day')}
                    />
                  ) : grain === 'week' ? (
                    <WeekCapacityView
                      buckets={heatmapBuckets}
                      dates={heatmapWeekDates}
                      liveHistorical={liveMode}
                      selectedDate={selectedDate}
                      onDateClick={(date, hour) => selectTile({ date, hour }, 'day')}
                    />
                  ) : (
                    <DayTimeline
                      buckets={heatmapBuckets}
                      date={selectedDate}
                      liveHistorical={liveMode}
                      selectedTile={selectedTile}
                      onTileClick={(tile) => selectTile(tile)}
                    />
                  )}
                  {selectedBucket ? (
                    <div className="tile-detail">
                      <strong>{formatDate(selectedTile.date, 'long')} {selectedTile.hour}:00 detail</strong>
                      <span>{utilizationPercent(selectedBucket)}% utilization</span>
                      <span>
                        {liveMode && isFutureDate(selectedBucket.date)
                          ? `Scheduled ${selectedBucket.projectedDemand} / capacity ${selectedBucket.capacity}`
                          : liveMode
                            ? `Peak consumed ${selectedBucket.observedDemand} / capacity ${selectedBucket.capacity}`
                          : `Peak consumed ${selectedBucket.observedDemand} / projected ${selectedBucket.projectedDemand} / capacity ${selectedBucket.capacity}`}
                      </span>
                      <span>Drivers: {selectedBucket.topDrivers.join(', ')}</span>
                    </div>
                  ) : (
                    <div className="tile-detail">
                      <strong>{formatDate(selectedTile.date, 'long')} {selectedTile.hour}:00 detail</strong>
                      <span>No data</span>
                    </div>
                  )}
                  {submittedScenario && submittedScenarioImpact ? (
                    <ScenarioImpactCard scenario={submittedScenario} impact={submittedScenarioImpact} />
                  ) : null}
                </div>
                <WhatIfPlanner
                  advisorRecommendation={scenarioAdvice}
                  folderOptions={scenarioFolderOptions}
                  machineTemplates={visibleMachineTemplates}
                  scenario={scenarioForm}
                  onApplyRecommendation={applyScenarioAdvice}
                  onChange={updateScenarioForm}
                  onGenerateRecommendation={generateScenarioAdvice}
                  onReset={resetScenario}
                  onSubmit={submitScenario}
                />
              </div>
            </section>

            <section className="panel">
              <PanelHeader
                icon={<Sparkles size={18} />}
                title="Dynamic Observations and Recommendations"
                subtitle="Updated after filters and what-if scenario submission"
              />
              <div className="recommendation-grid">
                {recommendations.map((recommendation) => (
                  <article className="recommendation-card" key={recommendation.id}>
                    <div className="rec-header">
                      <span className="rec-type">{formatRecommendationType(recommendation.type)}</span>
                      <span className="confidence">{recommendation.confidence}</span>
                    </div>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.impact}</p>
                    <dl>
                      <div>
                        <dt>Owner</dt>
                        <dd>{recommendation.owner}</dd>
                      </div>
                      <div>
                        <dt>Basis</dt>
                        <dd>{recommendation.basis}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHeader
                icon={<AlertTriangle size={18} />}
                title="Schedule vs Runtime Risk"
                subtitle="Switch between folder, process, job, and SLA exception views"
              />
              <SegmentedControl
                items={riskViews}
                value={riskView}
                onChange={setRiskView}
                labelFormatter={(item) => (item === 'sla' ? 'SLA exceptions' : item.charAt(0).toUpperCase() + item.slice(1))}
              />
              {riskView === 'folder' ? (
                <SearchableTable
                  rows={folderRiskRows}
                  pageSize={8}
                  searchPlaceholder="Search folders"
                  emptyText={liveMode ? 'No live schedule risk rows returned for readable folders.' : 'No schedule risk rows match this filter.'}
                  getKey={(row) => row.folder}
                  columns={[
                    { header: 'Folder', value: (row) => row.folder, render: (row) => row.folder },
                    { header: 'Peak Demand', value: (row) => row.peakDemand, render: (row) => `${row.peakDemand} runtimes` },
                    { header: 'Late Jobs', value: (row) => row.lateJobs, render: (row) => row.lateJobs },
                    { header: 'Risk', value: (row) => row.highestRisk, render: (row) => <RiskPill risk={row.highestRisk} /> },
                  ]}
                />
              ) : (
                <SearchableTable
                  rows={visibleRisks.filter((risk) => riskView !== 'sla' || risk.projectedLateMinutes > 0)}
                  pageSize={8}
                  searchPlaceholder="Search automations, folders, causes"
                  emptyText={liveMode ? 'No live trigger risk rows returned for this view.' : 'No schedule risk rows match this filter.'}
                  getKey={(risk) => risk.id}
                  columns={[
                    { header: riskView === 'sla' ? 'SLA Exception' : 'Automation', value: (risk) => risk.process, render: (risk) => risk.process },
                    { header: 'Folder', value: (risk) => risk.folder, render: (risk) => risk.folder },
                    { header: 'Next Run', value: (risk) => risk.nextRun, render: (risk) => risk.nextRun },
                    { header: 'Late By', value: (risk) => risk.projectedLateMinutes, render: (risk) => (risk.projectedLateMinutes ? `${risk.projectedLateMinutes} min` : '-') },
                    { header: 'Cause', value: (risk) => risk.cause, render: (risk) => risk.cause },
                    { header: 'Risk', value: (risk) => risk.risk, render: (risk) => <RiskPill risk={risk.risk} /> },
                  ]}
                />
              )}
            </section>

            <section className="panel">
              <PanelHeader
                icon={<Server size={18} />}
                title="Machine and Runtime Inventory"
                subtitle="Configured max capacity is machine-template runtime slots multiplied by connected machines; license allocation remains tenant-level"
              />
              <div className="inventory-summary">
                <MiniStat label="Machines" value={visibleMachineTemplates.length} detail={liveMode ? 'Live tenant data' : 'Sign in to load'} />
                <MiniStat label="Runtime License" value={licenseRuntimeLabel} detail={licenseRuntimeDetail} />
                <MiniStat label="Template Slots" value={templateRuntimeSlots} detail="Runtime slots per template summed" />
                <MiniStat label="Connected Machines" value={connectedMachines} detail={connectedMachineDetail} />
                <MiniStat label="Configured Max" value={configuredMaxCapacity} detail="Slots multiplied by connected machines" />
              </div>
              <OrchestratorMonitoringHandoff href={orchestratorMachineMonitoringUrl} />
            </section>
          </div>
        </section>
      </main>
      {connectionModalOpen ? (
        <ConnectionModal
          activeTenant={selectedTenantName}
          connectionDraft={connectionDraft}
          connections={connectionProfiles}
          mode={connectionModalMode}
          selectedConnectionId={selectedConnectionId}
          signedIn={signedIn}
          liveConnectionPhase={liveConnectionPhase}
          onBack={() => setConnectionModalMode('manage')}
          onChangeDraft={setConnectionDraft}
          onClose={() => setConnectionModalOpen(false)}
          onEdit={startEditConnection}
          onRemove={removeSelectedConnection}
          onReset={resetConnections}
          onSave={saveConnectionDraft}
          onSelectConnection={selectConnection}
          onSignIn={connectLiveEnvironment}
          onStartAdd={startAddConnection}
        />
      ) : null}
    </div>
  );
}

function ApiDiagnosticsPanel({ probe }: { probe: LiveProbeResult }) {
  return (
    <section className="panel api-diagnostics-panel" id="api-diagnostics-panel" aria-label="Live Orchestrator API diagnostics">
      <PanelHeader
        icon={<Info size={18} />}
        title="API Diagnostics"
        subtitle={`Signed in to ${probe.config?.tenantName ?? 'tenant'}. Review read-only Orchestrator calls, status codes, and response previews.`}
      />
      <div className="api-summary-strip">
        <span>Folders discovered: {probe.folderDetails.length}</span>
        <span>Visible folders: {probe.folders.length ? probe.folders.slice(0, 4).join(', ') : 'none'}</span>
        <span>Records mapped: {probe.jobs.length} job(s), {probe.processes.length} process(es), {probe.machines.length} machine(s), {probe.triggers.length} trigger(s)</span>
      </div>
      <SearchableTable
        rows={probe.apiCalls}
        pageSize={8}
        searchPlaceholder="Search API calls, folders, status, result"
        emptyText="No API diagnostics captured yet. Sign in or refresh the live read."
        getKey={(call) => call.id}
        columns={[
          { header: 'Endpoint', value: (call) => call.endpoint, render: (call) => call.endpoint },
          { header: 'Folder', value: (call) => `${call.folderName ?? ''} ${call.folderId ?? ''}`, render: (call) => call.folderName ?? 'Tenant scope' },
          {
            header: 'Status',
            value: (call) => `${call.status} ${call.statusCode ?? ''} ${call.statusText}`,
            render: (call) => (
              <span className={`pill ${call.status === 'success' ? 'tone-low' : call.status === 'skipped' ? 'tone-medium' : 'tone-high'}`}>
                {call.statusCode ? `${call.statusCode} ` : ''}{call.statusText || call.status}
              </span>
            ),
          },
          {
            header: 'Result',
            value: (call) => `${call.resultSummary} ${call.responsePreview}`,
            render: (call) => (
              <div className="api-result">
                <strong>{call.resultSummary}</strong>
                {call.responsePreview ? <small>{call.responsePreview}</small> : null}
              </div>
            ),
          },
          {
            header: 'Original API Call',
            value: (call) => call.url,
            render: (call) => <code className="api-url">{call.method} {call.url}</code>,
          },
        ]}
      />
      <div className="api-message-list">
        {probe.messages.map((message, index) => (
          <span key={`${message}-${index}`}>{message}</span>
        ))}
      </div>
    </section>
  );
}

function dataHealthSummary(signals: DataSignal[]) {
  const errorCount = signals.filter((signal) => signal.tone === 'error').length;
  const warningCount = signals.filter((signal) => signal.tone === 'warning').length;
  const primarySignal = signals.find((signal) => signal.tone === 'error')
    ?? signals.find((signal) => signal.tone === 'warning')
    ?? signals[0];
  const statusLabel = errorCount
    ? `${errorCount} issue${errorCount > 1 ? 's' : ''}`
    : warningCount
      ? `${warningCount} warning${warningCount > 1 ? 's' : ''}`
      : 'Healthy';
  const tone = primarySignal?.tone ?? 'ok';
  const detail = signals.map((signal) => `${signal.title}: ${signal.detail}`).join('\n') || statusLabel;
  return { detail, statusLabel, tone };
}

function FolderTreeSelect({
  label,
  nodes,
  value,
  onChange,
}: {
  label: string;
  nodes: FolderTreeNode[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const fieldRef = useRef<HTMLDivElement>(null);
  const selectedNode = findFolderTreeNode(nodes, value);
  const selectedLabel = formatFolderDisplayName(selectedNode?.path ?? value);
  const selectedTitle = formatFolderPathDisplay(selectedNode?.path ?? value);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setExpandedNodeIds(new Set(nodes.map((node) => node.id)));
  }, [nodes, open]);

  function toggleNode(nodeId: string) {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  const renderNodes = (items: FolderTreeNode[], depth = 0): React.ReactNode => items.map((node) => {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && expandedNodeIds.has(node.id);
    const selected = node.value === value;

    return (
      <div key={node.id} role="none">
        <div
          className={`folder-tree-node ${selected ? 'selected' : ''} ${node.selectable ? '' : 'folder-tree-group'}`}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={hasChildren ? expanded : undefined}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          title={node.path}
        >
          <button
            className="folder-tree-toggle"
            type="button"
            disabled={!hasChildren}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${formatFolderDisplayName(node.label)}`}
            onClick={() => toggleNode(node.id)}
          >
            {hasChildren ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="tree-node-spacer" />}
          </button>
          <button
            className="folder-tree-select-button"
            disabled={!node.selectable}
            type="button"
            onClick={() => {
              onChange(node.value);
              setOpen(false);
            }}
          >
            <FolderTree size={14} />
            <span className="folder-tree-node-copy">
              <span className="folder-tree-node-label">{formatFolderDisplayName(node.label)}</span>
              {node.selectable && node.path !== node.label ? (
                <span className="folder-tree-node-path">{formatFolderPathDisplay(node.path)}</span>
              ) : null}
            </span>
          </button>
        </div>
        {expanded ? renderNodes(node.children, depth + 1) : null}
      </div>
    );
  });

  return (
    <div className="folder-tree-field" ref={fieldRef}>
      <span>{label}</span>
      <button
        className="folder-tree-trigger"
        type="button"
        aria-haspopup="tree"
        aria-expanded={open}
        title={selectedTitle}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedLabel || 'No folders returned'}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="folder-tree-popover" role="tree" aria-label={label}>
          {nodes.length ? renderNodes(nodes) : <div className="folder-tree-empty">No folders returned</div>}
        </div>
      ) : null}
    </div>
  );
}

function MachineSelect({
  label,
  machines,
  value,
  onChange,
}: {
  label: string;
  machines: MachineTemplate[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const selectedMachine = machines.find((machine) => machine.id === value) ?? null;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  return (
    <div className="machine-select-field" ref={fieldRef}>
      <span>{label}</span>
      <button
        className="machine-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedMachine ? `${selectedMachine.name} (${selectedMachine.machineType || 'Machine'})` : 'All machines'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="machine-select-name" title={selectedMachine?.name ?? 'All machines'}>
          {selectedMachine?.name ?? 'All machines'}
        </span>
        {selectedMachine ? (
          <span className="machine-type-tag" title={selectedMachine.machineType || 'Machine'}>
            {machineTypeLabel(selectedMachine)}
          </span>
        ) : null}
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="machine-select-popover" role="listbox" aria-label={label}>
          <button
            className={`machine-select-option ${value === 'all' ? 'selected' : ''}`}
            type="button"
            role="option"
            aria-selected={value === 'all'}
            title="All machines"
            onClick={() => {
              onChange('all');
              setOpen(false);
            }}
          >
            <span className="machine-select-name">All machines</span>
          </button>
          {machines.map((machine) => (
            <button
              key={machine.id}
              className={`machine-select-option ${value === machine.id ? 'selected' : ''}`}
              type="button"
              role="option"
              aria-selected={value === machine.id}
              title={`${machine.name} (${machine.machineType || 'Machine'})`}
              onClick={() => {
                onChange(machine.id);
                setOpen(false);
              }}
            >
              <span className="machine-select-name" title={machine.name}>{machine.name}</span>
              <span className="machine-type-tag" title={machine.machineType || 'Machine'}>{machineTypeLabel(machine)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchableTable<T>({
  rows,
  columns,
  getKey,
  searchPlaceholder,
  emptyText,
  pageSize = 8,
}: {
  rows: T[];
  columns: SearchableTableColumn<T>[];
  getKey: (row: T) => string | number;
  searchPlaceholder: string;
  emptyText: string;
  pageSize?: number;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) =>
      columns
        .map((column) => column.value(row) ?? '')
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
    : rows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, rows.length]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="searchable-table">
      <div className="table-tools">
        <input
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{filteredRows.length} of {rows.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.length ? pageRows.map((row) => (
            <tr key={getKey(row)}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={columns.length}>{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="table-footer">
        <span>
          {filteredRows.length
            ? `Showing ${start + 1}-${Math.min(start + pageRows.length, filteredRows.length)}`
            : 'No rows to show'}
        </span>
        <div className="pager">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            Previous
          </button>
          <span>{safePage} / {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: React.ReactNode;
  tone?: 'warn';
}) {
  return (
    <article className={`metric-card ${tone === 'warn' ? 'metric-warn' : ''}`}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      <p>{subtitle}</p>
    </div>
  );
}

function ConnectionModal({
  activeTenant,
  connectionDraft,
  connections,
  liveConnectionPhase,
  mode,
  selectedConnectionId,
  signedIn,
  onBack,
  onChangeDraft,
  onClose,
  onEdit,
  onRemove,
  onReset,
  onSave,
  onSelectConnection,
  onSignIn,
  onStartAdd,
}: {
  activeTenant: string;
  connectionDraft: ConnectionProfile;
  connections: ConnectionProfile[];
  liveConnectionPhase: LiveConnectionPhase;
  mode: ConnectionModalMode;
  selectedConnectionId: string;
  signedIn: boolean;
  onBack: () => void;
  onChangeDraft: (connection: ConnectionProfile) => void;
  onClose: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onReset: () => void;
  onSave: () => void;
  onSelectConnection: (connectionId: string) => void;
  onSignIn: () => void;
  onStartAdd: () => void;
}) {
  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ?? connections[0] ?? defaultConnectionProfile();
  const selectedTenantName = tenantNameFromConnection(selectedConnection) || activeTenant;
  const redirectUri = getDefaultRedirectUri();
  const setupRows = [
    { label: 'App type', value: 'Non-confidential External App', copyValue: 'Non-confidential External App' },
    { label: 'Required access', value: requiredScopes, copyValue: requiredScopeText },
    { label: 'Redirect URI', value: redirectUri, copyValue: redirectUri },
  ];

  function copyValue(value: string) {
    void navigator.clipboard?.writeText(value);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="connection-modal" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Add connection' : 'Manage connection'}>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close connection dialog">
          <X size={24} />
        </button>
        {mode === 'manage' ? (
          <>
            <div className="modal-heading">
              <h2>Sign In</h2>
              <p>Select or configure the UiPath connection, then sign in to the target tenant.</p>
            </div>
            <div className="connection-box">
              <div>
                <h3>Saved Connections</h3>
                <p>Choose the organization and environment this app should use.</p>
              </div>
              <label className="connection-select">
                <span>Connection</span>
                <select value={selectedConnectionId} onChange={(event) => onSelectConnection(event.target.value)}>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>{connection.name}</option>
                  ))}
                </select>
              </label>
              <div className="connection-summary-row">
                <span className="connection-chip environment-chip">{selectedConnection.environment}</span>
                <span className="connection-chip active-chip">{signedIn ? 'Signed in' : 'Selected'}</span>
              </div>
              <p className="tenant-line">Tenant: {selectedTenantName || 'Not configured'}</p>
              <div className="connection-actions">
                <button className="button secondary" type="button" onClick={onStartAdd}>
                  <Plus size={18} />
                  Add
                </button>
                <button className="button secondary" type="button" onClick={onEdit}>
                  <Pencil size={18} />
                  Edit
                </button>
                <button className="button secondary danger-button" type="button" onClick={onRemove} disabled={connections.length <= 1}>
                  <Trash2 size={18} />
                  Remove
                </button>
                <button className="button secondary danger-button" type="button" onClick={onReset}>
                  <RotateCcw size={18} />
                  Reset
                </button>
                <button
                  className="button primary connection-signin-action"
                  type="button"
                  onClick={onSignIn}
                  disabled={liveConnectionPhase === 'connecting'}
                >
                  <LogIn size={18} />
                  {liveConnectionPhase === 'connecting' ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <div className="modal-heading compact">
              <h2>{connections.some((connection) => connection.id === connectionDraft.id) ? 'Edit Connection' : 'Add Connection'}</h2>
              <p>Connect this app to your UiPath organization.</p>
            </div>
            <div className="connection-form-grid">
              <label>
                <span>UiPath Platform URL</span>
                <input
                  value={connectionDraft.platformUrl}
                  placeholder="https://cloud.uipath.com"
                  onChange={(event) =>
                    onChangeDraft({
                      ...connectionDraft,
                      platformUrl: event.target.value,
                      environment: inferEnvironment(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Organization</span>
                <input
                  value={connectionDraft.organization}
                  placeholder="your-organization"
                  onChange={(event) =>
                    onChangeDraft({
                      ...connectionDraft,
                      name: event.target.value || connectionDraft.name,
                      organization: event.target.value,
                    })
                  }
                />
              </label>
              <label className="full-width">
                <span>Tenant</span>
                <input
                  value={connectionDraft.tenants}
                  placeholder="AMER_Prod"
                  onChange={(event) => onChangeDraft({ ...connectionDraft, tenants: event.target.value })}
                />
                <small>Tenant names are case sensitive. Use the exact casing shown in Automation Cloud.</small>
              </label>
              <label className="full-width">
                <span>Client ID</span>
                <input
                  value={connectionDraft.clientId}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  onChange={(event) => onChangeDraft({ ...connectionDraft, clientId: event.target.value })}
                />
              </label>
            </div>
            <section className="setup-instructions">
              <h3>Setup Instructions</h3>
              <p>Use these values when creating the non-confidential External App in UiPath, then add each required user scope.</p>
              <div className="secret-note">
                <ShieldCheck size={18} />
                <strong>No client secret is required or stored. Sign-in happens directly in this app.</strong>
              </div>
              <div className="setup-table">
                {setupRows.map((row) => (
                  <div className="setup-row" key={row.label}>
                    <span>{row.label}</span>
                    <div>
                      {Array.isArray(row.value) ? (
                        <div className="scope-list">
                          {row.value.map((scope) => (
                            <code key={scope}>{scope}</code>
                          ))}
                        </div>
                      ) : (
                        <strong>{row.value}</strong>
                      )}
                    </div>
                    <button className="icon-button" type="button" onClick={() => copyValue(row.copyValue)} aria-label={`Copy ${row.label}`}>
                      <Copy size={18} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="connection-tips">
                <strong>Tips</strong>
                <ul>
                  <li>Use a client ID from the same UiPath organization and environment as the platform URL.</li>
                  <li>Tenant name casing must match Automation Cloud exactly.</li>
                  <li>For a deployed coded app, register the deployed app URL as the redirect URI.</li>
                  <li>Organization display casing is preserved. API calls use the organization slug.</li>
                </ul>
              </div>
            </section>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => onChangeDraft(selectedConnection)}>
                Revert
              </button>
              <button className="button secondary" type="button" onClick={onBack}>
                Back
              </button>
              <button className="button primary" type="submit">Save connection</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  labelFormatter,
}: {
  items: T[];
  value: T;
  onChange: (value: T) => void;
  labelFormatter: (item: T) => string;
}) {
  return (
    <div className="segmented-control">
      {items.map((item) => (
        <button
          className={item === value ? 'active' : ''}
          key={item}
          onClick={() => onChange(item)}
          type="button"
        >
          {labelFormatter(item)}
        </button>
      ))}
    </div>
  );
}

function DayTimeline({
  buckets,
  date,
  liveHistorical,
  selectedTile,
  onTileClick,
}: {
  buckets: RuntimeBucket[];
  date: string;
  liveHistorical: boolean;
  selectedTile: SelectedTile;
  onTileClick: (tile: SelectedTile) => void;
}) {
  const future = liveHistorical && isFutureDate(date);
  const scheduledBuckets = future ? buckets.filter((bucket) => bucket.date === date && bucket.projectedDemand > 0) : [];

  return (
    <div className="day-timeline" aria-label="Day runtime utilization timeline">
      <div className={`day-title ${future && !scheduledBuckets.length ? 'future-date' : ''}`}>
        <strong>{formatDate(date, 'long')}</strong>
        <span>
          {future
            ? scheduledBuckets.length
              ? 'Future date with projected Process Schedule demand'
              : 'Future date - no observed runtime history yet'
            : `24 hourly ${liveHistorical ? 'peak consumed' : 'projected'} buckets in ${tenantTimezoneLabel}`}
        </span>
      </div>
      <div className="day-period-grid">
        {dayPeriods.map((period) => (
          <section className="day-period" key={period.label}>
            <div className="period-label">{period.label}</div>
            <div className="period-hours">
              {period.hours.map((hour) => {
              const bucket = bucketFor(date, hour, buckets);
              if (!bucket) {
                return (
                  <div className={`heatmap-empty ${future ? 'future-date' : ''}`} key={`${date}-${hour}`}>
                    <span>{hour}:00</span>
                    <small>No data</small>
                  </div>
                );
              }

              const percent = utilizationPercent(bucket);
              const risk = riskFromPercent(percent);
              const isSelected = selectedTile.date === bucket.date && selectedTile.hour === bucket.hour;
              const demand = future ? bucket.projectedDemand : liveHistorical ? bucket.observedDemand : bucket.projectedDemand;
              return (
                <button
                  className={`hour-card ${riskTone(risk)} ${isSelected ? 'selected' : ''}`}
                  key={`${bucket.date}-${bucket.hour}`}
                  onClick={() => onTileClick({ date: bucket.date, hour: bucket.hour })}
                  title={`${formatDate(bucket.date)} ${bucket.hour}:00 - ${percent}% - ${bucket.topDrivers.join(', ')}`}
                  type="button"
                >
                  <span>{hour}:00</span>
                  <strong>{percent}%</strong>
                  <small>{demand}/{bucket.capacity}</small>
                </button>
              );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function WeekCapacityView({
  buckets,
  dates,
  liveHistorical,
  selectedDate,
  onDateClick,
}: {
  buckets: RuntimeBucket[];
  dates: string[];
  liveHistorical: boolean;
  selectedDate: string;
  onDateClick: (date: string, hour: string) => void;
}) {
  const topWindows = dates
    .flatMap((date) => hours24.map((hour) => bucketFor(date, hour, buckets)))
    .filter((bucket): bucket is RuntimeBucket => Boolean(bucket))
    .sort((a, b) => utilizationPercent(b) - utilizationPercent(a))
    .slice(0, 4);

  return (
    <div className="week-workspace">
      <div className="week-capacity" aria-label="Weekly runtime capacity summary">
        {dates.map((date) => {
          const future = liveHistorical && isFutureDate(date);
          const summary = utilizationSummaryForDate(date, buckets);
          const peak = summary?.peak;
          const percent = summary?.peakPercent ?? 0;
          const risk = peak ? riskFromPercent(percent) : 'low';
          const businessDay = isBusinessDay(date);
          const capacitySignal = summary
            ? summary.riskHours > 0
              ? `${summary.riskHours} constrained hour(s)`
              : `${summary.lowCapacityHours} lower-demand hour(s)`
            : 'No data';

          return (
            <button
              className={`week-day-card ${businessDay ? 'business-day' : 'weekend-day'} ${peak ? riskTone(risk) : future ? 'future-date' : 'no-signal'} ${selectedDate === date ? 'selected' : ''}`}
              key={date}
              onClick={() => onDateClick(date, peak?.hour ?? '00')}
              type="button"
            >
              <span>{formatDate(date).split(',')[0]}</span>
              <strong>{formatDate(date).replace(',', '')}</strong>
              <div className="week-meter" aria-hidden="true">
                <i style={{ width: `${Math.min(percent, 130)}%` }} />
              </div>
              <small>{peak ? `Peak ${percent}% at ${peak.hour}:00` : 'No data'}</small>
              <small>{peak ? `Avg ${summary?.average ?? 0}% - ${future ? 'scheduled demand' : capacitySignal}` : 'No data'}</small>
            </button>
          );
        })}
      </div>
      <div className="week-detail-grid">
        <section className="week-load-profile">
          <div className="week-section-title">
            <strong>Daypart pressure</strong>
            <span>Average {liveHistorical ? 'observed' : 'projected'} utilization by period</span>
          </div>
          <div className="daypart-grid">
            {dayPeriods.map((period) => {
              const periodBuckets = dates.flatMap((date) =>
                period.hours
                  .map((hour) => bucketFor(date, hour, buckets))
                  .filter((bucket): bucket is RuntimeBucket => Boolean(bucket)),
              );
              const average = periodBuckets.length
                ? Math.round(periodBuckets.reduce((sum, bucket) => sum + utilizationPercent(bucket), 0) / periodBuckets.length)
                : 0;
              const peak = periodBuckets.length ? Math.max(...periodBuckets.map((bucket) => utilizationPercent(bucket))) : 0;
              const risk = riskFromPercent(peak);

              return (
                <button
                  className={`daypart-card ${riskTone(risk)}`}
                  key={period.label}
                  onClick={() => {
                    const peakBucket = periodBuckets.sort((a, b) => utilizationPercent(b) - utilizationPercent(a))[0];
                    if (peakBucket) onDateClick(peakBucket.date, peakBucket.hour);
                  }}
                  type="button"
                >
                  <span>{period.label}</span>
                  <strong>{average}% avg</strong>
                  <small>Peak {peak}%</small>
                </button>
              );
            })}
          </div>
        </section>
        <section className="week-hotspots">
          <div className="week-section-title">
            <strong>Busiest windows</strong>
            <span>Click to inspect hour detail</span>
          </div>
          <div className="hotspot-list">
            {topWindows.map((bucket) => {
              const percent = utilizationPercent(bucket);
              return (
                <button
                  className={`hotspot-row ${riskTone(riskFromPercent(percent))}`}
                  key={`${bucket.date}-${bucket.hour}`}
                  onClick={() => onDateClick(bucket.date, bucket.hour)}
                  type="button"
                >
                  <span>{formatDate(bucket.date)} {bucket.hour}:00</span>
                  <strong>{percent}%</strong>
                  <small>{liveHistorical ? bucket.observedDemand : bucket.projectedDemand}/{bucket.capacity} {liveHistorical ? 'peak consumed' : 'projected'}</small>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function MonthCalendar({
  buckets,
  dates,
  liveHistorical,
  selectedDate,
  onDateClick,
}: {
  buckets: RuntimeBucket[];
  dates: string[];
  liveHistorical: boolean;
  selectedDate: string;
  onDateClick: (date: string, hour: string) => void;
}) {
  const firstOffset = (new Date(`${dates[0]}T00:00:00`).getDay() + 6) % 7;
  const cells = [...Array.from({ length: firstOffset }, () => null), ...dates];

  return (
    <div className="month-calendar" aria-label="Monthly runtime utilization calendar">
      {weekdayHeaders.map((day) => (
        <div className="calendar-weekday" key={day}>{day}</div>
      ))}
      {cells.map((date, index) => {
        if (!date) return <div className="month-day blank" key={`blank-${index}`} />;

        const peak = peakBucketForDate(date, buckets);
        const percent = peak ? utilizationPercent(peak) : 0;
        const risk = peak ? riskFromPercent(percent) : 'low';
        const isSelected = selectedDate === date;
        const future = liveHistorical && isFutureDate(date);
        const businessDay = isBusinessDay(date);

        return (
          <button
            className={`month-day ${businessDay ? 'business-day' : 'weekend-day'} ${peak ? riskTone(risk) : future ? 'future-date' : 'no-signal'} ${isSelected ? 'selected' : ''}`}
            key={date}
            onClick={() => onDateClick(date, peak?.hour ?? '00')}
            type="button"
          >
            <span>{formatDate(date).replace(',', '')}</span>
            <strong>{dayNumber(date)}</strong>
            {peak ? (
              <>
                <small>{percent}% peak</small>
                <em>{future ? 'Scheduled' : peak.hour + ':00'}</em>
              </>
            ) : <small>No data</small>}
          </button>
        );
      })}
    </div>
  );
}

function ScenarioImpactCard({
  impact,
  scenario,
}: {
  impact: NonNullable<ReturnType<typeof scenarioImpactSummary>>;
  scenario: WhatIfScenario;
}) {
  const baselineUtilization = impact.capacity ? Math.round((impact.baselinePeak / impact.capacity) * 100) : 0;
  const projectedUtilization = impact.capacity ? Math.round((impact.projectedPeak / impact.capacity) * 100) : 0;
  const firstHour = impact.impactedHours[0] ?? scenario.preferredHour;
  const lastHour = impact.impactedHours[impact.impactedHours.length - 1] ?? scenario.preferredHour;
  const title = scenario.solutionName.trim() || 'Submitted scenario';

  return (
    <article className="scenario-impact-card">
      <div>
        <span>Submitted scenario impact</span>
        <strong>{title}</strong>
        <small>{formatDate(scenario.preferredDate, 'long')} {firstHour}:00-{lastHour}:59 {tenantTimezoneLabel}</small>
      </div>
      <dl>
        <div>
          <dt>Runtime add</dt>
          <dd>+{impact.addedDemand} for {scenario.durationMinutes} min</dd>
        </div>
        <div>
          <dt>Peak demand</dt>
          <dd>{impact.baselinePeak} {'->'} {impact.projectedPeak} / {impact.capacity}</dd>
        </div>
        <div>
          <dt>Utilization</dt>
          <dd>{baselineUtilization}% {'->'} {projectedUtilization}%</dd>
        </div>
        <div>
          <dt>Risk hours</dt>
          <dd>{impact.riskHours} at or above 85%</dd>
        </div>
      </dl>
    </article>
  );
}

function WhatIfPlanner({
  advisorRecommendation,
  folderOptions,
  machineTemplates,
  scenario,
  onApplyRecommendation,
  onChange,
  onGenerateRecommendation,
  onReset,
  onSubmit,
}: {
  advisorRecommendation: ScenarioAdvisorRecommendation | null;
  folderOptions: string[];
  machineTemplates: MachineTemplate[];
  scenario: WhatIfScenario;
  onApplyRecommendation: (recommendation: ScenarioAdvisorRecommendation) => void;
  onChange: (scenario: WhatIfScenario) => void;
  onGenerateRecommendation: () => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="what-if-panel" onSubmit={onSubmit}>
      <div>
        <h3>To-be-deployed solution</h3>
        <p>Submit to overlay projected runtime demand. All schedule inputs use {tenantTimezoneLabel}.</p>
      </div>
      <label>
        <span>Solution name</span>
        <input
          placeholder="New Finance Automation"
          value={scenario.solutionName}
          onChange={(event) => onChange({ ...scenario, solutionName: event.target.value })}
        />
      </label>
      <label>
        <span>Basic automation details</span>
        <textarea
          placeholder="Example: runs every weekday morning, high SLA, expected queue spike during month end"
          rows={3}
          value={scenario.businessDetails}
          onChange={(event) => onChange({ ...scenario, businessDetails: event.target.value })}
        />
      </label>
      <label>
        <span>Folder</span>
        <select value={scenario.folder} onChange={(event) => onChange({ ...scenario, folder: event.target.value })}>
          {folderOptions.length ? folderOptions.map((item) => (
            <option key={item}>{item}</option>
          )) : (
            <option value="">No folders returned</option>
          )}
        </select>
      </label>
      <label>
        <span>Machine</span>
        <select
          value={scenario.machineTemplateId}
          onChange={(event) => onChange({ ...scenario, machineTemplateId: event.target.value })}
        >
          {machineTemplates.length ? machineTemplates.map((template) => (
            <option key={template.id} value={template.id}>{machineOptionLabel(template)}</option>
          )) : (
            <option value="all">No machines returned</option>
          )}
        </select>
      </label>
      <div className="form-grid">
        <label>
          <span>Date</span>
          <select
            value={scenario.preferredDate}
            onChange={(event) => onChange({ ...scenario, preferredDate: event.target.value })}
          >
            {quarterDates.map((date) => (
              <option key={date} value={date}>{formatDate(date)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Start hour</span>
          <select value={scenario.preferredHour} onChange={(event) => onChange({ ...scenario, preferredHour: event.target.value })}>
            {hours24.map((hour) => (
              <option key={hour} value={hour}>{hour}:00</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span>Runtime demand</span>
          <input
            min={1}
            max={20}
            type="number"
            value={scenario.runtimeDemand}
            onChange={(event) => onChange({ ...scenario, runtimeDemand: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Duration minutes</span>
          <input
            min={15}
            step={15}
            type="number"
            value={scenario.durationMinutes}
            onChange={(event) => onChange({ ...scenario, durationMinutes: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        <span>Priority</span>
        <select value={scenario.priority} onChange={(event) => onChange({ ...scenario, priority: event.target.value as WhatIfScenario['priority'] })}>
          <option>Normal</option>
          <option>High</option>
          <option>Critical</option>
        </select>
      </label>
      {advisorRecommendation ? (
        <article className="ai-advice">
          <div className="ai-advice-header">
            <span><Sparkles size={14} /> AI-assisted recommendation</span>
            <strong>{advisorRecommendation.confidence}</strong>
          </div>
          <h4>{advisorRecommendation.title}</h4>
          <p>{advisorRecommendation.action}</p>
          <small>{advisorRecommendation.impact}</small>
          <small>{advisorRecommendation.rationale}</small>
          <button
            className="button secondary"
            type="button"
            onClick={() => onApplyRecommendation(advisorRecommendation)}
          >
            Use recommended slot
          </button>
        </article>
      ) : null}
      <div className="form-actions">
        <button className="button secondary" type="button" onClick={onGenerateRecommendation}>
          <Sparkles size={16} />
          Get AI recommendation
        </button>
        <button className="button primary" type="submit">Submit scenario</button>
        <button className="button secondary" type="button" onClick={onReset}>Reset</button>
      </div>
    </form>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <article className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function OrchestratorMonitoringHandoff({ href }: { href: string }) {
  return (
    <div className="monitoring-handoff">
      <div className="monitoring-handoff-copy">
        <strong>Use Orchestrator for live machine details</strong>
        <p>
          Sign in to Automation Cloud, then open Monitoring, Machines, and the Real time tab to review host name,
          template, type, status, runtimes, usage, and last-used process.
        </p>
      </div>
      <a className="button primary monitoring-handoff-action" href={href} target="_blank" rel="noreferrer">
        <ExternalLink size={16} />
        Open Orchestrator
      </a>
      <div className="monitoring-handoff-note">
        Machine rows are hidden in this app for now so Runtime Capacity Intelligence stays focused on planning,
        schedule risk, and recommendations.
      </div>
    </div>
  );
}

function RiskPill({ risk }: { risk: RiskLevel }) {
  return <span className={`pill ${riskTone(risk)}`}>{riskLabel(risk)}</span>;
}
