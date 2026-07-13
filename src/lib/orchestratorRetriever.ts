import { UiPath } from '@uipath/uipath-typescript/core';
import { defaultApiLookbackDays, odataPageSize } from '../config/appConfig';
import type { ApiCallDiagnostic, LiveFolderSummary, LiveProbeMode, LiveProcessSummary, OrchestratorSnapshot, ProbeConnectionConfig, RawRecord } from '../types/live';
import {
  summarizeFolder,
  summarizeJobRecord,
  summarizeMachine,
  summarizeSession,
  summarizeTrigger,
  uniqueSorted,
} from './liveMappers';

type LiveProbeSuccess<T> = { ok: true; items: T[] };
type LiveProbeFailure = { ok: false; message: string; diagnostic?: ApiCallDiagnostic };
type LiveRawProbeSuccess = LiveProbeSuccess<RawRecord> & { url: string; endpoint: string; payload: RawRecord; diagnostic: ApiCallDiagnostic };
type LiveRawProbeResult = LiveRawProbeSuccess | LiveProbeFailure;
type FolderProbeResult = { folder: LiveFolderSummary; result: LiveRawProbeResult };

type EndpointCandidate = {
  path: string;
  query: string;
  label: string;
};

type SessionEndpointCandidate = EndpointCandidate;

type OrchestratorSnapshotOptions = {
  mode?: LiveProbeMode;
  selectedFolder?: string;
  selectedMachineTemplateId?: string;
  selectedMachineTemplateName?: string;
};

const currentUserFoldersEndpoint = 'api/Folders/GetAllForCurrentUser';
const currentUserFoldersLabel = 'api/Folders/GetAllForCurrentUser';
const currentUserFoldersPageSize = 200;
const maxCurrentUserFolderPages = 50;

const machineQuery = [
  '$select=Id,Key,LicenseKey,Name,MachineName,Scope,Type,MachineType,UnattendedSlots,UnattendedRobotSlots,NonProductionSlots,NonProductionRobotSlots,HeadlessSlots,TestingSlots,TestAutomationSlots,AutomationCloudSlots,AutomationCloudRobotSlots,OrganizationUnitName,OrganizationUnitFullyQualifiedName',
  `$top=${odataPageSize}`,
  '$orderby=Name asc',
].join('&');
const machineFallbackQuery = `$top=${odataPageSize}&$orderby=Name asc`;

const sessionBaseSelectedFields = [
  'Id',
  'State',
  'MachineName',
  'HostMachineName',
  'RuntimeType',
  'RobotName',
  'ReportingTime',
  'FolderName',
  'OrganizationUnitName',
  'OrganizationUnitFullyQualifiedName',
].join(',');
const sessionExpandedSelectedFields = `${sessionBaseSelectedFields},Robot`;

function activeSessionFilter() {
  const reportingStart = defaultLookbackStartIso();
  return [
    "(State eq 'Available' or State eq 'Busy' or State eq 'Connected')",
    `ReportingTime gt ${reportingStart}`,
  ].join(' and ');
}

function activeSessionQuery(expandRobot: boolean) {
  return [
    `$select=${expandRobot ? sessionExpandedSelectedFields : sessionBaseSelectedFields}`,
    `$filter=${activeSessionFilter()}`,
    ...(expandRobot ? ['$expand=Robot'] : []),
    `$top=${odataPageSize}`,
    '$orderby=MachineName asc',
  ].join('&');
}

function sessionEndpointCandidates(): SessionEndpointCandidate[] {
  const activeExpandedQuery = activeSessionQuery(true);
  const activeSelectedQuery = activeSessionQuery(false);
  return [
    {
      path: 'odata/Sessions/UiPath.Server.Configuration.OData.GetGlobalSessions',
      query: activeExpandedQuery,
      label: 'global active sessions with Robot expand',
    },
    {
      path: 'odata/Sessions',
      query: activeExpandedQuery,
      label: 'active sessions with Robot expand',
    },
    {
      path: 'odata/Sessions/UiPath.Server.Configuration.OData.GetGlobalSessions',
      query: activeSelectedQuery,
      label: 'global active sessions selected fields',
    },
    {
      path: 'odata/Sessions',
      query: activeSelectedQuery,
      label: 'active sessions selected fields',
    },
    {
      path: 'odata/Sessions',
      query: [
        `$select=${sessionBaseSelectedFields}`,
        `$top=${odataPageSize}`,
        '$orderby=MachineName asc',
      ].join('&'),
      label: 'sessions broad selected-field fallback',
    },
  ];
}

