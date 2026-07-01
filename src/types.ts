export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type TimeGrain = 'day' | 'week' | 'month' | 'year';

export type RiskView = 'folder' | 'process' | 'job' | 'sla';

export interface RuntimeBucket {
  day: string;
  hour: string;
  observedDemand: number;
  projectedDemand: number;
  capacity: number;
  topDrivers: string[];
}

export interface MachineTemplate {
  id: string;
  name: string;
  folders: string[];
  configuredRuntimes: number;
  effectiveRuntimes: number;
  onlineHosts: number;
  totalHosts: number;
  runtimeType: 'Unattended' | 'NonProduction' | 'Serverless';
}

export interface ScheduleRisk {
  id: string;
  folder: string;
  process: string;
  nextRun: string;
  expectedMinutesP90: number;
  expectedMinutesP95: number;
  runtimeDemand: number;
  availableCapacity: number;
  slaMinutes: number;
  projectedLateMinutes: number;
  risk: RiskLevel;
  cause: string;
}

export interface Recommendation {
  id: string;
  title: string;
  type: 'move-schedule' | 'add-runtime' | 'restore-capacity' | 'split-workload' | 'change-window';
  owner: 'Business Owner' | 'COE' | 'Admin' | 'Release Manager';
  impact: string;
  confidence: 'Low' | 'Medium' | 'High';
  basis: string;
}
