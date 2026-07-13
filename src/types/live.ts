import type { TenantLicenseSummary } from '../types';

export type LiveConnectionStatus = 'not-configured' | 'authenticating' | 'connected' | 'partial' | 'error';
export type LiveProbeMode = 'discovery' | 'heatmap';

export interface ProbeConnectionConfig {
  baseUrl: string;
  orgName: string;
  tenantName: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface PublicConnectionConfig {
  baseUrl: string;
  orgName: string;
  tenantName: string;
  redirectUri: string;
  scopes: string;
}

export interface ApiCallDiagnostic {
  id: string;
  method: 'GET';
  endpoint: string;
  url: string;
  status: 'success' | 'error' | 'skipped';
  statusCode: number | null;
  statusText: string;
  folderId?: number;
  folderName?: string;
  resultSummary: string;
  responsePreview: string;
}

export interface LiveJobSummary {
  key: string;
  id: number | string;
  state: string;
  processName: string;
  folderName: string;
  startTime: string | null;
  endTime: string | null;
  createdTime: string | null;
  sourceType: string;
  hostMachineName: string;
  machineName: string;
  robotName: string;
  userName: string;
  runtimeLaneKey: string;
  runtimeType: string;
  packageType: string;
}

export interface LiveProcessSummary {
  key: string;
  id: number | string;
  name: string;
  folderName: string;
  packageVersion: string;
  targetFramework: string;
}

export interface LiveFolderSummary {
  id: number;
  key: string;
  name: string;
  path: string;
  parentId: number | null;
  parentKey: string | null;
}

export interface LiveMachineSummary {
  key: string;
  id: number | string;
  name: string;
  scope: string;
  type: string;
  unattendedSlots: number;
  nonProductionSlots: number;
  headlessSlots: number;
  testingSlots: number;
  automationCloudSlots: number;
  folderNames: string[];
  hostNames: string[];
  onlineHosts: number;
  totalHosts: number;
}

export interface LiveSessionSummary {
  id: number | string;
  state: string;
  machineName: string;
  hostMachineName: string;
  runtimeType: string;
  robotName: string;
  folderName: string;
  reportingTime: string | null;
}

export interface LiveTriggerSummary {
  key: string;
  id: number | string;
  name: string;
  enabled: boolean;
  processName: string;
  folderName: string;
  triggerType: string;
  cron: string;
  cronSummary: string;
  timeZoneId: string;
  runtimeType: string;
  jobPriority: string;
  nextRun: string | null;
}

export interface LiveProbeResult {
  status: LiveConnectionStatus;
  authenticated: boolean;
  mode: LiveProbeMode;
  scopeLabel: string;
  checkedAt: string;
  config: PublicConnectionConfig | null;
  folders: string[];
  folderDetails: LiveFolderSummary[];
  processCount: number | null;
  jobCount: number | null;
  jobs: LiveJobSummary[];
  processes: LiveProcessSummary[];
  machines: LiveMachineSummary[];
  sessions: LiveSessionSummary[];
  triggers: LiveTriggerSummary[];
  tenantLicense: TenantLicenseSummary | null;
  apiCalls: ApiCallDiagnostic[];
  messages: string[];
}

export interface OrchestratorSnapshot {
  mode: LiveProbeMode;
  scopeLabel: string;
  folders: string[];
  folderDetails: LiveFolderSummary[];
  processCount: number;
  jobCount: number;
  jobs: LiveJobSummary[];
  processes: LiveProcessSummary[];
  machines: LiveMachineSummary[];
  sessions: LiveSessionSummary[];
  triggers: LiveTriggerSummary[];
  tenantLicense: TenantLicenseSummary | null;
  apiCalls: ApiCallDiagnostic[];
  messages: string[];
}

export type RawRecord = Record<string, unknown>;