const jobSelectedFields = [
  'Id',
  'Key',
  'State',
  'ProcessName',
  'ReleaseName',
  'FolderName',
  'OrganizationUnitName',
  'OrganizationUnitFullyQualifiedName',
  'StartTime',
  'EndTime',
  'CreationTime',
  'CreatedTime',
  'Source',
  'SourceType',
  'HostMachineName',
  'MachineName',
  'MachineId',
  'RobotName',
  'UserName',
  'Username',
  'ExecutingUserName',
  'RuntimeType',
  'RobotType',
  'PackageType',
  'Type',
].join(',');

const triggerSelectedFields = [
  'Id',
  'Key',
  'Name',
  'Enabled',
  'IsEnabled',
  'ReleaseName',
  'ProcessName',
  'FolderName',
  'OrganizationUnitName',
  'OrganizationUnitFullyQualifiedName',
  'QueueDefinitionName',
  'TriggerType',
  'ProcessScheduleType',
  'Type',
  'StartProcessCron',
  'StartProcessCronSummary',
  'CronExpression',
  'CronSummary',
  'TimeZoneId',
  'RuntimeType',
  'MachineName',
  'MachineId',
  'HostMachineName',
  'JobPriority',
  'NextOccurrence',
  'NextRunTime',
].join(',');

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function deriveOrchestratorCloudBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');
  if (!normalizedBaseUrl) return 'https://cloud.uipath.com';

  try {
    const parsed = new URL(normalizedBaseUrl);
    if (parsed.hostname === 'api.uipath.com') parsed.hostname = 'cloud.uipath.com';
    if (parsed.hostname === 'staging.api.uipath.com') parsed.hostname = 'staging.uipath.com';
    if (parsed.hostname === 'alpha.api.uipath.com') parsed.hostname = 'alpha.uipath.com';
    return parsed.origin;
  } catch {
    return normalizedBaseUrl;
  }
}

function orchestratorBaseUrl(config: ProbeConnectionConfig) {
  const cloudBase = new URL(deriveOrchestratorCloudBaseUrl(config.baseUrl));
  const org = encodeURIComponent(config.orgName);
  const tenant = encodeURIComponent(config.tenantName);
  return `${cloudBase.origin}/${org}/${tenant}/orchestrator_/`;
}

function useLocalOrchestratorProxy() {
  return Boolean(
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
  );
}

function requestUrlFor(url: URL) {
  if (!useLocalOrchestratorProxy()) return url.toString();
  return `/__uipath_orchestrator?target=${encodeURIComponent(url.toString())}`;
}

function extractItems(payload: RawRecord): RawRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is RawRecord => item && typeof item === 'object');
  const candidate = payload.value ?? payload.Value ?? payload.data ?? payload.Data ?? payload.pageItems ?? payload.PageItems;
  return Array.isArray(candidate) ? candidate.filter((item): item is RawRecord => item && typeof item === 'object') : [];
}

