import { useState, useEffect, useCallback } from 'react';
import { fetchAdminStats } from './piClient';

const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', auto_approved: 'Auto-approved',
  rejected: 'Rejected', disputed: 'Disputed',
  live: 'Live', awaiting_funding: 'Awaiting funding', exhausted: 'Exhausted',
  cancelled: 'Cancelled', paused: 'Paused',
  created: 'Created', completed: 'Completed', failed: 'Failed',
};

function StatCard({ label, value, sub }) {
  return (
    <div style={{ backgroundColor: 'var(--surface-alt)', borderRadius: '10px', padding: '11px 12px', flex: '1 1 120px', minWidth: '110px' }}>
      <div style={{ fontSize: '1.3rem', fontWeight: '800', color: 'var(--text)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', fontWeight: '700', marginTop: '4px' }}>{label}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: 'var(--text-faintest)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// Small hand-rolled SVG bar chart — no charting library needed for 14 bars.
function BarChart({ data, valueKey, color, formatValue }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const w = 280, h = 70, barW = w / data.length - 3;
  return (
    <svg viewBox={`0 0 ${w} ${h + 16}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {data.map((d, i) => {
        const barH = Math.max(1, (d[valueKey] / max) * h);
        const x = i * (w / data.length) + 1.5;
        return (
          <g key={d.date}>
            <rect x={x} y={h - barH} width={barW} height={barH} rx="2" fill={color} opacity={d[valueKey] > 0 ? 1 : 0.15} />
            <title>{d.date}: {formatValue ? formatValue(d[valueKey]) : d[valueKey]}</title>
          </g>
        );
      })}
      <text x="0" y={h + 13} fontSize="8" fill="var(--text-faintest)">{data[0]?.date?.slice(5)}</text>
      <text x={w} y={h + 13} fontSize="8" fill="var(--text-faintest)" textAnchor="end">{data[data.length - 1]?.date?.slice(5)}</text>
    </svg>
  );
}

function StatusBreakdown({ title, byStatus }) {
  const entries = Object.entries(byStatus || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '7px' }}>{title}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No data yet.</div>
      ) : entries.map(([status, count]) => (
        <div key={status} style={{ marginBottom: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>
            <span>{STATUS_LABEL[status] || status}</span>
            <span style={{ fontWeight: '700' }}>{count}</span>
          </div>
          <div style={{ height: '5px', backgroundColor: 'var(--surface-alt)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(count / total) * 100}%`, backgroundColor: '#059669', borderRadius: '3px' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminOverview({ notify }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStats(await fetchAdminStats()); }
    catch (e) { notify?.('⚠️ ' + (e.message || 'Could not load stats')); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  if (loading || !stats) {
    return <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)', padding: '14px' }}>Loading…</div>;
  }

  const approvalPct = stats.submissions.approvalRate !== null ? Math.round(stats.submissions.approvalRate * 100) : null;

  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontWeight: '800', color: '#065F46', fontSize: '0.9rem', marginBottom: '3px' }}>
        📊 Overview
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '0 0 12px' }}>
        Platform activity at a glance.
      </p>

      {/* Top stat cards */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <StatCard label="Total users" value={stats.users.total} sub={`+${stats.users.last7Days} this week`} />
        <StatCard label="Submissions" value={stats.submissions.total} sub={approvalPct !== null ? `${approvalPct}% approved` : 'no decisions yet'} />
        <StatCard label="A2U payouts" value={stats.payments.a2uTotal} />
        <StatCard label="Approved workers" value={stats.approvedWorkers.distinctPiUids} />
      </div>

      {/* Trends */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '6px' }}>
          SIGNUPS — LAST 14 DAYS ({stats.users.last30Days} in last 30)
        </div>
        <BarChart data={stats.trends.dailySignups} valueKey="count" color="#0369a1" />
      </div>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '6px' }}>
          PLATFORM FEE REVENUE — LAST 14 DAYS
        </div>
        <BarChart data={stats.trends.dailyRevenue} valueKey="feesPi" color="#059669" formatValue={(v) => `${v.toFixed(4)}π`} />
      </div>

      {/* Status breakdowns */}
      <StatusBreakdown title="SUBMISSIONS BY STATUS" byStatus={stats.submissions.byStatus} />
      <StatusBreakdown title="TASKS BY STATUS" byStatus={stats.tasks.byStatus} />

      {/* Top earners */}
      <div>
        <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-faint)', marginBottom: '7px' }}>TOP EARNERS</div>
        {stats.approvedWorkers.workers.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-faintest)' }}>No approved submissions yet.</div>
        ) : stats.approvedWorkers.workers.slice(0, 10).map((w, i) => (
          <div key={w.piUid} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 9 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {i + 1}. @{w.username} <span style={{ color: 'var(--text-faintest)' }}>({w.tasksDone} tasks)</span>
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: '700', color: '#059669' }}>{w.earnedPi.toFixed(2)}π</span>
          </div>
        ))}
      </div>
    </div>
  );
}
