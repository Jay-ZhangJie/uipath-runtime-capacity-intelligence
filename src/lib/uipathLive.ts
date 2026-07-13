import type { LiveProbeMode, LiveProbeResult, ProbeConnectionConfig } from '../types/live';
import { authenticateUiPath, getLiveConfig, publicConnectionConfig } from './uipathAuth';
import { retrieveOrchestratorSnapshot } from './orchestratorRetriever';

function checkedAtNow() {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
}

function emptyLiveResult(
  status: LiveProbeResult['status'],
  authenticated: boolean,
  config: ProbeConnectionConfig | null,
  messages: string[],
  mode: LiveProbeMode = 'discovery',
  scopeLabel = 'Discovery only',
): LiveProbeResult {
  return {
    status,
    authenticated,
    mode,
    scopeLabel,
    checkedAt: checkedAtNow(),
    config: config ? publicConnectionConfig(config) : null,
    folders: [],
    folderDetails: [],
    processCount: null,
    jobCount: null,
    jobs: [],
    processes: [],
    machines: [],
    sessions: [],
    triggers: [],
    tenantLicense: null,
    apiCalls: [],
    messages,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type LiveProbeOptions = {
  mode?: LiveProbeMode;
  selectedFolder?: string;
  selectedMachineTemplateId?: string;
  selectedMachineTemplateName?: string;
};

export async function probeLiveOrchestrator(
  override?: ProbeConnectionConfig,
  options: LiveProbeOptions = {},
): Promise<LiveProbeResult> {
  const { config, missing } = getLiveConfig(override);
  const mode = options.mode ?? 'discovery';
  const scopeLabel = mode === 'heatmap'
    ? [
      options.selectedFolder && options.selectedFolder !== 'All permitted folders' ? options.selectedFolder : 'All permitted folders',
      options.selectedMachineTemplateName && !['All templates', 'All machines'].includes(options.selectedMachineTemplateName) ? options.selectedMachineTemplateName : 'All machines',
    ].join(' / ')
    : 'Discovery only';

  if (missing.length) {
    return emptyLiveResult(
      'not-configured',
      false,
      config,
      [`Missing required browser OAuth config: ${missing.join(', ')}`],
      mode,
      scopeLabel,
    );
  }

  try {
    const authResult = await authenticateUiPath(config);
    if (authResult.status === 'authenticating') {
      return emptyLiveResult('authenticating', false, config, [authResult.message], mode, scopeLabel);
    }

    const snapshot = await retrieveOrchestratorSnapshot(authResult.sdk, config, {
      mode,
      selectedFolder: options.selectedFolder,
      selectedMachineTemplateId: options.selectedMachineTemplateId,
      selectedMachineTemplateName: options.selectedMachineTemplateName,
    });
    return {
      status: snapshot.messages.length ? 'partial' : 'connected',
      authenticated: authResult.sdk.isAuthenticated(),
      mode: snapshot.mode,
      scopeLabel: snapshot.scopeLabel,
      checkedAt: checkedAtNow(),
      config: publicConnectionConfig(config),
      folders: snapshot.folders,
      folderDetails: snapshot.folderDetails,
      processCount: snapshot.processCount,
      jobCount: snapshot.jobCount,
      jobs: snapshot.jobs,
      processes: snapshot.processes,
      machines: snapshot.machines,
      sessions: snapshot.sessions,
      triggers: snapshot.triggers,
      tenantLicense: snapshot.tenantLicense,
      apiCalls: snapshot.apiCalls,
      messages: snapshot.messages.length
        ? snapshot.messages
        : ['SDK authenticated and read-only Orchestrator reads completed.'],
    };
  } catch (error) {
    return emptyLiveResult('error', false, config, [`OAuth or Orchestrator read failed: ${errorMessage(error)}`], mode, scopeLabel);
  }
}

export {
  getDefaultRedirectUri,
  logoutLiveOrchestrator,
  normalizeOrganizationSlug,
  normalizeSdkBaseUrl,
} from './uipathAuth';
export type { LiveProbeResult, ProbeConnectionConfig } from '../types/live';
export type { LiveFolderSummary } from '../types/live';
