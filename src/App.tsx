import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cpu,
  Info,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import {
  defaultFocusDate,
  folders,
  hours24,
  machineTemplates,
  monthDates,
  quarterDates,
  runtimeBuckets,
  scheduleRisks,
  tenants,
  weekDates,
} from './data/demoData';
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

type SelectedTile = { date: string; hour: string };
type DataSignalTone = 'ok' | 'info' | 'warning' | 'error';

type DataSignal = {
  id: string;
  tone: DataSignalTone;
  title: string;
  detail: string;
  timestamp?: string;
};

const grains: TimeGrain[] = ['day', 'week', 'month'];
const riskViews: RiskView[] = ['folder', 'process', 'job', 'sla'];
const dateRanges: Array<{ value: DateRange; label: string }> = [
  { value: 'last-day', label: 'Last day' },
  { value: 'last-week', label: 'Last week' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-quarter', label: 'Last quarter' },
];
const weekdayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const tenantTimezone = 'America/New_York';
const tenantTimezoneLabel = 'America/New_York (Eastern Time)';
const dayPeriods = [
  { label: '00:00-05:59', hours: hours24.slice(0, 6) },
  { label: '06:00-11:59', hours: hours24.slice(6, 12) },
  { label: '12:00-17:59', hours: hours24.slice(12, 18) },
  { label: '18:00-23:59', hours: hours24.slice(18, 24) },
];
const demoLastAttemptedPull = '2026-07-01 08:35 ET';
const demoLastSuccessfulPull = '2026-07-01 08:30 ET';

const defaultScenario: WhatIfScenario = {
  solutionName: 'New Finance Automation',
  folder: 'Finance',
  machineTemplateId: 'mt-prod-windows',
  preferredDate: '2026-07-07',
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

function formatDate(date: string, style: 'short' | 'long' = 'short') {
  const value = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: style === 'long' ? 'long' : 'short',
    month: 'short',
    day: 'numeric',
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: tenantTimezone,
  }).format(value);
}

function dayNumber(date: string) {
  return Number(date.split('-')[2]);
}

function dateOptionsForRange(range: DateRange) {
  if (range === 'last-day') return [defaultFocusDate];
  if (range === 'last-week') return weekDates;
  if (range === 'last-month') return monthDates;
  return quarterDates;
}

