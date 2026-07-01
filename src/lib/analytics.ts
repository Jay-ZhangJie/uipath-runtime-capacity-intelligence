import type { MachineTemplate, RiskLevel, RuntimeBucket, ScheduleRisk } from '../types';

export function utilizationPercent(bucket: RuntimeBucket) {
  return Math.round((Math.max(bucket.observedDemand, bucket.projectedDemand) / bucket.capacity) * 100);
}

export function riskFromPercent(percent: number): RiskLevel {
  if (percent >= 100) return 'critical';
  if (percent >= 85) return 'high';
  if (percent >= 60) return 'medium';
  return 'low';
}

export function totalConfiguredRuntimes(templates: MachineTemplate[]) {
  return templates.reduce((sum, item) => sum + item.configuredRuntimes, 0);
}

export function totalEffectiveRuntimes(templates: MachineTemplate[]) {
  return templates.reduce((sum, item) => sum + item.effectiveRuntimes, 0);
}

export function peakDemand(buckets: RuntimeBucket[]) {
  return buckets.reduce((peak, bucket) => Math.max(peak, bucket.projectedDemand), 0);
}

export function filterBucketsByTemplate(buckets: RuntimeBucket[], machineTemplateId: string) {
  if (machineTemplateId === 'all') return buckets;
  return buckets.filter((bucket) => bucket.machineTemplateId === machineTemplateId);
}

export function filterRisks(risks: ScheduleRisk[], folder: string) {
  if (folder === 'All permitted folders') return risks;
  return risks.filter((risk) => risk.folder === folder);
}

export function groupRiskByFolder(risks: ScheduleRisk[]) {
  return Object.values(
    risks.reduce<Record<string, { folder: string; peakDemand: number; lateJobs: number; highestRisk: RiskLevel }>>(
      (acc, risk) => {
        const current = acc[risk.folder] ?? {
          folder: risk.folder,
          peakDemand: 0,
          lateJobs: 0,
          highestRisk: 'low' as RiskLevel,
        };
        current.peakDemand = Math.max(current.peakDemand, risk.runtimeDemand);
        current.lateJobs += risk.projectedLateMinutes > 0 ? 1 : 0;
        current.highestRisk = rankRisk(current.highestRisk) > rankRisk(risk.risk) ? current.highestRisk : risk.risk;
        acc[risk.folder] = current;
        return acc;
      },
      {},
    ),
  );
}

export function rankRisk(risk: RiskLevel) {
  return { low: 0, medium: 1, high: 2, critical: 3 }[risk];
}
