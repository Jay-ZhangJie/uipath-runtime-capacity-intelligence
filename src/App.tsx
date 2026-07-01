import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cpu,
  LogIn,
  LogOut,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { folders, machineTemplates, runtimeBuckets, scheduleRisks, tenants } from './data/demoData';
import {
  filterRisks,
  groupRiskByFolder,
  peakDemand,
  riskFromPercent,
  totalConfiguredRuntimes,
  totalEffectiveRuntimes,
  utilizationPercent,
} from './lib/analytics';
import { buildRecommendations } from './lib/recommendations';
import type { RiskLevel, RiskView, TimeGrain } from './types';

const grains: TimeGrain[] = ['day', 'week', 'month', 'year'];
const riskViews: RiskView[] = ['folder', 'process', 'job', 'sla'];

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

export function App() {
  const [signedIn, setSignedIn] = useState(true);
  const [tenant, setTenant] = useState(tenants[0]);
  const [folder, setFolder] = useState(folders[0]);
  const [grain, setGrain] = useState<TimeGrain>('week');
  const [riskView, setRiskView] = useState<RiskView>('folder');

  const visibleRisks = useMemo(() => filterRisks(scheduleRisks, folder), [folder]);
  const recommendations = useMemo(
    () => buildRecommendations(visibleRisks, machineTemplates),
    [visibleRisks],
  );
  const configuredRuntimes = totalConfiguredRuntimes(machineTemplates);
  const effectiveRuntimes = totalEffectiveRuntimes(machineTemplates);
  const projectedPeakDemand = peakDemand(runtimeBuckets);
  const riskWindows = runtimeBuckets.filter((bucket) => utilizationPercent(bucket) >= 85).length;
  const folderRiskRows = groupRiskByFolder(visibleRisks);

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
            {signedIn ? `Signed in · ${tenant}` : 'Demo mode'}
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
            <span>Runtime Type</span>
            <select defaultValue="Unattended">
              <option>Unattended</option>
              <option>NonProduction</option>
              <option>Serverless</option>
            </select>
          </label>
          <label>
            <span>Date Range</span>
            <select defaultValue="30+14">
              <option value="30+14">Last 30 days + next 14 days</option>
              <option value="90+30">Last 90 days + next 30 days</option>
              <option value="year">Year trend</option>
            </select>
          </label>
          <div className="access-note">
            <CheckCircle2 size={16} />
            Values are retrieved from the signed-in user's permitted tenants and folders.
          </div>
        </section>

        <section className="kpi-grid" aria-label="Capacity summary">
          <MetricCard label="Configured Runtimes" value={configuredRuntimes} detail="Across 3 machine templates" icon={<Cpu />} />
          <MetricCard label="Effective Capacity" value={effectiveRuntimes} detail="After disconnected hosts" icon={<Server />} />
          <MetricCard label="Projected Peak Demand" value={projectedPeakDemand} detail="Friday 18:00-19:00" icon={<Clock3 />} />
          <MetricCard label="Risk Windows" value={riskWindows} detail="Buckets at or above 85%" icon={<AlertTriangle />} tone="warn" />
        </section>

        <section className="workspace-grid">
          <div className="main-column">
            <section className="panel">
              <PanelHeader
                icon={<CalendarClock size={18} />}
                title="Runtime Heatmap"
                subtitle="Observed and projected utilization by selected time grain"
              />
              <SegmentedControl
                items={grains}
                value={grain}
                onChange={setGrain}
                labelFormatter={(item) => item.charAt(0).toUpperCase() + item.slice(1)}
              />
              <Heatmap />
              <p className="panel-note">
                Year view should use aggregated daily or weekly buckets. Pulling raw job detail for a full year can be
                heavy for large tenants, so cache or persistence is recommended after the MVP.
              </p>
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

          <aside className="side-column">
            <section className="panel">
              <PanelHeader
                icon={<Sparkles size={18} />}
                title="Dynamic Recommendations"
                subtitle="Generated from current filters and fixture data"
              />
              <div className="recommendation-list">
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
                icon={<ChevronDown size={18} />}
                title="What-If Scenario"
                subtitle="Proposed automation placement"
              />
              <div className="scenario-card">
                <div>
                  <span>Folder</span>
                  <strong>Finance</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>75 min p90</strong>
                </div>
                <div>
                  <span>Priority</span>
                  <strong>High</strong>
                </div>
                <div>
                  <span>Blackout</span>
                  <strong>Month-end 18:00-22:00</strong>
                </div>
                <div>
                  <span>Safe Slots</span>
                  <strong>02:30 · 13:15 · Sat 06:00</strong>
                </div>
              </div>
            </section>
          </aside>
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

function Heatmap() {
  const hours = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return (
    <div className="heatmap" aria-label="Runtime utilization heatmap">
      <div className="heatmap-label">Day</div>
      {hours.map((hour) => (
        <div className="heatmap-label" key={hour}>{hour}</div>
      ))}
      {days.map((day) => (
        <div className="heatmap-row" key={day}>
          <div className="heatmap-label">{day}</div>
          {runtimeBuckets
            .filter((bucket) => bucket.day === day)
            .map((bucket) => {
              const percent = utilizationPercent(bucket);
              const risk = riskFromPercent(percent);
              return (
                <div className={`heatmap-cell ${riskTone(risk)}`} key={`${bucket.day}-${bucket.hour}`} title={`${bucket.topDrivers.join(', ')} · ${percent}%`}>
                  {percent}%
                </div>
              );
            })}
        </div>
      ))}
    </div>
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
