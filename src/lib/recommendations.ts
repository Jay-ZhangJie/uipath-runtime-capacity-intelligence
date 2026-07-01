import type { MachineTemplate, Recommendation, ScheduleRisk } from '../types';

export function buildRecommendations(risks: ScheduleRisk[], templates: MachineTemplate[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const disconnectedSlots = templates.reduce(
    (sum, template) => sum + Math.max(0, template.configuredRuntimes - template.effectiveRuntimes),
    0,
  );
  const criticalRisk = risks.find((risk) => risk.risk === 'critical');
  const financeRisk = risks.find((risk) => risk.folder === 'Finance' && risk.projectedLateMinutes > 0);

  if (financeRisk) {
    recommendations.push({
      id: 'move-finance-window',
      type: 'move-schedule',
      owner: 'Release Manager',
      title: `Move ${financeRisk.process} out of ${financeRisk.nextRun}`,
      impact: `Expected to remove ${Math.min(financeRisk.projectedLateMinutes, 31)} minutes of SLA risk without extra runtimes.`,
      confidence: 'High',
      basis: '90 days of job history plus next 14 days trigger projection',
    });
  }

  if (criticalRisk) {
    recommendations.push({
      id: 'add-runtime-peak',
      type: 'add-runtime',
      owner: 'COE',
      title: `Add ${Math.max(2, criticalRisk.runtimeDemand - criticalRisk.availableCapacity + 1)} unattended runtimes if ${criticalRisk.nextRun} is fixed`,
      impact: 'Protects critical period under p95 duration and keeps one runtime as buffer.',
      confidence: 'Medium',
      basis: 'Projected peak demand exceeds effective capacity during blackout-sensitive window',
    });
  }

  if (disconnectedSlots > 0) {
    recommendations.push({
      id: 'restore-host-capacity',
      type: 'restore-capacity',
      owner: 'Admin',
      title: `Restore ${disconnectedSlots} unavailable runtime slots`,
      impact: 'Raises effective capacity before purchasing additional licenses.',
      confidence: 'High',
      basis: 'Machine template inventory shows configured runtimes above effective runtime count',
    });
  }

  recommendations.push({
    id: 'blackout-policy',
    type: 'change-window',
    owner: 'Business Owner',
    title: 'Mark month-end 18:00-22:00 as protected',
    impact: 'Prevents lower-priority schedules from landing in the highest-risk business window.',
    confidence: 'Medium',
    basis: 'Critical-process priority and blackout configuration',
  });

  return recommendations;
}
