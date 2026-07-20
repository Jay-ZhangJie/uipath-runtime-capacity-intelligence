import type { JobGetResponse } from '@uipath/uipath-typescript/jobs';
import type { ProcessGetResponse } from '@uipath/uipath-typescript/processes';
import type {
  LiveFolderSummary,
  LiveJobSummary,
  LiveMachineSummary,
  LiveProcessSummary,
  LiveSessionSummary,
  LiveTriggerSummary,
  RawRecord,
} from '../types/live';

function firstValue(record: RawRecord, keys: string[]) {
  return keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function textField(record: RawRecord, keys: string[], fallback = '') {
  return textValue(firstValue(record, keys), fallback);
}

function numberField(record: RawRecord, keys: string[], fallback = 0) {
  const value = firstValue(record, keys);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function idField(record: RawRecord, keys: string[], fallback: string): number | string {
  const value = firstValue(record, keys);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return fallback;
}

function booleanField(record: RawRecord, keys: string[], fallback = false) {
  const value = firstValue(record, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

function nullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableTextField(record: RawRecord, keys: string[]) {
  return nullableText(firstValue(record, keys));
}

function nestedRecord(record: RawRecord, keys: string[]) {
  const value = firstValue(record, keys);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : null;
}

function slotCount(record: RawRecord, keys: string[]) {
  return keys.reduce((sum, key) => sum + numberField(record, [key], 0), 0);
}

function normalizeMachineType(value: string) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (!normalized || lower === 'template' || lower === 'machinetemplate' || lower === 'machine template') return 'Machine template';
  if (lower === 'elasticrobotpool' || lower === 'elastic robot pool') return 'Elastic Robot Pool';
  if (lower === 'cloudrobotvm' || lower === 'cloud robot vm' || lower === 'cloud robot - vm') return 'Cloud Robot - VM';
  if (lower === 'cloudrobotserverless' || lower === 'cloud robot serverless' || lower === 'cloud robot - serverless') return 'Cloud Robot - Serverless';
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function knownText(value: string) {
  return value && !['Unknown', 'Unknown host', 'Unknown machine', 'Unassigned'].includes(value) ? value : '';
}

function normalizeIdentity(value: string | number | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function runtimeLaneKey(record: RawRecord, fallbackKey: string) {
  const host = knownText(textField(record, ['HostMachineName', 'hostMachineName', 'HostMachine', 'hostMachine']));
  const machine = knownText(textField(record, ['MachineName', 'machineName', 'Machine', 'machine']));
  const robot = knownText(textField(record, ['RobotName', 'robotName', 'Robot', 'robot', 'ExecutorName', 'executorName']));
  const user = knownText(textField(record, ['UserName', 'userName', 'Username', 'username', 'ExecutingUserName', 'executingUserName']));
  const primaryHost = host || machine;
  const executor = user || robot;

  if (primaryHost && executor) return `${primaryHost} / ${executor}`;
  if (executor) return executor;
  return `job:${fallbackKey}`;
}

export function summarizeJob(job: JobGetResponse, fallbackFolderName = 'Unknown folder'): LiveJobSummary {
  const record = job as unknown as RawRecord;
  const key = textValue(job.key, String(job.id ?? 'job'));
  const hostMachineName = textField(record, ['hostMachineName', 'HostMachineName'], 'Unassigned');
  const machineName = textField(record, ['machineName', 'MachineName', 'machine', 'Machine'], hostMachineName);
  const robotName = textField(record, ['robotName', 'RobotName', 'robot', 'Robot', 'executorName', 'ExecutorName']);
  const userName = textField(record, ['userName', 'UserName', 'username', 'Username', 'executingUserName', 'ExecutingUserName']);

  return {
    key,
    id: job.id ?? textValue(job.key, 'job'),
    state: textValue(job.state, 'Unknown'),
    processName: textValue(job.processName, 'Unknown process'),
    folderName: textValue(job.folderName, fallbackFolderName),
    startTime: nullableText(job.startTime),
    endTime: nullableText(job.endTime),
    createdTime: nullableText(job.createdTime),
    sourceType: textValue(job.sourceType, 'Unknown'),
    hostMachineName,
    machineName,
    robotName,
    userName,
    runtimeLaneKey: runtimeLaneKey(record, key),
    runtimeType: textValue(job.runtimeType, 'Unknown'),
    packageType: textValue(job.packageType, 'Unknown'),
  };
}

export function summarizeJobRecord(record: RawRecord, fallbackFolderName = 'Unknown folder'): LiveJobSummary {
  const key = textField(record, ['Key', 'key'], String(idField(record, ['Id', 'id'], 'job')));
  const hostMachineName = textField(record, ['HostMachineName', 'hostMachineName', 'HostMachine', 'hostMachine'], 'Unassigned');
  const machineName = textField(record, ['MachineName', 'machineName', 'Machine', 'machine'], hostMachineName);
  const robotName = textField(record, ['RobotName', 'robotName', 'Robot', 'robot', 'ExecutorName', 'executorName']);
  const userName = textField(record, ['UserName', 'userName', 'Username', 'username', 'ExecutingUserName', 'executingUserName']);

  return {
    key,
    id: idField(record, ['Id', 'id', 'Key', 'key'], 'job'),
    state: textField(record, ['State', 'state'], 'Unknown'),
    processName: textField(record, ['ProcessName', 'processName', 'ReleaseName', 'releaseName'], 'Unknown process'),
    folderName: textField(
      record,
      ['FolderName', 'folderName', 'OrganizationUnitName', 'organizationUnitName', 'OrganizationUnitFullyQualifiedName', 'organizationUnitFullyQualifiedName'],
      fallbackFolderName,
    ),
    startTime: nullableTextField(record, ['StartTime', 'startTime']),
    endTime: nullableTextField(record, ['EndTime', 'endTime']),
    createdTime: nullableTextField(record, ['CreationTime', 'creationTime', 'CreatedTime', 'createdTime']),
    sourceType: textField(record, ['SourceType', 'sourceType', 'Source', 'source'], 'Unknown'),
    hostMachineName,
    machineName,
    robotName,
    userName,
    runtimeLaneKey: runtimeLaneKey(record, key),
    runtimeType: textField(record, ['RuntimeType', 'runtimeType', 'RobotType', 'robotType'], 'Unknown'),
    packageType: textField(record, ['PackageType', 'packageType', 'Type', 'type'], 'Unknown'),
  };
}

export function summarizeProcess(process: ProcessGetResponse, fallbackFolderName = 'Unknown folder'): LiveProcessSummary {
  return {
    key: textValue(process.key, String(process.id ?? 'process')),
    id: process.id ?? textValue(process.key, 'process'),
    name: textValue(process.name, 'Unknown process'),
    folderName: textValue(process.folderName, fallbackFolderName),
    packageVersion: textValue(process.packageVersion, 'Unknown'),
    targetFramework: textValue(process.targetFramework, 'Unknown'),
  };
}

export function summarizeFolder(record: RawRecord): LiveFolderSummary | null {
  const id = numberField(record, ['Id', 'id'], 0);
  if (!id) return null;

  const key = textField(record, ['Key', 'key'], String(id));
  const name = textField(record, ['DisplayName', 'displayName', 'Name', 'name'], `Folder ${id}`);
  const path = textField(record, ['FullyQualifiedName', 'fullyQualifiedName', 'Path', 'path'], name);
  const parentId = numberField(record, ['ParentId', 'parentId'], 0) || null;
  const parentKey = nullableTextField(record, ['ParentKey', 'parentKey']);
  return { id, key, name, path, parentId, parentKey };
}

export function summarizeSession(record: RawRecord): LiveSessionSummary {
  const robot = nestedRecord(record, ['Robot', 'robot']);
  const machineName = textField(record, ['MachineName', 'machineName', 'Machine', 'machine']) ||
    (robot ? textField(robot, ['MachineName', 'machineName', 'Machine', 'machine']) : '');
  const hostMachineName = textField(record, ['HostMachineName', 'hostMachineName', 'HostMachine', 'hostMachine']) ||
    (robot ? textField(robot, ['HostMachineName', 'hostMachineName', 'MachineName', 'machineName']) : '');
  const runtimeType = textField(record, ['RuntimeType', 'runtimeType', 'RobotType', 'robotType']) ||
    (robot ? textField(robot, ['RuntimeType', 'runtimeType', 'RobotType', 'robotType', 'Type', 'type']) : '');
  const robotName = textField(record, ['RobotName', 'robotName', 'Name', 'name']) ||
    (robot ? textField(robot, ['Name', 'name', 'RobotName', 'robotName']) : '');

  return {
    id: idField(record, ['Id', 'id', 'Key', 'key'], 'session'),
    state: textField(record, ['State', 'state'], 'Unknown'),
    machineName: textValue(machineName, 'Unknown machine'),
    hostMachineName: textValue(hostMachineName, 'Unknown host'),
    runtimeType: textValue(runtimeType, 'Unknown'),
    robotName: textValue(robotName, 'Unknown robot'),
    folderName: textField(
      record,
      ['FolderName', 'folderName', 'OrganizationUnitName', 'organizationUnitName', 'OrganizationUnitFullyQualifiedName', 'organizationUnitFullyQualifiedName'],
      'Unknown folder',
    ),
    reportingTime: nullableTextField(record, ['ReportingTime', 'reportingTime', 'LastSeen', 'lastSeen']),
  };
}

export function summarizeMachine(record: RawRecord, sessions: LiveSessionSummary[] = []): LiveMachineSummary {
  const key = textField(record, ['Key', 'key', 'LicenseKey', 'licenseKey'], String(numberField(record, ['Id', 'id'], 0)));
  const name = textField(record, ['Name', 'name', 'MachineName', 'machineName'], 'Unknown machine');
  const machineIdentityValues = new Set([
    normalizeIdentity(name),
    normalizeIdentity(key),
    normalizeIdentity(numberField(record, ['Id', 'id'], 0)),
  ].filter(Boolean));
  const relatedSessions = sessions.filter((session) =>
    machineIdentityValues.has(normalizeIdentity(session.machineName)) ||
    machineIdentityValues.has(normalizeIdentity(session.hostMachineName)),
  );
  const hostNames = Array.from(
    new Set(
      relatedSessions
        .map((session) => knownText(session.hostMachineName) || knownText(session.machineName))
        .filter(Boolean),
    ),
  );
  const onlineHosts = new Set(
    relatedSessions
      .filter((session) => ['Available', 'Busy', 'Connected'].includes(session.state))
      .map((session) => knownText(session.hostMachineName) || knownText(session.machineName))
      .filter(Boolean),
  ).size;
  const totalHosts = new Set(
    relatedSessions
      .map((session) => knownText(session.hostMachineName) || knownText(session.machineName))
      .filter(Boolean),
  ).size;
  const folderNames = Array.from(
    new Set(
      [
        textField(record, ['FolderName', 'folderName', 'OrganizationUnitName', 'organizationUnitName']),
        textField(record, ['OrganizationUnitFullyQualifiedName', 'organizationUnitFullyQualifiedName']),
        ...relatedSessions.map((session) => session.folderName),
      ].filter((value) => value && value !== 'Unknown folder'),
    ),
  );

  return {
    key,
    id: idField(record, ['Id', 'id', 'Key', 'key'], key),
    name,
    scope: textField(record, ['Scope', 'scope'], 'Default'),
    type: normalizeMachineType(textField(record, ['Type', 'type', 'MachineType', 'machineType'], 'Template')),
    unattendedSlots: slotCount(record, ['UnattendedSlots', 'unattendedSlots', 'UnattendedRobotSlots', 'unattendedRobotSlots']),
    nonProductionSlots: slotCount(record, ['NonProductionSlots', 'nonProductionSlots', 'NonProductionRobotSlots', 'nonProductionRobotSlots']),
    headlessSlots: slotCount(record, ['HeadlessSlots', 'headlessSlots']),
    testingSlots: slotCount(record, ['TestingSlots', 'testingSlots', 'TestAutomationSlots', 'testAutomationSlots']),
    automationCloudSlots: slotCount(record, ['AutomationCloudSlots', 'automationCloudSlots', 'AutomationCloudRobotSlots', 'automationCloudRobotSlots']),
    folderNames,
    hostNames,
    onlineHosts,
    totalHosts: Math.max(totalHosts, onlineHosts),
  };
}

export function summarizeTrigger(record: RawRecord): LiveTriggerSummary {
  const queueName = textField(record, ['QueueDefinitionName', 'queueDefinitionName']);
  const type = queueName
    ? 'Queue'
    : textField(record, ['TriggerType', 'triggerType', 'ProcessScheduleType', 'processScheduleType', 'Type', 'type'], 'Time');

  return {
    key: textField(record, ['Key', 'key'], String(numberField(record, ['Id', 'id'], 0))),
    id: idField(record, ['Id', 'id', 'Key', 'key'], 'trigger'),
    name: textField(record, ['Name', 'name'], 'Unknown trigger'),
    enabled: booleanField(record, ['Enabled', 'enabled', 'IsEnabled', 'isEnabled'], false),
    processName: textField(record, ['ReleaseName', 'releaseName', 'ProcessName', 'processName'], 'Unknown process'),
    folderName: textField(
      record,
      ['FolderName', 'folderName', 'OrganizationUnitName', 'organizationUnitName', 'OrganizationUnitFullyQualifiedName', 'organizationUnitFullyQualifiedName'],
      'Unknown folder',
    ),
    triggerType: type,
    cron: textField(record, ['StartProcessCron', 'startProcessCron', 'CronExpression', 'cronExpression']),
    cronSummary: textField(record, ['StartProcessCronSummary', 'startProcessCronSummary', 'CronSummary', 'cronSummary']),
    timeZoneId: textField(record, ['TimeZoneId', 'timeZoneId'], 'Tenant default'),
    runtimeType: textField(record, ['RuntimeType', 'runtimeType'], 'Unattended'),
    jobPriority: textField(record, ['JobPriority', 'jobPriority'], 'Normal'),
    nextRun: nullableTextField(record, ['NextOccurrence', 'nextOccurrence', 'NextRunTime', 'nextRunTime']),
  };
}

export function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b),
  );
}