function firstValue(record: RawRecord, keys: string[]) {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function nestedRecord(record: RawRecord, keys: string[]) {
  const value = firstValue(record, keys);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : null;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function numberFromRecord(record: RawRecord | null, keys: string[]) {
  if (!record) return null;
  return numberValue(firstValue(record, keys));
}

const runtimeLicenseCandidates = [
  {
    label: 'Unattended Robot',
    productCode: 'UNATT',
    keys: ['Unattended', 'unattended', 'UNATT', 'UnattendedRobot', 'unattendedRobot', 'Unattended Robots'],
  },
  {
    label: 'Testing',
    productCode: 'TEST',
    keys: ['Testing', 'testing', 'TEST', 'TestAutomation', 'testAutomation', 'Test Automation', 'TestingRobot', 'testingRobot', 'Testing Robots'],
  },
  {
    label: 'NonProduction Robot',
    productCode: 'NONPROD',
    keys: ['NonProduction', 'nonProduction', 'NONPROD', 'NonProductionRobot', 'nonProductionRobot', 'Non Production', 'Non-production Robots'],
  },
];

function summarizeTenantLicense(payload: RawRecord) {
  const allowed = nestedRecord(payload, ['Allowed', 'allowed']);
  const used = nestedRecord(payload, ['Used', 'used']);
  const licenseOptions = runtimeLicenseCandidates.map((candidate) => ({
    ...candidate,
    runtimeAllocated: numberFromRecord(allowed, candidate.keys),
    runtimeUsed: numberFromRecord(used, candidate.keys),
  }));
  const activeLicense = licenseOptions.find((candidate) =>
    (candidate.runtimeAllocated ?? 0) > 0 || (candidate.runtimeUsed ?? 0) > 0,
  ) ?? licenseOptions.find((candidate) =>
    candidate.runtimeAllocated !== null || candidate.runtimeUsed !== null,
  );

  if (!activeLicense) return null;

  return {
    runtimeAllocated: activeLicense.runtimeAllocated,
    runtimeUsed: activeLicense.runtimeUsed,
    source: 'orchestrator-license-info' as const,
    label: activeLicense.label,
    productCode: activeLicense.productCode,
    message: `Read ${activeLicense.label} runtime allocation from Orchestrator license info Allowed/Used values.`,
  };
}

function previewText(value: unknown, maxLength = 420) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...` : serialized;
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function diagnosticId(endpoint: string, folderId?: number) {
  return `${endpoint}:${folderId ?? 'tenant'}:${Math.random().toString(36).slice(2, 9)}`;
}

function withFolderDiagnostic(probe: FolderProbeResult): FolderProbeResult {
  const diagnostic = probe.result.diagnostic;
  if (!diagnostic) return probe;
  return {
    ...probe,
    result: {
      ...probe.result,
      diagnostic: {
        ...diagnostic,
        folderId: probe.folder.id,
        folderName: probe.folder.path,
      },
    },
  };
}

function collectDiagnostics(...results: Array<LiveRawProbeResult | null | undefined>) {
  return results.flatMap((result) => (result?.diagnostic ? [result.diagnostic] : []));
}

function defaultLookbackStartIso() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - defaultApiLookbackDays);
  return start.toISOString();
}

function odataStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function knownFilterValue(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  return text && !['Unknown', 'Unknown host', 'Unknown machine', 'Unassigned'].includes(text) ? text : '';
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

function folderValuesMatch(left: string, right: string) {
  const normalizedLeft = normalizeFilterValue(left);
  const normalizedRight = normalizeFilterValue(right);
  return normalizedLeft === normalizedRight ||
    normalizeFilterValue(folderLeafName(left)) === normalizedRight ||
    normalizedLeft === normalizeFilterValue(folderLeafName(right));
}

function machineIdentity(machine: ReturnType<typeof summarizeMachine>) {
  return knownFilterValue(machine.key) || knownFilterValue(String(machine.id)) || normalizeFilterValue(machine.name);
}

function mergeMachineSummaries(machines: ReturnType<typeof summarizeMachine>[]) {
  const byIdentity = new Map<string, ReturnType<typeof summarizeMachine>>();

  machines.forEach((machine) => {
    const identity = machineIdentity(machine);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        ...machine,
        folderNames: uniqueSorted(machine.folderNames),
        hostNames: uniqueSorted(machine.hostNames),
      });
      return;
    }

    existing.folderNames = uniqueSorted([...existing.folderNames, ...machine.folderNames]);
    existing.hostNames = uniqueSorted([...existing.hostNames, ...machine.hostNames]);
    existing.onlineHosts = Math.max(existing.onlineHosts, machine.onlineHosts);
    existing.totalHosts = Math.max(existing.totalHosts, machine.totalHosts);
    existing.unattendedSlots = Math.max(existing.unattendedSlots, machine.unattendedSlots);
    existing.nonProductionSlots = Math.max(existing.nonProductionSlots, machine.nonProductionSlots);
    existing.headlessSlots = Math.max(existing.headlessSlots, machine.headlessSlots);
    existing.testingSlots = Math.max(existing.testingSlots, machine.testingSlots);
    existing.automationCloudSlots = Math.max(existing.automationCloudSlots, machine.automationCloudSlots);
  });

  return Array.from(byIdentity.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeFolderScopedMachine(record: RawRecord, folder: LiveFolderSummary, sessions: OrchestratorSnapshot['sessions']) {
  const machine = summarizeMachine(record, sessions);
  machine.folderNames = uniqueSorted([...machine.folderNames, folder.path, folder.name]);
  return machine;
}

function folderMatchesMachine(folder: LiveFolderSummary, machineFolderNames: Set<string> | null) {
  if (!machineFolderNames?.size) return true;
  return Array.from(machineFolderNames).some((machineFolderName) =>
    folderValuesMatch(folder.path, machineFolderName) || folderValuesMatch(folder.name, machineFolderName),
  );
}

function buildMachineNamePredicate(machine: ReturnType<typeof summarizeMachine> | null) {
  if (!machine) return null;
  const machineNames = uniqueSorted([
    knownFilterValue(machine.name),
    ...machine.hostNames.map(knownFilterValue),
  ]);
  if (!machineNames.length) return null;

  return machineNames
    .flatMap((machineName) => [
      `MachineName eq ${odataStringLiteral(machineName)}`,
      `HostMachineName eq ${odataStringLiteral(machineName)}`,
    ])
    .join(' or ');
}

function combineODataFilters(filters: Array<string | null | undefined>) {
  const activeFilters = filters.filter((filter): filter is string => Boolean(filter));
  return activeFilters.length ? activeFilters.map((filter) => `(${filter})`).join(' and ') : '';
}

async function settledBatch<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...await Promise.allSettled(items.slice(index, index + concurrency).map(operation)));
  }
  return results;
}

async function runFolderedODataProbe(
  config: ProbeConnectionConfig,
  token: string | undefined,
  folders: LiveFolderSummary[],
  entitySet: string,
  query: string,
  fallbackQuery?: string,
): Promise<FolderProbeResult[]> {
  const settled = await settledBatch(
    folders,
    10,
    async (folder): Promise<FolderProbeResult> => ({
      folder,
      result: fallbackQuery
        ? await runODataProbeWithFallback(config, token, entitySet, query, fallbackQuery, folder.id)
        : await runODataProbe(config, token, entitySet, query, folder.id),
    }),
  );

  return settled.map((result, index) => (
    result.status === 'fulfilled'
      ? withFolderDiagnostic(result.value)
      : {
        folder: folders[index],
        result: { ok: false, message: errorMessage(result.reason) },
      }
  ));
}

function summarizeFolderedSkips(label: string, probes: FolderProbeResult[]) {
  const skipped = probes.filter((probe) => !probe.result.ok);
  if (!skipped.length) return null;
  const first = skipped[0];
  return `${label} skipped ${skipped.length} folder(s) where this user lacks that read permission; first: ${first.folder.path} - ${first.result.ok ? '' : first.result.message}`;
}

function buildProcessSummariesFromTriggers(triggers: ReturnType<typeof summarizeTrigger>[]): LiveProcessSummary[] {
  const processes = new Map<string, LiveProcessSummary>();
  for (const trigger of triggers) {
    const key = `${trigger.folderName}:${trigger.processName}`;
    if (processes.has(key)) continue;
    processes.set(key, {
      key,
      id: key,
      name: trigger.processName,
      folderName: trigger.folderName,
      packageVersion: 'Schedule-derived',
      targetFramework: 'Unknown',
    });
  }
  return Array.from(processes.values());
}

async function runJsonProbe(
  config: ProbeConnectionConfig,
  token: string | undefined,
  path: string,
  query = `$top=${odataPageSize}`,
  folderId?: number,
): Promise<LiveRawProbeResult> {
  const endpoint = path;
  let urlText = path;
  if (!token) {
    return {
      ok: false,
      message: 'SDK token is not available for OData read.',
      diagnostic: {
        id: diagnosticId(endpoint, folderId),
        method: 'GET',
        endpoint,
        url: urlText,
        status: 'skipped',
        statusCode: null,
        statusText: 'Token unavailable',
        folderId,
        resultSummary: 'OData read was not sent because the SDK token was unavailable.',
        responsePreview: '',
      },
    };
  }

  try {
    const url = new URL(path, orchestratorBaseUrl(config));
    const params = new URLSearchParams(query);
    params.forEach((value, key) => url.searchParams.set(key, value));
    urlText = url.toString();

    const response = await fetch(requestUrlFor(url), {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(folderId ? { 'X-UIPATH-OrganizationUnitId': String(folderId) } : {}),
      },
    });

    const responseText = await response.text().catch(() => '');
    if (!response.ok) {
      const message = `${response.status} ${response.statusText}${responseText ? ` - ${responseText.slice(0, 240)}` : ''}`;
      return {
        ok: false,
        message,
        diagnostic: {
          id: diagnosticId(endpoint, folderId),
          method: 'GET',
          endpoint,
          url: urlText,
          status: 'error',
          statusCode: response.status,
          statusText: response.statusText,
          folderId,
          resultSummary: message,
          responsePreview: previewText(responseText),
        },
      };
    }

    let payload: RawRecord;
    try {
      payload = (responseText ? JSON.parse(responseText) : {}) as RawRecord;
    } catch (error) {
      const contentType = response.headers.get('content-type') ?? 'unknown content type';
      const message = [
        `${response.status} ${response.statusText} returned a non-JSON response (${contentType}) for ${endpoint}.`,
        'Verify the Automation Cloud organization slug, exact tenant name, and base URL for this connection.',
      ].join(' ');

      return {
        ok: false,
        message,
        diagnostic: {
          id: diagnosticId(endpoint, folderId),
          method: 'GET',
          endpoint,
          url: urlText,
          status: 'error',
          statusCode: response.status,
          statusText: response.statusText,
          folderId,
          resultSummary: message,
          responsePreview: previewText(responseText || errorMessage(error)),
        },
      };
    }

    const items = extractItems(payload);
    return {
      ok: true,
      endpoint: path,
      items,
      payload,
      url: url.toString(),
      diagnostic: {
        id: diagnosticId(endpoint, folderId),
        method: 'GET',
        endpoint,
        url: urlText,
        status: 'success',
        statusCode: response.status,
        statusText: response.statusText,
        folderId,
        resultSummary: `${items.length} item(s) returned.`,
        responsePreview: items.length ? previewText(items[0]) : previewText(payload),
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      message,
      diagnostic: {
        id: diagnosticId(endpoint, folderId),
        method: 'GET',
        endpoint,
        url: urlText,
        status: 'error',
        statusCode: null,
        statusText: 'Fetch failed',
        folderId,
        resultSummary: message,
        responsePreview: message,
      },
    };
  }
}

async function runODataProbe(
  config: ProbeConnectionConfig,
  token: string | undefined,
  entitySet: string,
  query = `$top=${odataPageSize}`,
  folderId?: number,
): Promise<LiveRawProbeResult> {
  return runJsonProbe(config, token, `odata/${entitySet}`, query, folderId);
}

async function runODataProbeWithFallback(
  config: ProbeConnectionConfig,
  token: string | undefined,
  entitySet: string,
  selectedFieldQuery: string,
  fallbackQuery: string,
  folderId?: number,
): Promise<LiveRawProbeResult> {
  const selectedResult = await runODataProbe(config, token, entitySet, selectedFieldQuery, folderId);
  if (selectedResult.ok) return selectedResult;

  const fallbackResult = await runODataProbe(config, token, entitySet, fallbackQuery, folderId);
  if (!fallbackResult.ok) return selectedResult;

  return {
    ...fallbackResult,
    diagnostic: {
      ...fallbackResult.diagnostic,
      resultSummary: `Selected-field query failed; fallback returned ${fallbackResult.items.length} item(s).`,
      responsePreview: previewText(`Select failure: ${selectedResult.message} | ${fallbackResult.diagnostic.responsePreview}`),
    },
  };
}

async function runJsonProbeWithFallback(
  config: ProbeConnectionConfig,
  token: string | undefined,
  selectedPath: string,
  selectedQuery: string,
  fallbackPath: string,
  fallbackQuery: string,
): Promise<LiveRawProbeResult> {
  const selectedResult = await runJsonProbe(config, token, selectedPath, selectedQuery);
  if (selectedResult.ok) return selectedResult;

  const fallbackResult = await runJsonProbe(config, token, fallbackPath, fallbackQuery);
  if (!fallbackResult.ok) return selectedResult;

  return {
    ...fallbackResult,
    diagnostic: {
      ...fallbackResult.diagnostic,
      resultSummary: `Primary query failed; fallback returned ${fallbackResult.items.length} item(s).`,
      responsePreview: previewText(`Primary failure: ${selectedResult.message} | ${fallbackResult.diagnostic.responsePreview}`),
    },
  };
}

async function runFolderProbe(config: ProbeConnectionConfig, token: string | undefined) {
  const attempts: string[] = [];
  const pageResults: LiveRawProbeResult[] = [];
  const items: RawRecord[] = [];

  for (let pageIndex = 0; pageIndex < maxCurrentUserFolderPages; pageIndex += 1) {
    const skip = pageIndex * currentUserFoldersPageSize;
    const result = await runJsonProbe(
      config,
      token,
      currentUserFoldersEndpoint,
      `take=${currentUserFoldersPageSize}&skip=${skip}`,
    );
    pageResults.push(result);

    if (!result.ok) {
      attempts.push(`${currentUserFoldersLabel} skip ${skip}: ${result.message}`);
      return { ...result, attempts, label: currentUserFoldersLabel, pageResults };
    }

    items.push(...result.items);
    attempts.push(`${currentUserFoldersLabel} skip ${skip}: ${result.items.length} item(s)`);

    if (result.items.length < currentUserFoldersPageSize) {
      return {
        ...result,
        items,
        payload: { value: items },
        attempts,
        label: currentUserFoldersLabel,
        pageResults,
        diagnostic: {
          ...result.diagnostic,
          resultSummary: `${items.length} current-user folder(s) returned across ${pageResults.length} page(s).`,
          responsePreview: items.length ? previewText(items[0]) : previewText(result.payload),
        },
      };
    }
  }

  return {
    ok: false as const,
    message: `Folder API pagination stopped after ${maxCurrentUserFolderPages} page(s). ${attempts.join(' | ')}`,
    attempts,
    label: currentUserFoldersLabel,
    pageResults,
  };
}

async function runSessionProbe(config: ProbeConnectionConfig, token: string | undefined) {
  const attempts: string[] = [];

  for (const candidate of sessionEndpointCandidates()) {
    const result = await runJsonProbe(config, token, candidate.path, candidate.query);
    if (result.ok) {
      attempts.push(`${candidate.label}: ${result.items.length} item(s)`);
      return { ...result, attempts, label: candidate.label };
    }

    attempts.push(`${candidate.label}: ${result.message}`);
  }

  return {
    ok: false as const,
    message: attempts.join(' | '),
    attempts,
    label: 'none',
  };
}

export async function retrieveOrchestratorSnapshot(
  sdk: UiPath,
  config: ProbeConnectionConfig,
  options: OrchestratorSnapshotOptions = {},
): Promise<OrchestratorSnapshot> {
  const mode = options.mode ?? 'discovery';
  const token = sdk.getToken();
  const messages: string[] = [];
  const apiCalls: ApiCallDiagnostic[] = [];

  const licenseProbe = await runJsonProbe(config, token, 'odata/Settings/UiPath.Server.Configuration.OData.GetLicense', '');
  apiCalls.push(...collectDiagnostics(licenseProbe));
  const tenantLicense = licenseProbe.ok ? summarizeTenantLicense(licenseProbe.payload) : null;
  if (tenantLicense?.runtimeAllocated !== null && tenantLicense?.runtimeAllocated !== undefined) {
    messages.push(`License API read returned ${tenantLicense.runtimeAllocated} tenant-level ${tenantLicense.label} runtime allocation.`);
  } else if (licenseProbe.ok) {
    messages.push('License API read succeeded but no supported runtime allocation was exposed in Allowed values.');
  } else {
    messages.push(`License API read failed: ${licenseProbe.message}`);
  }

  const folderProbe = await runFolderProbe(config, token);
  apiCalls.push(...(folderProbe.pageResults?.length ? folderProbe.pageResults.flatMap((result) => collectDiagnostics(result)) : collectDiagnostics(folderProbe)));
  const folderDetails = folderProbe.ok
    ? folderProbe.items.map(summarizeFolder).filter((folder): folder is NonNullable<typeof folder> => Boolean(folder))
    : [];

  messages.push(`Folder API read attempts: ${folderProbe.attempts.join(' | ')}`);
  if (folderProbe.ok) {
    messages.push(`Folder API selected ${folderProbe.label}; mapped ${folderDetails.length} folder(s) from ${folderProbe.items.length} raw item(s).`);
  }
  if (!folderProbe.ok) messages.push(`Folder API read failed: ${folderProbe.message}`);
  if (folderProbe.ok && !folderDetails.length) {
    const sampleKeys = Object.keys(folderProbe.items[0] ?? {}).slice(0, 12).join(', ') || 'no raw fields';
    messages.push(`Folder API read returned raw records but mapping produced zero folders. First record fields: ${sampleKeys}.`);
  }

  const sessionProbe = await runSessionProbe(config, token);
  apiCalls.push(...collectDiagnostics(sessionProbe));
  const sessions = sessionProbe.ok ? sessionProbe.items.map((item) => summarizeSession(item)) : [];
  if (sessionProbe.ok) {
    messages.push(`Session API selected ${sessionProbe.label}; mapped ${sessions.length} recent active connected host/session signal(s).`);
  } else {
    messages.push(`Session API read failed: ${sessionProbe.message}`);
  }

  const machineProbe = await runODataProbeWithFallback(config, token, 'Machines', machineQuery, machineFallbackQuery);
  apiCalls.push(...collectDiagnostics(machineProbe));
  if (!machineProbe.ok) messages.push(`Machine API read failed: ${machineProbe.message}`);

  const folderMachineProbes = folderDetails.length
    ? await runFolderedODataProbe(config, token, folderDetails, 'Machines', machineQuery, machineFallbackQuery)
    : [];
  apiCalls.push(...folderMachineProbes.flatMap((probe) => collectDiagnostics(probe.result)));
  const folderScopedMachines = folderMachineProbes.flatMap((probe) =>
    probe.result.ok ? probe.result.items.map((item) => summarizeFolderScopedMachine(item, probe.folder, sessions)) : [],
  );
  const machineSkipMessage = summarizeFolderedSkips('Folder-scoped machine read', folderMachineProbes);
  if (machineSkipMessage) messages.push(machineSkipMessage);

  const machines = mergeMachineSummaries([
    ...(machineProbe.ok ? machineProbe.items.map((item) => summarizeMachine(item, sessions)) : []),
    ...folderScopedMachines,
  ]);
  if (folderScopedMachines.length) {
    messages.push(`Folder-scoped machine reads mapped ${folderScopedMachines.length} machine-folder association(s).`);
  }

  const requestedFolder = options.selectedFolder && options.selectedFolder !== 'All permitted folders'
    ? options.selectedFolder
    : null;
  const requestedMachineTemplateId = options.selectedMachineTemplateId && options.selectedMachineTemplateId !== 'all'
    ? options.selectedMachineTemplateId
    : null;
  const selectedMachine = requestedMachineTemplateId
    ? machines.find((machine) =>
      machine.key === requestedMachineTemplateId ||
      String(machine.id) === requestedMachineTemplateId ||
      machine.name === options.selectedMachineTemplateName,
    ) ?? null
    : null;
  const machineFolderNames = selectedMachine ? new Set(selectedMachine.folderNames) : null;
  const requestedFolderScope = requestedFolder
    ? folderDetails.filter((item) => item.path === requestedFolder || item.name === requestedFolder)
    : folderDetails;
  const machineScopedFolders = machineFolderNames?.size
    ? requestedFolderScope.filter((item) => folderMatchesMachine(item, machineFolderNames))
    : requestedFolderScope;
  const heatmapFolders = machineScopedFolders.length ? machineScopedFolders : requestedFolderScope;
  const scopeLabel = mode === 'heatmap'
    ? [
      requestedFolder ?? 'All permitted folders',
      options.selectedMachineTemplateName && !['All templates', 'All machines'].includes(options.selectedMachineTemplateName)
        ? options.selectedMachineTemplateName
        : 'All machines',
    ].join(' / ')
    : 'Discovery only';

  if (mode === 'discovery') {
    messages.push('Discovery mode completed. Job and trigger history were not loaded; choose filters and generate the heatmap to run scoped reads.');

    const folders = uniqueSorted([
      ...folderDetails.map((folder) => folder.path),
      ...machines.flatMap((machine) => machine.folderNames),
      ...sessions.map((session) => session.folderName),
    ]);

    return {
      mode,
      scopeLabel,
      folders,
      folderDetails,
      processCount: 0,
      jobCount: 0,
      jobs: [],
      processes: [],
      machines,
      sessions,
      triggers: [],
      tenantLicense,
      apiCalls,
      messages,
    };
  }

  if (requestedFolder && !heatmapFolders.length) {
    messages.push(`Selected folder "${requestedFolder}" was not returned by folder discovery, so scoped job and trigger reads were skipped.`);
  }
  if (selectedMachine) {
    messages.push(`Selected machine filter: ${selectedMachine.name}. API job reads include machine-name predicates where supported.`);
    if (machineFolderNames?.size && machineScopedFolders.length) {
      messages.push(`Machine folder scope narrowed API reads to ${machineScopedFolders.length} folder(s).`);
    } else if (machineFolderNames?.size && requestedFolderScope.length) {
      messages.push('Machine folder associations did not match discovered folders exactly; using the selected folder scope plus job machine predicates.');
    }
  } else if (requestedMachineTemplateId) {
    messages.push(`Selected machine "${options.selectedMachineTemplateName ?? requestedMachineTemplateId}" was not found in machine inventory; API reads use folder scope only.`);
  }

  const jobLookbackStart = defaultLookbackStartIso();
  messages.push(`Heatmap generation scope: ${scopeLabel}. Job history API filter: last ${defaultApiLookbackDays} days, from ${jobLookbackStart}.`);
  const machinePredicate = buildMachineNamePredicate(selectedMachine);
  const jobFilter = combineODataFilters([
    `CreationTime ge ${jobLookbackStart}`,
    machinePredicate,
  ]);
  const triggerFilter = combineODataFilters([machinePredicate]);

  const jobQuery = [
    `$select=${jobSelectedFields}`,
    `$filter=${jobFilter}`,
    '$orderby=CreationTime desc',
    '$top=100',
  ].join('&');
  const jobFallbackQuery = [
    `$filter=${jobFilter}`,
    '$orderby=CreationTime desc',
    '$top=100',
  ].join('&');
  const triggerQuery = [
    `$select=${triggerSelectedFields}`,
    ...(triggerFilter ? [`$filter=${triggerFilter}`] : []),
    '$orderby=Name asc',
    `$top=${odataPageSize}`,
  ].join('&');
  const triggerFallbackQuery = [
    ...(triggerFilter ? [`$filter=${triggerFilter}`] : []),
    '$orderby=Name asc',
    `$top=${odataPageSize}`,
  ].join('&');

  const [jobProbes, triggerProbes] = folderDetails.length
    ? await Promise.all([
      runFolderedODataProbe(config, token, heatmapFolders, 'Jobs', jobQuery, jobFallbackQuery),
      runFolderedODataProbe(config, token, heatmapFolders, 'ProcessSchedules', triggerQuery, triggerFallbackQuery),
    ])
    : [[], []];

  apiCalls.push(
    ...jobProbes.flatMap((probe) => collectDiagnostics(probe.result)),
    ...triggerProbes.flatMap((probe) => collectDiagnostics(probe.result)),
  );

  const jobSkipMessage = summarizeFolderedSkips('Job read', jobProbes);
  if (jobSkipMessage) messages.push(jobSkipMessage);

  const triggerSkipMessage = summarizeFolderedSkips('Trigger read', triggerProbes);
  if (triggerSkipMessage) messages.push(triggerSkipMessage);

  const jobsFound = jobProbes.flatMap((probe) => (probe.result.ok ? probe.result.items.map((job) => summarizeJobRecord(job, probe.folder.path)) : []));
  const triggers = triggerProbes.flatMap((probe) => (probe.result.ok ? probe.result.items.map((trigger) => {
    const summary = summarizeTrigger(trigger);
    return summary.folderName === 'Unknown folder' ? { ...summary, folderName: probe.folder.path } : summary;
  }) : []));
  const processesFound = buildProcessSummariesFromTriggers(triggers);
  const folders = uniqueSorted([
    ...folderDetails.map((folder) => folder.path),
    ...processesFound.map((process) => process.folderName),
    ...jobsFound.map((job) => job.folderName),
    ...machines.flatMap((machine) => machine.folderNames),
    ...sessions.map((session) => session.folderName),
    ...triggers.map((trigger) => trigger.folderName),
  ]);

  return {
    mode,
    scopeLabel,
    folders,
    folderDetails,
    processCount: processesFound.length,
    jobCount: jobsFound.length,
    jobs: jobsFound,
    processes: processesFound,
    machines,
    sessions,
    triggers,
    tenantLicense,
    apiCalls,
    messages,
  };
}
