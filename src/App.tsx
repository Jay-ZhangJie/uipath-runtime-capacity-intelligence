import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cpu,
  LogIn,
  LogOut,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { folders, machineTemplates, runtimeBuckets, scheduleRisks, tenants } from './data/demoData';
import {
  filterBucketsByTemplate,
  filterRisks,
  groupRiskByFolder,
  peakDemand,
  riskFromPercent,
  totalConfiguredRuntimes,
  totalEffectiveRuntimes,
  utilizationPercent,
} from './lib/analytics';
import { buildRecommendations } from './lib/recommendations';
import type { DateRange, Recommendation, RiskLevel, RiskView, RuntimeBucket, TimeGrain, WhatIfScenario } from './types';

const grains: TimeGrain[] = ['day', 'week', 'month'];
const riskViews: RiskView[] = ['folder', 'process', 'job', 'sla'];
const dateRanges: Array<{ value: DateRange; label: string }> = [
  { value: 'last-day', label: 'Last day' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-quarter', label: 'Last quarter' },
];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const hours24 = Array.from({ length: 24 }, (_, hour) => hour.toString().padStart(2, '0'));

const defaultScenario: WhatIfScenario = {
  solutionName: 'New Finance Automation',
  folder: 'Finance',
  machineTemplateId: 'mt-prod-windows',
  preferredDay: 'Tue',
  preferredHour: '08',
  runtimeDemand: 2,
  durationMinutes: 75,
  priority: 'High',
};

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

function hourlyDemandFor(day: string, hour: string, buckets: RuntimeBucket[]) {
  const hourNumber = Number(hour);
  const baseHour = (Math.floor(hourNumber / 2) * 2).toString().padStart(2, '0');
  const baseBucket = buckets.find((bucket) => bucket.day === day && bucket.hour === baseHour);
  if (!baseBucket) return null;

  const adjustment = hourNumber % 2 === 0 ? 0 : -1;
  return {
    ...baseBucket,
    hour,
    observedDemand: Math.max(0, baseBucket.observedDemand + adjustment),
    projectedDemand: Math.max(0, baseBucket.projectedDemand + adjustment),
  };
}

function applyScenarioImpact(buckets: RuntimeBucket[], scenario: WhatIfScenario | null) {
  if (!scenario) return buckets;

  const impactedHours = Math.max(1, Math.ceil(scenario.durationMinutes / 60));
  const startHour = Number(scenario.preferredHour);

  return buckets.map((bucket) => {
    if (bucket.day !== scenario.preferredDay) return bucket;
    if (scenario.machineTemplateId !== bucket.machineTemplateId) return bucket;

    const bucketHour = Number(bucket.hour);
    const isImpacted = bucketHour >= startHour && bucketHour < startHour + impactedHours;
    if (!isImpacted) return bucket;

    return {
      ...bucket,
      projectedDemand: bucket.projectedDemand + scenario.runtimeDemand,
      topDrivers: [scenario.solutionName, ...bucket.topDrivers],
    };
  });
}

function buildGrainBuckets(grain: TimeGrain, buckets: RuntimeBucket[], selectedDay: string) {
  if (grain === 'day') {
    return hours24
      .map((hour) => hourlyDemandFor(selectedDay, hour, buckets))
      .filter((bucket): bucket is RuntimeBucket => Boolean(bucket));
  }

  if (grain === 'month') {
    return days.map((day) => {
      const dayBuckets = buckets.filter((bucket) => bucket.day === day);
      const peak = dayBuckets.reduce((max, bucket) => Math.max(max, utilizationPercent(bucket)), 0);
      const sample = dayBuckets[0];
      return {
        ...sample,
        day: `Month ${day}`,
        hour: 'Peak',
        observedDemand: Math.round((peak / 100) * (sample?.capacity ?? 18)),
        projectedDemand: Math.round((peak / 100) * (sample?.capacity ?? 18)),
        capacity: sample?.capacity ?? 18,
        topDrivers: dayBuckets.flatMap((bucket) => bucket.topDrivers).slice(0, 3),
      };
    });
  }

  return buckets;
}

export function App() {
  const [signedIn, setSignedIn] = useState(true);
  const [tenant, setTenant] = useState(tenants[0]);
  const [folder, setFolder] = useState(folders[0]);
  const [dateRange, setDateRange] = useState<DateRange>('last-week');
  const [machineTemplateId, setMachineTemplateId] = useState('all');
  const [grain, setGrain] = useState<TimeGrain>('week');
  const [riskView, setRiskView] = useState<RiskView>('folder');
  const [selectedDay, setSelectedDay] = useState('Tue');
  const [selectedTile, setSelectedTile] = useState<{ day: string; hour: string } | null>({ day: 'Tue', hour: '08' });
  const [scenarioForm, setScenarioForm] = useState<WhatIfScenario>(defaultScenario);
  const [submittedScenario, setSubmittedScenario] = useState<WhatIfScenario | null>(defaultScenario);

  const visibleRisks = useMemo(() => filterRisks(scheduleRisks, folder), [folder]);
  const filteredBaseBuckets = useMemo(
    () => filterBucketsByTemplate(runtimeBuckets, machineTemplateId),
    [machineTemplateId],
  );
  const projectedBuckets = useMemo(
    () => applyScenarioImpact(filteredBaseBuckets, submittedScenario),
    [filteredBaseBuckets, submittedScenario],
  );
  const heatmapBuckets = useMemo(
    () => buildGrainBuckets(grain, projectedBuckets, selectedDay),
    [grain, projectedBuckets, selectedDay],
  );
  const recommendations = useMemo(() => {
    const base = buildRecommendations(visibleRisks, machineTemplates);
    if (!submittedScenario) return base;

    const scenarioRec: Recommendation = {
      id: 'what-if-impact',
      type: 'move-schedule',
      owner: 'Release Manager',
      title: `${submittedScenario.solutionName} changes ${submittedScenario.preferredDay} ${submittedScenario.preferredHour}:00 demand`,
      impact: `Adds ${submittedScenario.runtimeDemand} runtime(s) for about ${submittedScenario.durationMinutes} minutes. Review the highlighted heatmap tiles before choosing this slot.`,
      confidence: 'Medium',
      basis: 'Fixture-backed what-if overlay using current machine template filter and submitted scenario',
    };
    return [scenarioRec, ...base];
  }, [submittedScenario, visibleRisks]);
  const configuredRuntimes = totalConfiguredRuntimes(machineTemplates);
  const effectiveRuntimes = totalEffectiveRuntimes(machineTemplates);
  const projectedPeakDemand = peakDemand(projectedBuckets);
  const riskWindows = projectedBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;
  const folderRiskRows = groupRiskByFolder(visibleRisks);
  const selectedBucket = selectedTile ? hourlyDemandFor(selectedTile.day, selectedTile.hour, projectedBuckets) : null;

  function submitScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedScenario(scenarioForm);
    setSelectedDay(scenarioForm.preferredDay);
    setSelectedTile({ day: scenarioForm.preferredDay, hour: scenarioForm.preferredHour });
    setGrain('day');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1>Runtime Capacity Intelligence</h1>
            <p>Read-only UiPath schedule, runtime, and SLA planning</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="session-chip">
            <ShieldCheck size={16} />
            {signedIn ? `Signed in - ${tenant}` : 'Demo mode'}
          </div>
          <button className="button secondary" type="button" onClick={() => setSignedIn((value) => !value)}>
            {signedIn ? <LogOut size={16} /> : <LogIn size={16} />}
            {signedIn ? 'Sign out' : 'Sign in'}
          </button>
        </div>
      </header>

      <main>
        <section className="filters-panel" aria-label="Permission scoped filters">
          <label>
            <span>Tenant</span>
            <select value={tenant} onChange={(event) => setTenant(event.target.value)}>
              {tenants.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Folder</span>
            <select value={folder} onChange={(event) => setFolder(event.target.value)}>
              {folders.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Machine Template</span>
            <select value={machineTemplateId} onChange={(event) => setMachineTemplateId(event.target.value)}>
              <option value="all">All templates</option>
              {machineTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Date Range</span>
            <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
              {dateRanges.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <div className="access-note">
            <CheckCircle2 size={16} />
            Filters are permission-scoped. Future impact is shown only through the what-if scenario overlay.
          </div>
        </section>

        <section className="kpi-grid" aria-label="Capacity summary">
          <MetricCard label="Configured Runtimes" value={configuredRuntimes} detail="Across machine templates" icon={<Cpu />} />
          <MetricCard label="Effective Capacity" value={effectiveRuntimes} detail="After disconnected hosts" icon={<Server />} />
          <MetricCard label="Projected Peak Demand" value={projectedPeakDemand} detail="Includes what-if overlay" icon={<Clock3 />} />
          <MetricCard label="Risk Windows" value={riskWindows} detail="Buckets at or above 85%" icon={<AlertTriangle />} tone="warn" />
        </section>

        <section className="workspace-grid single-column">
          <div className="main-column">
            <section className="panel">
              <PanelHeader
                icon={<CalendarClock size={18} />}
                title="Runtime Heatmap"
                subtitle="Click a tile to inspect detail. Switch to Day for 24-hour drilldown."
              />
              <div className="heatmap-planner-grid">
                <div>
                  <SegmentedControl
                    items={grains}
                    value={grain}
                    onChange={setGrain}
                    labelFormatter={(item) => item.charAt(0).toUpperCase() + item.slice(1)}
                  />
                  {grain === 'day' ? (
                    <label className="inline-filter">
                      <span>Focus day</span>
                      <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>
                        {days.map((day) => (
                          <option key={day}>{day}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <Heatmap
                    buckets={heatmapBuckets}
                    grain={grain}
                    selectedTile={selectedTile}
                    onTileClick={(tile) => {
                      setSelectedTile(tile);
                      if (grain !== 'day') setSelectedDay(tile.day.replace('Month ', ''));
                    }}
                  />
                  {selectedBucket ? (
                    <div className="tile-detail">
                      <strong>{selectedTile?.day} {selectedTile?.hour}:00 detail</strong>
                      <span>{utilizationPercent(selectedBucket)}% utilization</span>
                      <span>Observed {selectedBucket.observedDemand} / projected {selectedBucket.projectedDemand} / capacity {selectedBucket.capacity}</span>
                      <span>Drivers: {selectedBucket.topDrivers.join(', ')}</span>
                    </div>
                  ) : null}
                </div>
                <WhatIfPlanner
                  scenario={scenarioForm}
                  onChange={setScenarioForm}
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
                <table>
                  <thead>
                    <tr>
                      <th>Folder</th>
                      <th>Peak Demand</th>
                      <th>Late Jobs</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folderRiskRows.map((row) => (
                      <tr key={row.folder}>
                        <td>{row.folder}</td>
                        <td>{row.peakDemand} runtimes</td>
                        <td>{row.lateJobs}</td>
                        <td><RiskPill risk={row.highestRisk} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{riskView === 'sla' ? 'SLA Exception' : 'Automation'}</th>
                      <th>Folder</th>
                      <th>Next Run</th>
                      <th>Late By</th>
                      <th>Cause</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRisks
                      .filter((risk) => riskView !== 'sla' || risk.projectedLateMinutes > 0)
                      .map((risk) => (
                        <tr key={risk.id}>
                          <td>{risk.process}</td>
                          <td>{risk.folder}</td>
                          <td>{risk.nextRun}</td>
                          <td>{risk.projectedLateMinutes ? `${risk.projectedLateMinutes} min` : '-'}</td>
                          <td>{risk.cause}</td>
                          <td><RiskPill risk={risk.risk} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="panel">
              <PanelHeader
                icon={<Server size={18} />}
                title="Machine Template and Runtime Inventory"
                subtitle="High-level runtime configuration and effective capacity"
              />
              <div className="inventory-summary">
                <MiniStat label="Machine Templates" value={machineTemplates.length} detail="Permission visible" />
                <MiniStat label="Configured Slots" value={configuredRuntimes} detail="Unattended runtime count" />
                <MiniStat label="Unavailable Slots" value={configuredRuntimes - effectiveRuntimes} detail="Host/session driven" />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Folders</th>
                    <th>Configured</th>
                    <th>Effective</th>
                    <th>Hosts</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {machineTemplates.map((template) => {
                    const constrained = template.effectiveRuntimes < template.configuredRuntimes;
                    return (
                      <tr key={template.id}>
                        <td>{template.name}</td>
                        <td>{template.folders.join(', ')}</td>
                        <td>{template.configuredRuntimes}</td>
                        <td>{template.effectiveRuntimes}</td>
                        <td>{template.onlineHosts} of {template.totalHosts} online</td>
                        <td>
                          <span className={`pill ${constrained ? 'tone-high' : 'tone-low'}`}>
                            {constrained ? 'Capacity loss' : 'Balanced'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
        </section>
      </main>
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
  value: number;
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

function Heatmap({
  buckets,
  grain,
  selectedTile,
  onTileClick,
}: {
  buckets: RuntimeBucket[];
  grain: TimeGrain;
  selectedTile: { day: string; hour: string } | null;
  onTileClick: (tile: { day: string; hour: string }) => void;
}) {
  const columns = grain === 'day' ? hours24 : grain === 'month' ? ['Peak'] : ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
  const rowLabels = grain === 'day' ? [buckets[0]?.day ?? 'Day'] : grain === 'month' ? days.map((day) => `Month ${day}`) : days;

  return (
    <div className={`heatmap heatmap-${grain}`} aria-label="Runtime utilization heatmap">
      <div className="heatmap-label">{grain === 'day' ? 'Hour' : 'Day'}</div>
      {columns.map((column) => (
        <div className="heatmap-label" key={column}>{column}</div>
      ))}
      {rowLabels.map((rowLabel) => (
        <div className="heatmap-row" key={rowLabel}>
          <button
            className="heatmap-label heatmap-row-button"
            onClick={() => onTileClick({ day: rowLabel.replace('Month ', ''), hour: '00' })}
            type="button"
          >
            {rowLabel}
          </button>
          {columns.map((column) => {
            const bucket =
              grain === 'day'
                ? buckets.find((item) => item.hour === column)
                : buckets.find((item) => item.day === rowLabel && item.hour === column);
            if (!bucket) return <div className="heatmap-empty" key={`${rowLabel}-${column}`} />;

            const percent = utilizationPercent(bucket);
            const risk = riskFromPercent(percent);
            const isSelected = selectedTile?.day === bucket.day.replace('Month ', '') && selectedTile.hour === bucket.hour;
            return (
              <button
                className={`heatmap-cell ${riskTone(risk)} ${isSelected ? 'selected' : ''}`}
                key={`${bucket.day}-${bucket.hour}`}
                onClick={() => onTileClick({ day: bucket.day.replace('Month ', ''), hour: bucket.hour === 'Peak' ? '00' : bucket.hour })}
                title={`${bucket.topDrivers.join(', ')} - ${percent}%`}
                type="button"
              >
                {percent}%
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WhatIfPlanner({
  scenario,
  onChange,
  onSubmit,
}: {
  scenario: WhatIfScenario;
  onChange: (scenario: WhatIfScenario) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="what-if-panel" onSubmit={onSubmit}>
      <div>
        <h3>To-be-deployed solution</h3>
        <p>Submit to overlay projected runtime demand on the heatmap.</p>
      </div>
      <label>
        <span>Solution name</span>
        <input
          value={scenario.solutionName}
          onChange={(event) => onChange({ ...scenario, solutionName: event.target.value })}
        />
      </label>
      <label>
        <span>Folder</span>
        <select value={scenario.folder} onChange={(event) => onChange({ ...scenario, folder: event.target.value })}>
          {folders.filter((item) => item !== 'All permitted folders').map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Machine template</span>
        <select
          value={scenario.machineTemplateId}
          onChange={(event) => onChange({ ...scenario, machineTemplateId: event.target.value })}
        >
          {machineTemplates.map((template) => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          <span>Day</span>
          <select value={scenario.preferredDay} onChange={(event) => onChange({ ...scenario, preferredDay: event.target.value })}>
            {days.map((day) => (
              <option key={day}>{day}</option>
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
      <button className="button primary" type="submit">Submit scenario</button>
    </form>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="mini-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RiskPill({ risk }: { risk: RiskLevel }) {
  return <span className={`pill ${riskTone(risk)}`}>{riskLabel(risk)}</span>;
}
