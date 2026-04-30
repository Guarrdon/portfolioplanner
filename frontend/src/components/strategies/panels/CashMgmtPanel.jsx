/**
 * CashMgmtPanel — excess-cash optimization detail.
 *
 * Companion to Box Spreads. Box-spread shorts SOURCE cash (a borrow);
 * cash-mgmt vehicles DEPLOY cash. The panel frames everything as a
 * carry trade:
 *
 *   net carry $/yr  ≈ Σ(deployed × yield)  −  Σ(borrowed × rate)
 *   net carry bps   ≈  weighted_cash_yield  −  weighted_borrow_rate
 *
 * Composition surfaced:
 *   • Per-vehicle rows: MMFs, treasury ETFs, short-bond ETFs, sweep.
 *   • Liabilities: short box spreads pulled from the same detector.
 *   • Aggregates: total cash, weighted yield, total borrowed, net carry.
 *   • Maturity ladder: month-by-month wall of box-debt settlements.
 *   • Concentration warning when one vehicle holds >40% of cash.
 *
 * Yields are derived from FRED (DGS1MO + DGS3MO) per vehicle type so
 * the panel tracks the rate environment without hard-coded numbers.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronUp, ChevronDown, RefreshCw, Info, HelpCircle,
  TrendingUp, TrendingDown, AlertTriangle, Calendar, Coins,
} from 'lucide-react';
import { fetchCashMgmtHoldings } from '../../../services/tags';
import { useSelectedAccountHash } from '../../../hooks/useSelectedAccount';

// Concentration threshold: any single vehicle above this share of total
// cash earns a "concentrated" warning chip. The whole point of the page
// is diversification — one bucket eating most of the cash defeats it.
const CONCENTRATION_WARN_PCT = 40;

const VEHICLE_LABEL = {
  mmf: 'Money Market',
  floating_rate_etf: 'Floating-rate ETF',
  treasury_etf: 'Treasury ETF',
  short_bond_etf: 'Short Bond ETF',
  sweep: 'Sweep cash',
  other: 'Other',
};
const VEHICLE_BADGE = {
  mmf: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  floating_rate_etf: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  treasury_etf: 'bg-sky-50 text-sky-700 border-sky-200',
  short_bond_etf: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  sweep: 'bg-gray-100 text-gray-700 border-gray-200',
  other: 'bg-gray-50 text-gray-600 border-gray-200',
};
const TIER_BADGE = {
  'T+0': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'T+1': 'bg-amber-50 text-amber-700 border-amber-200',
  hold: 'bg-rose-50 text-rose-700 border-rose-200',
};

const LEGEND_BADGES = [
  { name: 'Money Market', cls: VEHICLE_BADGE.mmf,
    desc: 'Schwab/Vanguard/Fidelity money-market funds (SWVXX, VMFXX, etc). Same-day liquidity, yield ≈ 1-mo T-bill minus typical fee drag.' },
  { name: 'Treasury ETF', cls: VEHICLE_BADGE.treasury_etf,
    desc: 'Ultra-short Treasury ETFs (SGOV, BIL, GBIL). Yield ≈ 3-mo T-bill. State-tax-free.' },
  { name: 'Floating-rate ETF', cls: VEHICLE_BADGE.floating_rate_etf,
    desc: 'Floating-rate Treasury ETFs (USFR, TFLO, FLOT). Coupon resets monthly so duration is near zero.' },
  { name: 'Short Bond ETF', cls: VEHICLE_BADGE.short_bond_etf,
    desc: 'Ultra-short corp / mixed (JAAA, JPST, MINT, ICSH). Pickup over Treasuries via credit & duration; not state-tax-free.' },
  { name: 'Sweep', cls: VEHICLE_BADGE.sweep,
    desc: 'Schwab default uninvested-cash sweep. Yield is famously low (~0.45%) — money parked here is opportunity cost.' },
  { name: 'T+0 / T+1', cls: TIER_BADGE['T+0'],
    desc: 'Liquidity tier — T+0 settles same day (sweep, MMF), T+1 next business day (most ETFs).' },
];
const LEGEND_COLUMNS = [
  { name: 'Est yield', desc: 'Annualized yield estimate for the vehicle, derived from FRED 1-mo & 3-mo Treasury rates plus a per-class spread (MMF -25 bps, treasury ETF ~at, short-bond +30 bps, floating-rate at 1-mo).' },
  { name: 'Annual income', desc: 'market_value × est_yield. The dollars per year this row is throwing off if yield holds steady.' },
  { name: '% of cash', desc: 'Row market value ÷ total deployed cash + sweep. Concentration warning fires above 40%.' },
  { name: '% port', desc: 'Row market value ÷ portfolio liquidation value. Frames the row in account terms.' },
  { name: 'Net carry', desc: 'annual_cash_income − annual_borrow_cost. Headline KPI: positive means deployed cash out-earns the cost of any box-spread borrow.' },
];

const fmtMoney = (v, signed = false) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};
const fmtMoney0 = (v, signed = false) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};
const fmtPct = (v, signed = false, decimals = 2) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v).toFixed(decimals);
  if (signed) return `${v >= 0 ? '+' : '−'}${abs}%`;
  return `${v < 0 ? '−' : ''}${abs}%`;
};
const fmtBps = (v, signed = true) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v).toFixed(0);
  if (signed) return `${v >= 0 ? '+' : '−'}${abs} bps`;
  return `${v < 0 ? '−' : ''}${abs} bps`;
};
const pnlClass = (n) => {
  if (n === null || n === undefined || isNaN(n)) return 'text-gray-500';
  return n >= 0 ? 'text-emerald-700' : 'text-red-700';
};
const dteStyle = (dte) => {
  if (dte == null) return 'bg-gray-100 text-gray-500 border-gray-200';
  if (dte < 0) return 'bg-gray-50 text-gray-400 border-gray-200';
  if (dte <= 7) return 'bg-red-50 text-red-700 border-red-200';
  if (dte <= 30) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
};

const SortableTh = ({ label, sortKey, currentKey, currentDir, onSort, align = 'left', title }) => {
  const active = currentKey === sortKey;
  const Arrow = active ? (currentDir === 'asc' ? ChevronUp : ChevronDown) : null;
  return (
    <th
      title={title}
      className={`px-2 py-1.5 font-medium ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } cursor-pointer select-none hover:bg-gray-100`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${active ? 'text-sky-700' : ''}`}>
        {label}
        {Arrow && <Arrow className="w-3 h-3" />}
      </span>
    </th>
  );
};


const Stat = ({ label, value, hint }) => (
  <div>
    <div className="text-gray-500 flex items-center gap-1">
      {label}
      {hint && <span className="text-gray-400" title={hint}><Info className="w-3 h-3 inline" /></span>}
    </div>
    <div className="font-medium text-gray-900 tabular-nums">{value}</div>
  </div>
);

const CashMgmtPanel = () => {
  const queryClient = useQueryClient();
  const accountHash = useSelectedAccountHash();
  const [sortKey, setSortKey] = useState('mv');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['cash-mgmt-holdings', accountHash],
    queryFn: () => fetchCashMgmtHoldings(accountHash),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cash-mgmt-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);

  // Footer totals — sum directly from rows so the values match what the
  // user sees in the table (rounding/aliasing-aware).
  const footer = useMemo(() => {
    let mv = 0, income = 0, pctCash = 0, pctPort = 0, unreal = 0;
    let yieldNum = 0, yieldDen = 0;
    for (const h of holdings) {
      mv += Number(h.market_value) || 0;
      income += Number(h.annual_income) || 0;
      pctCash += Number(h.pct_cash) || 0;
      pctPort += Number(h.pct_port) || 0;
      unreal += Number(h.unrealized_pnl) || 0;
      if (h.est_yield_pct != null && (h.market_value || 0) > 0) {
        yieldNum += h.est_yield_pct * h.market_value;
        yieldDen += h.market_value;
      }
    }
    return {
      count: holdings.length, mv, income, pctCash, pctPort, unreal,
      yieldWeighted: yieldDen > 0 ? yieldNum / yieldDen : null,
    };
  }, [holdings]);
  const liabilities = data?.liabilities || [];
  const ladder = data?.ladder || [];
  const aggs = data?.aggregates || {};
  const benchmarks = data?.benchmarks || {};

  // Largest concentration callout fires when a single vehicle holds
  // >CONCENTRATION_WARN_PCT of total deployed cash.
  const concentrationWarn = (
    aggs.max_concentration_pct != null
    && aggs.max_concentration_pct >= CONCENTRATION_WARN_PCT
  );

  const sortedHoldings = useMemo(() => {
    const list = [...holdings];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b, key) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    };
    list.sort((a, b) => {
      let r;
      switch (sortKey) {
        case 'symbol': r = (a.symbol || '').localeCompare(b.symbol || '') * dir; break;
        case 'vehicle': r = (a.vehicle_type || '').localeCompare(b.vehicle_type || '') * dir; break;
        case 'mv': r = cmp(a, b, 'market_value'); break;
        case 'yield': r = cmp(a, b, 'est_yield_pct'); break;
        case 'income': r = cmp(a, b, 'annual_income'); break;
        case 'pct_cash': r = cmp(a, b, 'pct_cash'); break;
        case 'pct_port': r = cmp(a, b, 'pct_port'); break;
        case 'unrealized': r = cmp(a, b, 'unrealized_pnl'); break;
        default: r = 0;
      }
      if (r === 0) return (b.market_value || 0) - (a.market_value || 0);
      return r;
    });
    return list;
  }, [holdings, sortKey, sortDir]);

  // Per-tier liquidity rollups (T+0 vs T+1 vs hold). Useful when the
  // user needs to know how much cash they can actually deploy tomorrow.
  const liquidityByTier = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      const t = h.liquidity_tier || 'T+1';
      m.set(t, (m.get(t) || 0) + (h.market_value || 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [holdings]);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' || key === 'vehicle' ? 'asc' : 'desc');
    }
  };

  if (isLoading) return <div className="mt-4 text-sm text-gray-500">Loading cash management…</div>;
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load: {error.message}
      </div>
    );
  }

  const netCarryClass = pnlClass(aggs.net_carry_dollars);

  return (
    <section className="mt-4 bg-white border border-gray-200 rounded">
      {/* Header strip: benchmarks + legend/refresh. Sync timestamp lives
          on the per-account button in the header. */}
      <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {benchmarks.rate_1mo?.rate_pct != null && (
            <span>1mo {fmtPct(benchmarks.rate_1mo.rate_pct)}</span>
          )}
          {benchmarks.rate_3mo?.rate_pct != null && (
            <span className="ml-1">
              · 3mo {fmtPct(benchmarks.rate_3mo.rate_pct)} ({benchmarks.rate_3mo.rate_date})
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLegendOpen((o) => !o)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-100 ${
              legendOpen ? 'text-sky-700 bg-sky-50' : 'text-gray-600'
            }`}
            title="What do these chips and columns mean?"
          >
            <HelpCircle className="w-3 h-3" />
            Legend
          </button>
          <button
            onClick={onRefresh}
            disabled={isFetching}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40"
            title="Reload from backend cache"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {legendOpen && (
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-[11px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Vehicle &amp; tier badges</div>
              <ul className="space-y-1.5">
                {LEGEND_BADGES.map((b) => (
                  <li key={b.name} className="flex items-start gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0 ${b.cls}`}>{b.name}</span>
                    <span className="text-gray-700">{b.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Columns explained</div>
              <ul className="space-y-1.5">
                {LEGEND_COLUMNS.map((c) => (
                  <li key={c.name}>
                    <span className="font-medium text-gray-900">{c.name}</span>
                    <span className="text-gray-700"> — {c.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* KPI strip — net carry is the headline. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat
          label="Cash deployed"
          value={
            <span className="text-emerald-700 inline-flex items-center gap-1">
              <Coins className="w-3.5 h-3.5" />
              {fmtMoney0(aggs.total_cash)}
            </span>
          }
          hint="Sum of all vehicle market values + sweep cash"
        />
        <Stat
          label="Cash yield"
          value={
            aggs.weighted_cash_yield_pct != null
              ? <span className="text-emerald-700">{fmtPct(aggs.weighted_cash_yield_pct)}</span>
              : '—'
          }
          hint="Weighted-avg estimated yield, weighted by market value"
        />
        <Stat
          label="Annual cash income"
          value={
            <span className="text-emerald-700">{fmtMoney0(aggs.annual_cash_income)}</span>
          }
          hint="Σ(market_value × est_yield)"
        />
        <Stat
          label="Borrowed (face)"
          value={
            (aggs.total_borrowed_face || 0) > 0
              ? <span className="text-amber-700 inline-flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  {fmtMoney0(aggs.total_borrowed_face)}
                </span>
              : <span className="text-gray-700">$0</span>
          }
          hint="Short-box face value owed at expiration"
        />
        <Stat
          label="Borrow rate"
          value={
            aggs.weighted_borrow_rate_pct != null
              ? <span className="text-amber-700">{fmtPct(aggs.weighted_borrow_rate_pct)}</span>
              : '—'
          }
          hint="Weighted-avg implied rate across short boxes"
        />
        <Stat
          label="Annual borrow cost"
          value={
            (aggs.annual_borrow_cost || 0) > 0
              ? <span className="text-amber-700">{fmtMoney0(aggs.annual_borrow_cost)}</span>
              : <span className="text-gray-700">$0</span>
          }
          hint="Σ(face × implied_rate) — the dollars-per-year cost of carrying short-box borrow"
        />
        <Stat
          label="Net carry"
          value={
            <span className={`${netCarryClass} inline-flex items-center gap-1`}>
              {(aggs.net_carry_dollars || 0) >= 0
                ? <TrendingUp className="w-3.5 h-3.5" />
                : <TrendingDown className="w-3.5 h-3.5" />}
              {fmtMoney0(aggs.net_carry_dollars, true)}
              {aggs.net_carry_bps != null && (
                <span className="text-[10px] font-normal text-gray-500 ml-1">
                  ({fmtBps(aggs.net_carry_bps)})
                </span>
              )}
            </span>
          }
          hint="Cash income minus borrow cost. Positive = deployed yield beats cost of any box-spread debt."
        />
      </div>

      {/* Liquidity tier ribbon: how much cash is actually accessible by tier. */}
      {liquidityByTier.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 bg-emerald-50/30">
          <div className="text-[11px] uppercase tracking-wide text-emerald-800 mb-1">
            Liquidity tiers
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {liquidityByTier.map(([tier, amt]) => (
              <div key={tier}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_BADGE[tier] || TIER_BADGE['T+1']}`}>
                  {tier}
                </span>
                <span className="ml-1.5 tabular-nums font-medium text-gray-800">
                  {fmtMoney0(amt)}
                </span>
                <span className="ml-1 text-gray-500 tabular-nums">
                  ({aggs.total_cash > 0 ? fmtPct((amt / aggs.total_cash) * 100, false, 0) : '—'})
                </span>
              </div>
            ))}
            {aggs.cash_pct_port != null && (
              <div className="ml-auto">
                <span className="text-gray-700">Cash as % of LV</span>{' '}
                <span className="font-medium tabular-nums text-emerald-800">
                  {fmtPct(aggs.cash_pct_port)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Concentration warning when one bucket dominates. */}
      {concentrationWarn && (
        <div className="px-3 py-1.5 border-b border-gray-200 bg-amber-50/60 text-[11px] text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            <span className="font-medium">{aggs.max_concentration_symbol}</span> holds{' '}
            <span className="font-medium tabular-nums">{fmtPct(aggs.max_concentration_pct, false, 0)}</span>{' '}
            of deployed cash — point of this page is diversification across vehicles.
          </span>
        </div>
      )}

      {/* Maturity ladder — month-by-month box-debt settlement wall. */}
      {ladder.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1 inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Maturity ladder — short-box debt settling by month
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {ladder.map((b) => (
              <span
                key={b.month}
                className="border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5 tabular-nums"
                title={`${fmtMoney0(b.debt_settling)} of short-box face value owed in ${b.month}`}
              >
                <span className="text-gray-700">{b.month}</span>
                <span className="ml-1.5 text-amber-800 font-medium">{fmtMoney0(b.debt_settling)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Holdings table */}
      {sortedHoldings.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No cash positions tagged with this strategy. Tag an MMF, treasury
          ETF, or short-bond ETF position into a Group with strategy class{' '}
          <span className="font-medium">Cash Management</span>. Account
          sweep cash auto-includes if any account has an uninvested balance.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <SortableTh label="Symbol" sortKey="symbol" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <SortableTh label="Vehicle" sortKey="vehicle" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-center" title="Liquidity tier">Tier</th>
                <th className="px-2 py-1.5 font-medium text-left">Account</th>
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <th className="px-2 py-1.5 font-medium text-right">Qty</th>
                <th className="px-2 py-1.5 font-medium text-right">Price</th>
                <SortableTh label="Mkt value" sortKey="mv" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Est yield" sortKey="yield" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Annualized yield estimate" />
                <SortableTh label="Income/yr" sortKey="income" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="% of cash" sortKey="pct_cash" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Unreal P&L" sortKey="unrealized" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map((h, idx) => (
                <tr
                  key={`${h.symbol}-${h.account_hash || ''}-${idx}`}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 align-top"
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-gray-900">{h.symbol}</div>
                    {h.name && (
                      <div className="text-[10px] text-gray-500 truncate max-w-[200px]">{h.name}</div>
                    )}
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${VEHICLE_BADGE[h.vehicle_type] || VEHICLE_BADGE.other}`}>
                      {VEHICLE_LABEL[h.vehicle_type] || h.vehicle_type}
                    </span>
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_BADGE[h.liquidity_tier] || TIER_BADGE['T+1']}`}>
                      {h.liquidity_tier}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-700">
                    {h.account_number || (h.is_synthetic ? <span className="text-gray-400">—</span> : '—')}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {(h.tag_ids || []).map((tid) => {
                        const t = tagById.get(tid);
                        return (
                          <span
                            key={tid}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-700"
                            title={t?.name || tid}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: t?.color || '#9ca3af' }} />
                            {t?.name || '—'}
                          </span>
                        );
                      })}
                      {h.is_synthetic && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-50 text-gray-500 border border-dashed border-gray-300">
                          auto
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {h.quantity != null ? h.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {h.current_price != null ? fmtMoney(h.current_price) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-900 font-medium">
                    {fmtMoney0(h.market_value)}
                  </td>
                  <td className={`text-right px-2 py-1.5 font-medium ${
                    h.yield_source === 'unknown' ? 'text-gray-400' : 'text-emerald-700'
                  }`}>
                    {fmtPct(h.est_yield_pct)}
                  </td>
                  <td className="text-right px-2 py-1.5 text-emerald-700">
                    {h.annual_income != null ? fmtMoney0(h.annual_income) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {fmtPct(h.pct_cash, false, 0)}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {fmtPct(h.pct_port)}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.unrealized_pnl)}`}>
                    {fmtMoney(h.unrealized_pnl, true)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-300 font-medium text-gray-800">
              <tr>
                <td className="px-3 py-2 text-left">{footer.count} row{footer.count === 1 ? '' : 's'}</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right text-gray-900">{fmtMoney0(footer.mv)}</td>
                <td className="px-2 py-2 text-right text-emerald-700">
                  {footer.yieldWeighted != null ? fmtPct(footer.yieldWeighted) : '—'}
                </td>
                <td className="px-2 py-2 text-right text-emerald-700">
                  {fmtMoney0(footer.income)}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {fmtPct(footer.pctCash, false, 0)}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">{fmtPct(footer.pctPort)}</td>
                <td className={`px-2 py-2 text-right ${pnlClass(footer.unreal)}`}>
                  {fmtMoney(footer.unreal, true)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Liabilities sub-table — borrow side of the carry trade. */}
      {liabilities.length > 0 && (
        <div className="border-t border-gray-200">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 inline-flex items-center gap-1.5">
            <TrendingDown className="w-3 h-3" />
            Box-spread short liabilities — borrow side
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-gray-50 text-gray-500 border-y border-gray-200">
                <tr>
                  <th className="px-3 py-1.5 font-medium text-left">Underlying</th>
                  <th className="px-2 py-1.5 font-medium text-left">Expiration</th>
                  <th className="px-2 py-1.5 font-medium text-right">DTE</th>
                  <th className="px-2 py-1.5 font-medium text-right">Face value</th>
                  <th className="px-2 py-1.5 font-medium text-right">Implied rate</th>
                  <th className="px-2 py-1.5 font-medium text-right">$/yr cost</th>
                  <th className="px-2 py-1.5 font-medium text-left">Group</th>
                </tr>
              </thead>
              <tbody>
                {liabilities.map((l, idx) => {
                  const annualCost = l.implied_rate_pct != null
                    ? l.face_value * l.implied_rate_pct / 100
                    : null;
                  return (
                    <tr key={`${l.chain_id || idx}`} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium text-gray-900">{l.underlying || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-700">{l.expiration || '—'}</td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(l.dte)}`}>
                          {l.dte == null ? '—' : `${l.dte}d`}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-900 font-medium">
                        {fmtMoney0(l.face_value)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-amber-700 font-medium">
                        {fmtPct(l.implied_rate_pct)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-amber-700">
                        {annualCost != null ? fmtMoney0(annualCost) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {(l.tag_ids || []).map((tid) => {
                            const t = tagById.get(tid);
                            return (
                              <span
                                key={tid}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-700"
                                title={t?.name || tid}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ background: t?.color || '#9ca3af' }} />
                                {t?.name || '—'}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Cash Mgmt is the
          companion view to Box Spreads — box-spread shorts source cash;
          this page deploys it. <span className="font-medium">Net carry</span>{' '}
          is the dollars-per-year spread between deployed-cash yield and
          weighted box-borrow rate. Yields are estimated from FRED 1-mo &amp;
          3-mo Treasury rates plus a per-vehicle spread, so the panel
          tracks the rate environment automatically. Sweep cash rolls up
          from account uninvested balances and is shown at Schwab's
          default sweep yield (~0.45%) — visible opportunity cost when
          higher-yielding vehicles exist a click away.
        </div>
      </div>
    </section>
  );
};

export default CashMgmtPanel;
