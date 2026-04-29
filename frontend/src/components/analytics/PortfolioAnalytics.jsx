/**
 * PortfolioAnalytics — destination workbench for portfolio-wide analysis.
 *
 * Starting point: snapshot views built from the data we already have on
 * /positions/actual. Time-series (P&L over time, premium income trend)
 * will plug into this page once the backend daily-snapshot endpoint
 * lands; for now those panels render a placeholder so the layout is
 * stable.
 *
 * Lookback default is 365d per the project standing rule.
 *
 * Route: /analysis/portfolio
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import {
  PieChart as PieIcon, BarChart3, ListOrdered, Activity, Info,
} from 'lucide-react';
import { fetchActualPositions } from '../../services/schwab';
import { STRATEGY_BY_KEY, strategyTypeToClass } from '../../strategies/registry';

const DAY_MS = 24 * 60 * 60 * 1000;

const LOOKBACK_OPTIONS = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '180d', label: '180 days', days: 180 },
  { key: '365d', label: '365 days', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

const STRATEGY_COLORS = {
  long_stock: '#0ea5e9',
  covered_calls: '#10b981',
  dividends: '#14b8a6',
  verticals: '#6366f1',
  single_leg: '#a855f7',
  big_options: '#d946ef',
  box_spreads: '#f59e0b',
  cash_mgmt: '#eab308',
  earnings: '#f97316',
  hedge: '#f43f5e',
  futures: '#ef4444',
  unclassified: '#9ca3af',
};

const fmtMoney = (n, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(n) || 0);

const fmtPct = (n) =>
  `${(Number(n) || 0) >= 0 ? '+' : ''}${(Number(n) || 0).toFixed(2)}%`;

const pnlColor = (n) => {
  const v = Number(n) || 0;
  if (v > 0) return 'text-emerald-700';
  if (v < 0) return 'text-red-700';
  return 'text-gray-700';
};

const strategyLabel = (key) => {
  if (!key) return 'Unclassified';
  return STRATEGY_BY_KEY[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Map position.strategy_type (singular, auto-detected) to a registry
// strategy_class key (plural). Unknown types fall through to 'unclassified'.
const classKey = (p) => strategyTypeToClass(p.strategy_type) || 'unclassified';

const SectionCard = ({ title, icon: Icon, children, footer }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon className="h-4 w-4 text-gray-500" />}
      <div className="text-sm font-semibold text-gray-900">{title}</div>
    </div>
    {children}
    {footer && <div className="text-[11px] text-gray-400 mt-2">{footer}</div>}
  </div>
);

const Kpi = ({ label, value, sub, valueClass }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    <div className={`text-2xl font-semibold mt-1 ${valueClass || 'text-gray-900'}`}>{value}</div>
    {sub && <div className={`text-xs mt-1 ${valueClass || 'text-gray-500'}`}>{sub}</div>}
  </div>
);

const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / DAY_MS);
};

export default function PortfolioAnalytics() {
  const [lookbackKey, setLookbackKey] = useState('365d');
  const lookback = LOOKBACK_OPTIONS.find((o) => o.key === lookbackKey) || LOOKBACK_OPTIONS[3];

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schwab-actual-positions'],
    queryFn: () => fetchActualPositions(),
  });

  const accounts = useMemo(() => data?.accounts || [], [data]);
  const positions = useMemo(() => data?.positions || [], [data]);

  // Lookback filter: positions opened within `lookback.days` (or all).
  const filteredPositions = useMemo(() => {
    if (lookback.days === null) return positions;
    return positions.filter((p) => {
      const held = daysSince(p.entry_date);
      return held === null || held <= lookback.days;
    });
  }, [positions, lookback.days]);

  const totals = useMemo(() => {
    const cost = filteredPositions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0);
    const value = filteredPositions.reduce((s, p) => s + (Number(p.current_value) || 0), 0);
    const unrealized = filteredPositions.reduce((s, p) => s + (Number(p.unrealized_pnl) || 0), 0);
    const winners = filteredPositions.filter((p) => (Number(p.unrealized_pnl) || 0) > 0).length;
    const losers = filteredPositions.filter((p) => (Number(p.unrealized_pnl) || 0) < 0).length;
    const flat = filteredPositions.length - winners - losers;
    const winRate = filteredPositions.length > 0 ? (winners / filteredPositions.length) * 100 : 0;
    const costAbs = Math.abs(cost);
    const unrealizedPct = costAbs > 0 ? (unrealized / costAbs) * 100 : 0;
    return { cost, value, unrealized, unrealizedPct, winners, losers, flat, winRate };
  }, [filteredPositions]);

  // Strategy allocation by current value. Box spreads are excluded —
  // synthetic financing, 4 legs net to ~$0 in current_value, doesn't
  // represent capital deployment. Their carry shows up in P&L below.
  const strategyAllocation = useMemo(() => {
    const buckets = new Map();
    for (const p of filteredPositions) {
      if (p.strategy_type === 'box_spread') continue;
      const key = classKey(p);
      const v = Math.abs(Number(p.current_value) || 0);
      buckets.set(key, (buckets.get(key) || 0) + v);
    }
    return Array.from(buckets.entries())
      .map(([key, value]) => ({ key, name: strategyLabel(key), value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [filteredPositions]);

  const boxSpreadCount = useMemo(
    () => filteredPositions.filter((p) => p.strategy_type === 'box_spread').length,
    [filteredPositions]
  );

  // Unrealized P&L by strategy. Box spreads are KEPT here — the carry
  // (financing cost or yield) is real P&L and worth showing.
  const pnlByStrategy = useMemo(() => {
    const buckets = new Map();
    for (const p of filteredPositions) {
      const key = classKey(p);
      const v = Number(p.unrealized_pnl) || 0;
      buckets.set(key, (buckets.get(key) || 0) + v);
    }
    return Array.from(buckets.entries())
      .map(([key, value]) => ({ key, name: strategyLabel(key), value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredPositions]);

  // Unrealized P&L by account.
  const pnlByAccount = useMemo(() => {
    const byHash = new Map(accounts.map((a) => [a.account_hash, a]));
    const buckets = new Map();
    for (const p of filteredPositions) {
      const key = p.account_id;
      const v = Number(p.unrealized_pnl) || 0;
      buckets.set(key, (buckets.get(key) || 0) + v);
    }
    return Array.from(buckets.entries())
      .map(([hash, value]) => ({
        hash,
        name: byHash.get(hash)?.account_number || (hash || '').slice(0, 6),
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [accounts, filteredPositions]);

  // Top concentration: largest positions by absolute current_value.
  const topConcentration = useMemo(() => {
    const portfolioValue = filteredPositions.reduce(
      (s, p) => s + Math.abs(Number(p.current_value) || 0),
      0
    );
    return [...filteredPositions]
      .map((p) => ({
        symbol: p.symbol,
        strategy: classKey(p),
        value: Math.abs(Number(p.current_value) || 0),
        pnl: Number(p.unrealized_pnl) || 0,
        pct: portfolioValue > 0 ? (Math.abs(Number(p.current_value) || 0) / portfolioValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredPositions]);

  if (isLoading) return <div className="p-6 text-gray-500">Loading analytics…</div>;
  if (isError) {
    return (
      <div className="p-6 text-red-600">
        Failed to load analytics: {error?.message || 'unknown error'}
      </div>
    );
  }

  return (
    <div className="p-2 space-y-6">
      {/* Header + lookback selector */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Portfolio Analytics</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {filteredPositions.length} of {positions.length} position
            {positions.length === 1 ? '' : 's'} in window · {accounts.length} account
            {accounts.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Lookback</span>
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden bg-white">
            {LOOKBACK_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setLookbackKey(o.key)}
                className={`px-2.5 py-1 text-xs ${
                  lookbackKey === o.key
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Market value" value={fmtMoney(totals.value)} sub={`Cost ${fmtMoney(Math.abs(totals.cost))}`} />
        <Kpi
          label="Unrealized P&L"
          value={fmtMoney(totals.unrealized)}
          sub={fmtPct(totals.unrealizedPct)}
          valueClass={pnlColor(totals.unrealized)}
        />
        <Kpi
          label="Win rate"
          value={`${totals.winRate.toFixed(0)}%`}
          sub={`${totals.winners} winners · ${totals.losers} losers${totals.flat ? ` · ${totals.flat} flat` : ''}`}
        />
        <Kpi label="Positions in window" value={filteredPositions.length} />
      </div>

      {/* Allocation + P&L by strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Allocation by strategy"
          icon={PieIcon}
          footer={
            boxSpreadCount > 0
              ? `Excludes ${boxSpreadCount} box spread${boxSpreadCount === 1 ? '' : 's'} — synthetic financing, sized by face value on the Box Spreads panel.`
              : null
          }
        >
          {strategyAllocation.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No positions in window.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={strategyAllocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={1}
                    >
                      {strategyAllocation.map((s) => (
                        <Cell key={s.key} fill={STRATEGY_COLORS[s.key] || STRATEGY_COLORS.unclassified} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1 text-sm">
                {strategyAllocation.map((s) => {
                  const totalValue = strategyAllocation.reduce((acc, x) => acc + x.value, 0);
                  const pct = totalValue > 0 ? (s.value / totalValue) * 100 : 0;
                  return (
                    <li key={s.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ background: STRATEGY_COLORS[s.key] || STRATEGY_COLORS.unclassified }}
                        />
                        <Link
                          to={`/strategies/${s.key}`}
                          className="truncate text-gray-700 hover:text-indigo-600 hover:underline"
                        >
                          {s.name}
                        </Link>
                      </div>
                      <span className="tabular-nums text-gray-500 ml-2">
                        {fmtMoney(s.value)} · {pct.toFixed(0)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Unrealized P&L by strategy" icon={BarChart3}>
          {pnlByStrategy.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No positions in window.</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlByStrategy} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    angle={-25}
                    textAnchor="end"
                    height={50}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmtMoney(v)} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {pnlByStrategy.map((d) => (
                      <Cell
                        key={d.key}
                        fill={d.value >= 0 ? '#10b981' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* P&L by account + Top concentration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Unrealized P&L by account" icon={BarChart3}>
          {pnlByAccount.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No positions in window.</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlByAccount} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmtMoney(v)} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {pnlByAccount.map((d) => (
                      <Cell key={d.hash} fill={d.value >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Top 10 concentration" icon={ListOrdered}>
          {topConcentration.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No positions in window.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left py-1.5 font-normal">Symbol</th>
                    <th className="text-left py-1.5 font-normal">Strategy</th>
                    <th className="text-right py-1.5 font-normal">Value</th>
                    <th className="text-right py-1.5 font-normal">% Port</th>
                    <th className="text-right py-1.5 font-normal">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {topConcentration.map((row, i) => (
                    <tr key={`${row.symbol}-${i}`} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 font-medium text-gray-900 tabular-nums">{row.symbol}</td>
                      <td className="py-1.5 text-gray-600">{strategyLabel(row.strategy)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtMoney(row.value)}</td>
                      <td
                        className={`py-1.5 text-right tabular-nums ${
                          row.pct >= 20
                            ? 'text-red-700 font-semibold'
                            : row.pct >= 10
                            ? 'text-amber-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {row.pct.toFixed(1)}%
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${pnlColor(row.pnl)}`}>
                        {fmtMoney(row.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Time-series placeholder */}
      <SectionCard
        title="P&L over time"
        icon={Activity}
        footer="Time-series visualizations will populate once the daily-snapshot endpoint lands."
      >
        <div className="h-40 flex flex-col items-center justify-center text-sm text-gray-500 gap-2">
          <Info className="h-5 w-5 text-gray-400" />
          <div>Daily P&L history isn't captured yet.</div>
          <div className="text-xs text-gray-400">
            Snapshots above use live position data only.
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