function filterBucketsByDateRange(buckets: RuntimeBucket[], range: DateRange) {
  const allowedDates = new Set(dateOptionsForRange(range));
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

export function App() {
  const [signedIn, setSignedIn] = useState(true);
  const [tenant, setTenant] = useState(tenants[0]);
  const [folder, setFolder] = useState(folders[0]);
  const [dateRange, setDateRange] = useState<DateRange>('last-week');
  const [machineTemplateId, setMachineTemplateId] = useState('all');
  const [grain, setGrain] = useState<TimeGrain>('week');
  const [riskView, setRiskView] = useState<RiskView>('folder');
  const [selectedDate, setSelectedDate] = useState(defaultFocusDate);
  const [selectedTile, setSelectedTile] = useState<SelectedTile>({ date: defaultFocusDate, hour: '08' });
  const [scenarioForm, setScenarioForm] = useState<WhatIfScenario>(defaultScenario);
  const [submittedScenario, setSubmittedScenario] = useState<WhatIfScenario | null>(defaultScenario);

  const visibleRisks = useMemo(() => filterRisks(scheduleRisks, folder), [folder]);
  const dateOptions = useMemo(() => dateOptionsForRange(dateRange), [dateRange]);
  const templateBaseBuckets = useMemo(
    () => filterBucketsByTemplate(runtimeBuckets, machineTemplateId),
    [machineTemplateId],
  );
  const rangeBaseBuckets = useMemo(
    () => filterBucketsByDateRange(templateBaseBuckets, dateRange),
    [dateRange, templateBaseBuckets],
  );
  const projectedRangeBuckets = useMemo(
    () => applyScenarioImpact(rangeBaseBuckets, submittedScenario, machineTemplateId),
    [machineTemplateId, rangeBaseBuckets, submittedScenario],
  );
  const heatmapBuckets = useMemo(
    () => applyScenarioImpact(templateBaseBuckets, submittedScenario, machineTemplateId),
    [machineTemplateId, submittedScenario, templateBaseBuckets],
  );
  const recommendations = useMemo(() => {
    const base = buildRecommendations(visibleRisks, machineTemplates);
    if (!submittedScenario) return base;

    const scenarioRec: Recommendation = {
      id: 'what-if-impact',
      type: 'move-schedule',
      owner: 'Release Manager',
      title: `${submittedScenario.solutionName} changes ${formatDate(submittedScenario.preferredDate)} ${submittedScenario.preferredHour}:00 demand`,
      impact: `Adds ${submittedScenario.runtimeDemand} runtime(s) for about ${submittedScenario.durationMinutes} minutes. Review the highlighted heatmap tiles before choosing this slot.`,
      confidence: 'Medium',
      basis: 'Fixture-backed what-if overlay using current machine template filter and submitted scenario',
    };
    return [scenarioRec, ...base];
  }, [submittedScenario, visibleRisks]);
  const configuredRuntimes = totalConfiguredRuntimes(machineTemplates);
  const effectiveRuntimes = totalEffectiveRuntimes(machineTemplates);
  const projectedPeakDemand = peakDemand(projectedRangeBuckets);
  const riskWindows = projectedRangeBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;
  const folderRiskRows = groupRiskByFolder(visibleRisks);
  const selectedBucket = selectedTile ? bucketFor(selectedTile.date, selectedTile.hour, heatmapBuckets) : null;
  const dataSignals: DataSignal[] = signedIn
    ? [
        {
          id: 'demo-mode',
          tone: 'warning',
          title: 'Mock data active',
          detail: 'Live Orchestrator data is not connected yet. KPIs, heatmap, inventory, and risks are fixture-backed.',
          timestamp: demoLastSuccessfulPull,
        },
        {
          id: 'api-not-wired',
          tone: 'error',
          title: 'Live API connector not configured',
          detail: 'Future API failures such as 401, 403, 429, timeout, or partial folder access should surface here before users trust the numbers.',
          timestamp: demoLastAttemptedPull,
        },
        {
          id: 'demo-loaded',
          tone: 'ok',
          title: 'Demo dataset loaded',
          detail: `${runtimeBuckets.length} hourly runtime buckets and ${scheduleRisks.length} schedule risk records are available for the mock experience.`,
        },
      ]
    : [
        {
          id: 'auth-required',
          tone: 'error',
          title: 'Sign-in required',
          detail: 'Connect to the target tenant before loading permitted folders, schedules, jobs, machine templates, and license utilization.',
        },
      ];

  function selectTile(tile: SelectedTile, nextGrain?: TimeGrain) {
    setSelectedTile(tile);
    setSelectedDate(tile.date);
    if (nextGrain) setGrain(nextGrain);
  }

  function submitScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedScenario(scenarioForm);
    selectTile({ date: scenarioForm.preferredDate, hour: scenarioForm.preferredHour }, 'day');
  }

  function resetScenario() {
    setScenarioForm(defaultScenario);
    setSubmittedScenario(null);
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
            <select
              value={dateRange}
              onChange={(event) => {
                const nextRange = event.target.value as DateRange;
                const nextDates = dateOptionsForRange(nextRange);
                setDateRange(nextRange);
                setSelectedDate(nextDates.includes(selectedDate) ? selectedDate : nextDates[0]);
              }}
            >
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

        <DataStatusBand signals={dataSignals} />

        <section className="kpi-grid" aria-label="Capacity summary">
          <MetricCard label="Configured Runtimes" value={configuredRuntimes} detail="Across machine templates" icon={<Cpu />} />
          <MetricCard label="Effective Capacity" value={effectiveRuntimes} detail="After disconnected hosts" icon={<Server />} />
          <MetricCard label="Projected Peak Demand" value={projectedPeakDemand} detail="Includes what-if overlay" icon={<Clock3 />} />
          <MetricCard label="Risk Windows" value={riskWindows} detail="Hourly buckets at or above 85%" icon={<AlertTriangle />} tone="warn" />
        </section>

        <section className="workspace-grid single-column">
          <div className="main-column">
            <section className="panel">
              <PanelHeader
                icon={<CalendarClock size={18} />}
                title="Runtime Heatmap"
                subtitle={`Date-based observed utilization. Tenant timezone: ${tenantTimezoneLabel}.`}
              />
              <div className="heatmap-planner-grid">
                <div>
                  <div className="heatmap-toolbar">
                    <SegmentedControl
                      items={grains}
                      value={grain}
                      onChange={setGrain}
                      labelFormatter={(item) => item.charAt(0).toUpperCase() + item.slice(1)}
                    />
                    {grain === 'day' ? (
                      <label className="inline-filter">
                        <span>Focus date</span>
                        <select
                          value={selectedDate}
                          onChange={(event) => {
                            setSelectedDate(event.target.value);
                            setSelectedTile({ date: event.target.value, hour: selectedTile.hour });
                          }}
                        >
                          {dateOptions.map((date) => (
                            <option key={date} value={date}>{formatDate(date)}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  {grain === 'month' ? (
                    <MonthCalendar
                      buckets={heatmapBuckets}
                      selectedDate={selectedDate}
                      onDateClick={(date, hour) => selectTile({ date, hour }, 'day')}
                    />
                  ) : grain === 'week' ? (
                    <WeekCapacityView
                      buckets={heatmapBuckets}
                      dates={weekDates}
                      selectedDate={selectedDate}
                      onDateClick={(date, hour) => selectTile({ date, hour }, 'day')}
                    />
                  ) : (
                    <DayTimeline
                      buckets={heatmapBuckets}
                      date={selectedDate}
                      selectedTile={selectedTile}
                      onTileClick={(tile) => selectTile(tile)}
                    />
                  )}
                  {selectedBucket ? (
                    <div className="tile-detail">
                      <strong>{formatDate(selectedTile.date, 'long')} {selectedTile.hour}:00 detail</strong>
                      <span>{utilizationPercent(selectedBucket)}% utilization</span>
                      <span>Observed {selectedBucket.observedDemand} / projected {selectedBucket.projectedDemand} / capacity {selectedBucket.capacity}</span>
                      <span>Drivers: {selectedBucket.topDrivers.join(', ')}</span>
                    </div>
                  ) : (
                    <div className="tile-detail">
                      <strong>{formatDate(selectedDate, 'long')}</strong>
                      <span>No runtime signal for the selected filter.</span>
                    </div>
                  )}
                </div>
                <WhatIfPlanner
                  scenario={scenarioForm}
                  onChange={setScenarioForm}
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

function DataStatusBand({ signals }: { signals: DataSignal[] }) {
  const errorCount = signals.filter((signal) => signal.tone === 'error').length;
  const warningCount = signals.filter((signal) => signal.tone === 'warning').length;

  return (
    <section className="data-status-band" aria-label="Data connection and API status">
      <div className="data-status-summary">
        <div>
          <span>Data Health</span>
          <strong>{errorCount ? `${errorCount} issue${errorCount > 1 ? 's' : ''} visible` : 'No blocking errors'}</strong>
          <small>{warningCount ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : 'No warnings'} - read-only monitoring</small>
        </div>
        <div className="refresh-status">
          <RefreshCw size={16} />
          Last checked {demoLastAttemptedPull}
        </div>
      </div>
      <div className="data-signal-grid">
        {signals.map((signal) => (
          <article className={`data-signal signal-${signal.tone}`} key={signal.id}>
            <div className="signal-icon">{dataSignalIcon(signal.tone)}</div>
            <div>
              <div className="signal-title">
                <strong>{signal.title}</strong>
                {signal.timestamp ? <span>{signal.timestamp}</span> : null}
              </div>
              <p>{signal.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
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
  selectedTile,
  onTileClick,
}: {
  buckets: RuntimeBucket[];
  date: string;
  selectedTile: SelectedTile;
  onTileClick: (tile: SelectedTile) => void;
}) {
  return (
    <div className="day-timeline" aria-label="Day runtime utilization timeline">
      <div className="day-title">
        <strong>{formatDate(date, 'long')}</strong>
        <span>24 hourly buckets, shown in tenant timezone</span>
      </div>
      <div className="day-period-grid">
        {dayPeriods.map((period) => (
          <section className="day-period" key={period.label}>
            <div className="period-label">{period.label}</div>
            <div className="period-hours">
              {period.hours.map((hour) => {
              const bucket = bucketFor(date, hour, buckets);
              if (!bucket) return <div className="heatmap-empty" key={`${date}-${hour}`} />;

              const percent = utilizationPercent(bucket);
              const risk = riskFromPercent(percent);
              const isSelected = selectedTile.date === bucket.date && selectedTile.hour === bucket.hour;
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
                  <small>{bucket.projectedDemand}/{bucket.capacity}</small>
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
  selectedDate,
  onDateClick,
}: {
  buckets: RuntimeBucket[];
  dates: string[];
  selectedDate: string;
  onDateClick: (date: string, hour: string) => void;
}) {
  return (
    <div className="week-capacity" aria-label="Weekly runtime capacity summary">
      {dates.map((date) => {
        const summary = utilizationSummaryForDate(date, buckets);
        const peak = summary?.peak;
        const percent = summary?.peakPercent ?? 0;
        const risk = peak ? riskFromPercent(percent) : 'low';
        const capacitySignal = summary
          ? summary.riskHours > 0
            ? `${summary.riskHours} constrained hour(s)`
            : `${summary.lowCapacityHours} lower-demand hour(s)`
          : 'No signal';

        return (
          <button
            className={`week-day-card ${peak ? riskTone(risk) : 'no-signal'} ${selectedDate === date ? 'selected' : ''}`}
            key={date}
            onClick={() => onDateClick(date, peak?.hour ?? '00')}
            type="button"
          >
            <span>{formatDate(date).split(',')[0]}</span>
            <strong>{formatDate(date).replace(',', '')}</strong>
            <div className="week-meter" aria-hidden="true">
              <i style={{ width: `${Math.min(percent, 130)}%` }} />
            </div>
            <small>Peak {percent}% at {peak?.hour ?? '00'}:00</small>
            <small>Avg {summary?.average ?? 0}% - {capacitySignal}</small>
          </button>
        );
      })}
    </div>
  );
}

function MonthCalendar({
  buckets,
  selectedDate,
  onDateClick,
}: {
  buckets: RuntimeBucket[];
  selectedDate: string;
  onDateClick: (date: string, hour: string) => void;
}) {
  const firstOffset = (new Date(`${monthDates[0]}T00:00:00`).getDay() + 6) % 7;
  const cells = [...Array.from({ length: firstOffset }, () => null), ...monthDates];

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

        return (
          <button
            className={`month-day ${peak ? riskTone(risk) : 'no-signal'} ${isSelected ? 'selected' : ''}`}
            key={date}
            onClick={() => onDateClick(date, peak?.hour ?? '00')}
            type="button"
          >
            <span>{formatDate(date).split(',')[0]}</span>
            <strong>{dayNumber(date)}</strong>
            {peak ? (
              <>
                <small>{percent}% peak</small>
                <em>{peak.hour}:00</em>
              </>
            ) : (
              <small>No signal</small>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WhatIfPlanner({
  scenario,
  onChange,
  onReset,
  onSubmit,
}: {
  scenario: WhatIfScenario;
  onChange: (scenario: WhatIfScenario) => void;
  onReset: () => void;
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
      <div className="form-actions">
        <button className="button primary" type="submit">Submit scenario</button>
        <button className="button secondary" type="button" onClick={onReset}>Reset</button>
      </div>
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
