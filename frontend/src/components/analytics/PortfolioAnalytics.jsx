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
import React, { useMemo } from 'react';
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
import { useSelectedAccountHash } from '../../hooks/useSelectedAccount';

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

export default function PortfolioAnalytics() {
  const accountHash = useSelectedAccountHash();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schwab-actual-positions'],
    queryFn: () => fetchActualPositions(),
  });

  // Account scope mirrors the header badge. When set, every aggregate
  // and chart on this page collapses to the selected account.
  const allAccounts = useMemo(() => data?.accounts || [], [data]);
  const allPositions = useMemo(() => data?.positions || [], [data]);
  const accounts = useMemo(
    () => (accountHash ? allAccounts.filter((a) => a.account_hash === accountHash) : allAccounts),
    [allAccounts, accountHash],
  );
  const positions = useMemo(
    () => (accountHash ? allPositions.filter((p) => p.account_id === accountHash) : allPositions),
    [allPositions, accountHash],
  );
  // Naming preserved (filteredPositions) so downstream memos don't have
  // to change. Page used to filter by an entry-date lookback selector,
  // but the control was confusing without a daily-snapshot timeline to
  // hang it on. Removed; analytics now reflect all current positions.
  const filteredPositions = positions;

  const totals = useMemo(() => {
    // Account-level numbers — these are independent of the lookback
    // window because they describe the *account*, not the in-window
    // position cohort.
    //   • liquidation = total net worth (Schwab's "Liquidation value").
    //   • today       = Schwab's account-level day P&L (current minus
    //                   start-of-day liquidation), with a fallback to the
    //                   per-position currentDayProfitLoss sum until each
    //                   account is re-synced under the new code.
    const liquidation = accounts.reduce(
      (s, a) => s + (Number(a.liquidation_value) || 0), 0,
    );
    const today = accounts.reduce(
      (s, a) => s + (Number(a.current_day_pnl) || 0), 0,
    );
    const cash = accounts.reduce(
      (s, a) => s + (Number(a.cash_balance) || 0), 0,
    );

    // Position-cohort numbers — filtered by the lookback window.
    //   • costGross   = Σ|cost_basis|. Gross capital deployed; the right
    //                   denominator for "% return" when the portfolio mixes
    //                   longs and shorts (Σ cost_basis cancels signs).
    //   • unrealized  = Σ unrealized_pnl. Already signed correctly per
    //                   Schwab; positive = winning regardless of long/short.
    const costGross = filteredPositions.reduce(
      (s, p) => s + Math.abs(Number(p.cost_basis) || 0), 0,
    );
    const cost = filteredPositions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0);
    const unrealized = filteredPositions.reduce(
      (s, p) => s + (Number(p.unrealized_pnl) || 0), 0,
    );
    // Win rate excludes box spreads — they're synthetic financing whose
    // mark-to-market noise isn't a directional bet, so labeling them
    // "winners" or "losers" muddies the metric.
    const directional = filteredPositions.filter((p) => p.strategy_type !== 'box_spread');
    const winners = directional.filter((p) => (Number(p.unrealized_pnl) || 0) > 0).length;
    const losers = directional.filter((p) => (Number(p.unrealized_pnl) || 0) < 0).length;
    const flat = directional.length - winners - losers;
    const winRate = directional.length > 0 ? (winners / directional.length) * 100 : 0;
    const unrealizedPct = costGross > 0 ? (unrealized / costGross) * 100 : 0;
    const todayPct = liquidation !== 0 ? (today / Math.abs(liquidation)) * 100 : 0;
    return {
      liquidation, cash, today, todayPct,
      cost, costGross, unrealized, unrealizedPct,
      winners, losers, flat, winRate,
    };
  }, [filteredPositions, accounts]);

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

  // Top concentration: largest positions by absolute current_value, with
  // % expressed against liquidation value (net worth) — not against the
  // sum of |current_value|. The latter inflates the denominator with
  // short-option market values that already net out in liquidation, so
  // every percentage looks artificially small for option-heavy accounts.
  const topConcentration = useMemo(() => {
    const denom = totals.liquidation > 0 ? totals.liquidation : null;
    // Box spreads are synthetic financing — their |current_value| is
    // ~$0 (long+short legs cancel) so they sort to the bottom anyway,
    // and conceptually they aren't "concentration" in the equity sense.
    return filteredPositions
      .filter((p) => p.strategy_type !== 'box_spread')
      .map((p) => ({
        symbol: p.symbol,
        strategy: classKey(p),
        value: Math.abs(Number(p.current_value) || 0),
        pnl: Number(p.unrealized_pnl) || 0,
        pct: denom ? (Math.abs(Number(p.current_value) || 0) / denom) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredPositions, totals.liquidation]);

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
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Portfolio Analytics</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {accountHash && accounts[0]
              ? `Account ${accounts[0].account_number}`
              : `${allAccounts.length} account${allAccounts.length === 1 ? '' : 's'}`}
            {' · '}{positions.length} position{positions.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Liquidation value"
          value={fmtMoney(totals.liquidation)}
          sub={`Cash ${fmtMoney(totals.cash)} · Cost ${fmtMoney(totals.costGross)}`}
        />
        <Kpi
          label="Unrealized P&L"
          value={fmtMoney(totals.unrealized)}
          sub={fmtPct(totals.unrealizedPct)}
          valueClass={pnlColor(totals.unrealized)}
        />
        <Kpi
          label="Today's P&L"
          value={fmtMoney(totals.today)}
          sub={fmtPct(totals.todayPct)}
          valueClass={pnlColor(totals.today)}
        />
        <Kpi
          label="Win rate"
          value={`${totals.winRate.toFixed(0)}%`}
          sub={`${totals.winners} winners · ${totals.losers} losers${totals.flat ? ` · ${totals.flat} flat` : ''}`}
        />
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
