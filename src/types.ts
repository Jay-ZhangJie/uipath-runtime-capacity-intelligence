export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type TimeGrain = 'day' | 'week' | 'month';

export type DateRange = 'last-day' | 'last-week' | 'last-month' | 'last-quarter';

export type RiskView = 'folder' | 'process' | 'job' | 'sla';

export interface SelectedTile {
  date: string;
  hour: string;
  minute?: string;
}

export interface RuntimeBucket {
  date: string;
  weekday: string;
  hour: string;
  machineTemplateId: string;
  observedDemand: number;
  projectedDemand: number;
  capacity: number;
  topDrivers: string[];
}

export interface TenantLicenseSummary {
  runtimeAllocated: number | null;
  runtimeUsed: number | null;
  source: 'orchestrator-license-info' | 'tenant-allocation-api' | 'unavailable';
  label: string;
  productCode: string;
  message: string;
}

export interface MachineTemplate {
  id: string;
  name: string;
  machineType: string;
  folders: string[];
  hostNames?: string[];
  templateRuntimeSlots: number;
  connectedMachines: number;
  configuredMaxCapacity: number;
  onlineHosts: number;
  totalHosts: number;
  runtimeType: 'Unattended' | 'NonProduction' | 'Testing' | 'Serverless';
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
  type: 'move-schedule' | 'add-runtime' | 'split-workload' | 'change-window';
  owner: 'Business Owner' | 'COE' | 'Admin' | 'Release Manager';
  impact: string;
  confidence: 'Low' | 'Medium' | 'High';
  basis: string;
}

export interface WhatIfScenario {
  solutionName: string;
  businessDetails: string;
  folder: string;
  machineTemplateId: string;
  preferredDate: string;
  preferredHour: string;
  runtimeDemand: number;
  durationMinutes: number;
}
