/**
 * Dashboard — top-level "where am I" landing screen.
 *
 * Snapshot-only, fast to render. Aggregates across all synced Schwab
 * accounts using the data already cached in /positions/actual + position
 * flags. No new backend endpoints; deeper drilldowns live on /strategies,
 * /schwab/attention, /analysis/portfolio.
 *
 * Route: /
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Wallet, TrendingUp, AlertCircle, CalendarClock, ArrowRight, PieChart as PieIcon,
} from 'lucide-react';
import { fetchActualPositions } from '../../services/schwab';
import { fetchPositionFlags } from '../../services/positionFlags';
import { STRATEGY_BY_KEY, strategyTypeToClass } from '../../strategies/registry';
import { useSelectedAccountHash } from '../../hooks/useSelectedAccount';

const DAY_MS = 24 * 60 * 60 * 1000;

// Recharts needs concrete colors; the registry holds Tailwind class fragments.
// This map mirrors the accent tones used on the strategies hub.
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

const Kpi = ({ label, value, sub, valueClass, icon: Icon, accent = 'indigo' }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-start justify-between">
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valueClass || 'text-gray-900'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${valueClass || 'text-gray-500'}`}>{sub}</div>}
    </div>
    {Icon && <Icon className={`h-5 w-5 text-${accent}-400`} />}
  </div>
);

const SectionCard = ({ title, action, children, icon: Icon, footer }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-gray-500" />}
        <div className="text-sm font-semibold text-gray-900">{title}</div>
      </div>
      {action}
    </div>
    {children}
    {footer && <div className="text-[11px] text-gray-400 mt-2">{footer}</div>}
  </div>
);

const earliestExpiration = (position) => {
  const legs = position?.legs || [];
  let earliest = null;
  for (const l of legs) {
    if ((l.asset_type || '').toLowerCase() !== 'option' || !l.expiration) continue;
    if (!earliest || l.expiration < earliest) earliest = l.expiration;
  }
  return earliest;
};

const daysUntil = (iso) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / DAY_MS);
};

const strategyLabel = (key) => {
  if (!key) return 'Unclassified';
  return STRATEGY_BY_KEY[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Map position.strategy_type (singular, auto-detected) to a registry
// strategy_class key (plural). Unknown types fall through to 'unclassified'.
const classKey = (p) => strategyTypeToClass(p.strategy_type) || 'unclassified';

export default function Dashboard() {
  const accountHash = useSelectedAccountHash();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schwab-actual-positions'],
    queryFn: () => fetchActualPositions(),
  });

  const { data: flagsData } = useQuery({
    queryKey: ['position-flags'],
    queryFn: fetchPositionFlags,
  });

  // When the header badge selects a single account, every aggregate on
  // this page collapses to that account: positions, accounts, KPIs,
  // allocation charts, expirations, flag counts.
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
  const flags = useMemo(() => flagsData?.flags || flagsData || [], [flagsData]);
  // Flags are keyed by position_signature; positions expose
  // schwab_position_signature. Build the in-scope set so we can drop
  // flags for positions that belong to other accounts when filtered.
  const signaturesInScope = useMemo(
    () => new Set(positions.map((p) => p.schwab_position_signature).filter(Boolean)),
    [positions],
  );

  const totals = useMemo(() => {
    const liquidation = accounts.reduce((s, a) => s + (Number(a.liquidation_value) || 0), 0);
    const cash = accounts.reduce((s, a) => s + (Number(a.cash_balance) || 0), 0);
    const buyingPower = accounts.reduce((s, a) => s + (Number(a.buying_power) || 0), 0);
    // Gross capital deployed = sum of |cost_basis|. Naive sum cancels long
    // debits against short credits and box-spread legs, leaving a tiny
    // (sometimes near-zero) denominator that makes Unrealized % meaningless
    // for any portfolio with shorts.
    const costGross = positions.reduce((s, p) => s + Math.abs(Number(p.cost_basis) || 0), 0);
    const cost = positions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0);
    const value = positions.reduce((s, p) => s + (Number(p.current_value) || 0), 0);
    const unrealized = positions.reduce((s, p) => s + (Number(p.unrealized_pnl) || 0), 0);
    // Day P&L comes from the account-level liquidation delta Schwab
    // tracks (liquidation_value − initialBalances.liquidationValue at the
    // last sync). Summing per-position currentDayProfitLoss double-counts
    // intraday closes / new-position effects and didn't reconcile to
    // Schwab's own dashboard.
    const today = accounts.reduce((s, a) => s + (Number(a.current_day_pnl) || 0), 0);
    const unrealizedPct = costGross > 0 ? (unrealized / costGross) * 100 : 0;
    const todayPct = liquidation !== 0 ? (today / Math.abs(liquidation)) * 100 : 0;
    return {
      liquidation, cash, buyingPower, cost, costGross, value,
      unrealized, unrealizedPct, today, todayPct,
    };
  }, [accounts, positions]);

  const flaggedCount = useMemo(() => {
    if (!Array.isArray(flags)) return 0;
    return flags.filter((f) => {
      if (!f || !(f.is_flagged || f.flagged)) return false;
      if (!accountHash) return true;
      return f.position_signature
        ? signaturesInScope.has(f.position_signature)
        : false;
    }).length;
  }, [flags, accountHash, signaturesInScope]);

  // Allocation by strategy_class (mapped from auto-detected strategy_type).
  // Box spreads are excluded — they're synthetic financing whose 4 legs net
  // to ~$0 in current_value, so they don't represent capital deployment.
  // Their carry shows up in P&L views; size lives on the Box Spreads panel
  // as `face_value` (principal at risk).
  const strategyAllocation = useMemo(() => {
    const buckets = new Map();
    for (const p of positions) {
      if (p.strategy_type === 'box_spread') continue;
      const key = classKey(p);
      const v = Math.abs(Number(p.current_value) || 0);
      buckets.set(key, (buckets.get(key) || 0) + v);
    }
    return Array.from(buckets.entries())
      .map(([key, value]) => ({ key, name: strategyLabel(key), value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [positions]);

  const boxSpreadCount = useMemo(
    () => positions.filter((p) => p.strategy_type === 'box_spread').length,
    [positions]
  );

  // Allocation by account = each account's liquidation value (net worth).
  // We deliberately don't sum |current_value| of positions — that double-
  // counts box-spread legs and over-weights option-heavy accounts whose
  // long+short legs already net out in liquidation.
  const accountAllocation = useMemo(() => {
    return accounts
      .map((a) => ({
        hash: a.account_hash,
        name: a.account_number || (a.account_hash || '').slice(0, 6),
        value: Number(a.liquidation_value) || 0,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [accounts]);

  // Upcoming expirations within 30 days, bucketed by day.
  const upcomingExpirations = useMemo(() => {
    const buckets = new Map();
    for (const p of positions) {
      const exp = earliestExpiration(p);
      if (!exp) continue;
      const dte = daysUntil(exp);
      if (dte === null || dte < 0 || dte > 30) continue;
      if (!buckets.has(exp)) buckets.set(exp, { date: exp, dte, count: 0, value: 0 });
      const b = buckets.get(exp);
      b.count += 1;
      b.value += Math.abs(Number(p.current_value) || 0);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [positions]);

  if (isLoading) return <div className="p-6 text-gray-500">Loading dashboard…</div>;
  if (isError) {
    return (
      <div className="p-6 text-red-600">
        Failed to load dashboard: {error?.message || 'unknown error'}
      </div>
    );
  }

  return (
    <div className="p-2 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {accountHash && accounts[0]
              ? `Account ${accounts[0].account_number}`
              : `Snapshot across ${allAccounts.length} account${allAccounts.length === 1 ? '' : 's'}`}
            {' · '}{positions.length} position{positions.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Liquidation value"
          value={fmtMoney(totals.liquidation)}
          sub={`Cash ${fmtMoney(totals.cash)}`}
          icon={Wallet}
          accent="indigo"
        />
        <Kpi
          label="Buying power"
          value={fmtMoney(totals.buyingPower)}
          sub={`Cost basis ${fmtMoney(totals.costGross)}`}
          icon={TrendingUp}
          accent="sky"
        />
        <Kpi
          label="Unrealized P&L"
          value={fmtMoney(totals.unrealized)}
          sub={fmtPct(totals.unrealizedPct)}
          valueClass={pnlColor(totals.unrealized)}
          icon={TrendingUp}
          accent="emerald"
        />
        <Kpi
          label="Today's P&L"
          value={fmtMoney(totals.today)}
          sub={fmtPct(totals.todayPct)}
          valueClass={pnlColor(totals.today)}
          icon={TrendingUp}
          accent="amber"
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          to="/schwab/attention"
          className="bg-white border border-gray-200 rounded-lg p-4 hover:border-amber-400 hover:shadow-sm transition flex items-center justify-between"
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle className="h-6 w-6 text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm text-gray-500">Flagged for attention</div>
              <div className="text-xl font-semibold text-gray-900">{flaggedCount}</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400" />
        </Link>
        <Link
          to="/strategies"
          className="bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-400 hover:shadow-sm transition flex items-center justify-between"
        >
          <div className="flex items-center gap-3 min-w-0">
            <PieIcon className="h-6 w-6 text-indigo-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm text-gray-500">Strategies</div>
              <div className="text-xl font-semibold text-gray-900">{strategyAllocation.length}</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400" />
        </Link>
        <Link
          to="/analysis/portfolio"
          className="bg-white border border-gray-200 rounded-lg p-4 hover:border-violet-400 hover:shadow-sm transition flex items-center justify-between"
        >
          <div className="flex items-center gap-3 min-w-0">
            <CalendarClock className="h-6 w-6 text-violet-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm text-gray-500">Portfolio Analytics</div>
              <div className="text-xl font-semibold text-gray-900">Open</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400" />
        </Link>
      </div>

      {/* Allocation row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title="Allocation by strategy"
          icon={PieIcon}
          action={<Link to="/strategies" className="text-xs text-indigo-600 hover:underline">Strategies →</Link>}
          footer={
            boxSpreadCount > 0
              ? `Excludes ${boxSpreadCount} box spread${boxSpreadCount === 1 ? '' : 's'} — synthetic financing, sized by face value on the Box Spreads panel.`
              : null
          }
        >
          {strategyAllocation.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No positions yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={strategyAllocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={80}
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
                {(() => {
                  const allocTotal = strategyAllocation.reduce((acc, x) => acc + x.value, 0);
                  return strategyAllocation.slice(0, 8).map((s) => {
                    const pct = allocTotal > 0 ? (s.value / allocTotal) * 100 : 0;
                    return (
                    <li key={s.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ background: STRATEGY_COLORS[s.key] || STRATEGY_COLORS.unclassified }}
                        />
                        <span className="truncate text-gray-700">{s.name}</span>
                      </div>
                      <span className="tabular-nums text-gray-500 ml-2">
                        {pct.toFixed(0)}%
                      </span>
                    </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Allocation by account"
          icon={Wallet}
          action={<Link to="/schwab/positions" className="text-xs text-indigo-600 hover:underline">Accounts →</Link>}
        >
          {accountAllocation.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">No accounts yet.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={accountAllocation} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmtMoney(v)} />
                  <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Upcoming expirations */}
      <SectionCard
        title="Upcoming expirations (next 30 days)"
        icon={CalendarClock}
        action={
          <Link to="/schwab/attention" className="text-xs text-indigo-600 hover:underline">
            Account Attention →
          </Link>
        }
      >
        {upcomingExpirations.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No option positions expiring in the next 30 days.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcomingExpirations.map((b) => (
              <li key={b.date} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      b.dte <= 7
                        ? 'bg-red-100 text-red-800'
                        : b.dte <= 14
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {b.dte === 0 ? 'today' : `${b.dte}d`}
                  </span>
                  <span className="text-sm text-gray-700 tabular-nums">{b.date}</span>
                </div>
                <div className="text-xs text-gray-500 tabular-nums">
                  {b.count} position{b.count === 1 ? '' : 's'} · {fmtMoney(b.value)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
