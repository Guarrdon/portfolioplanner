/**
 * BoxSpreadsPanel — synthetic-loan box spreads detail.
 *
 * Group-driven: 4-leg balanced boxes (1 long+1 short call, 1 long+1
 * short put, matched strike pairs, equal contracts, same expiration).
 *
 * Long box  = synthetic LEND (you pay debit, receive face at expiration).
 * Short box = synthetic BORROW (you receive credit, owe face at expiration).
 *
 * Most retail use is short SPX boxes for cheap margin financing. Panel
 * emphasizes face-value liability over margin (irrelevant under PM) so
 * you can see the cash maturity wall, and compares implied rates against
 * the FRED 3-month T-bill benchmark.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw, TrendingUp, TrendingDown, Calendar,
  Calculator,
} from 'lucide-react';
import { fetchBoxSpreadsHoldings } from '../../../services/tags';

// Targeting calculator config. Pure client-side — given a base rate and
// DTE, what credit (short box) or debit (long box) to target across a
// few common face-value sizes, at three pricing aggressiveness tiers.
//
// Tier semantics from a short-box-borrower's POV:
//   Aggressive = best price, tight spread to T-bill, may not fill
//   Good       = typical SPX-box spread, fair-value fill
//   Fast       = pay up for instant liquidity
const CALC_FACE_VALUES = [10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
const CALC_TIERS = [
  { key: 'aggressive', label: 'Aggressive', bps: 10,
    desc: 'Best price (T-bill + 10 bps). Tight, may take time to fill.' },
  { key: 'good', label: 'Good', bps: 35,
    desc: 'Typical SPX box spread (T-bill + 35 bps). Fair-value fill.' },
  { key: 'fast', label: 'Fast', bps: 75,
    desc: 'Pay up for instant fill (T-bill + 75 bps).' },
];

// principal_at_open = face / (1 + rate × dte/365). Same formula whether
// you're computing the credit a short box should generate or the debit a
// long box should cost — boxes are symmetric synthetic loans.
const calcPrincipal = (face, ratePct, dte) => {
  if (!Number.isFinite(face) || !Number.isFinite(ratePct) || !Number.isFinite(dte)) return null;
  if (face <= 0 || dte <= 0) return null;
  return face / (1 + (ratePct / 100) * (dte / 365));
};

// Legend co-located with chip color maps below.
const LEGEND_BADGES = [
  { name: 'Long Box', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Synthetic lend. You paid a debit at open and receive the face value (high − low strike × 100 × contracts) at expiration. Earns implied yield.' },
  { name: 'Short Box', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Synthetic borrow. You received a credit at open and owe the face value at expiration. Pays implied rate (cheap PM financing).' },
  { name: 'Settling soon', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: '≤30 days to expiration. Short boxes resolving here need cash on hand by then; long boxes are about to receive their settlement.' },
  { name: 'Patient', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: '>30 DTE. Plenty of time before settlement.' },
  { name: 'Below benchmark', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: 'Long-box yield is materially below the FRED 3-mo T-bill rate. You\'re lending below risk-free — likely worth closing.' },
];
const LEGEND_COLUMNS = [
  { name: 'Face value', desc: '(high − low strike) × 100 × contracts. Cash that changes hands at expiration regardless of where the underlying is.' },
  { name: 'Net @open', desc: 'Signed cash flow at trade entry. Positive = credit collected (short box, you borrowed); negative = debit paid (long box, you lent).' },
  { name: 'Implied rate', desc: '(face − principal) ÷ principal × (365 ÷ total term). The annualized lending yield (long) or borrowing cost (short).' },
  { name: 'Δ vs benchmark', desc: 'Implied rate − FRED 3-mo T-bill. For long boxes: positive = better than risk-free. For short boxes: positive = paying spread over risk-free (normal — typical SPX box spread is +25-75 bps).' },
  { name: '$/day carry', desc: 'Daily yield accrual (long, positive) or cost (short, negative). Total face-vs-principal gap divided by total term days.' },
  { name: 'Days held / DTE', desc: 'Term progress. Days held since the earliest opening transaction; DTE to expiration.' },
];

const TYPE_BADGE = {
  'Long Box':  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Short Box': 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_BADGE = {
  'Settling soon': 'bg-amber-50 text-amber-700 border-amber-200',
  'Patient':       'bg-sky-50 text-sky-700 border-sky-200',
  '?':             'bg-gray-50 text-gray-500 border-gray-200',
};

const RECON_BADGE = {
  live:     { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Live' },
  mismatch: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'No quote' },
};
const ReconBadge = ({ recon }) => {
  if (!recon || !recon.state) return <span className="text-gray-300">—</span>;
  const cfg = RECON_BADGE[recon.state] || { icon: HelpCircle, cls: 'bg-gray-50 text-gray-500 border-gray-200', label: recon.state };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${cfg.cls}`} title={recon.summary || cfg.label}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
};

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
const fmtInt = (v) => (v === null || v === undefined || isNaN(v) ? '—' : parseInt(v, 10).toLocaleString('en-US'));
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

const BoxSpreadsPanel = () => {
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState('dte');
  const [sortDir, setSortDir] = useState('asc');
  const [legendOpen, setLegendOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  // Targeting calculator inputs. Rate prefills from benchmark and stays
  // synced UNTIL the user touches it; once edited, their value sticks
  // (otherwise a benchmark refresh would clobber a manual override).
  const [calcRate, setCalcRate] = useState(3.68);
  const [calcDTE, setCalcDTE] = useState(300);
  const [userEditedRate, setUserEditedRate] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['box-spreads-holdings'],
    queryFn: fetchBoxSpreadsHoldings,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['box-spreads-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const exposure = data?.exposure || {};
  const benchmark = data?.benchmark;

  // Sync calc rate to benchmark when it first arrives (or refreshes),
  // unless the user has manually overridden the value.
  useEffect(() => {
    if (!userEditedRate && benchmark?.rate_pct != null) {
      setCalcRate(benchmark.rate_pct);
    }
  }, [benchmark?.rate_pct, userEditedRate]);

  // Pre-compute the entire calc table once per (rate, dte) change.
  const calcRows = useMemo(() => {
    return CALC_FACE_VALUES.map((face) => {
      const cells = CALC_TIERS.map((tier) => {
        const rate = calcRate + tier.bps / 100;
        const credit = calcPrincipal(face, rate, calcDTE);
        return { ...tier, rate, credit };
      });
      return { face, cells };
    });
  }, [calcRate, calcDTE]);

  const sorted = useMemo(() => {
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
        case 'underlying': r = (a.underlying || '').localeCompare(b.underlying || '') * dir; break;
        case 'type': r = (a.type || '').localeCompare(b.type || '') * dir; break;
        case 'face': r = cmp(a, b, 'face_value'); break;
        case 'open': r = cmp(a, b, 'net_at_open'); break;
        case 'rate': r = cmp(a, b, 'implied_rate_pct'); break;
        case 'delta': r = cmp(a, b, 'delta_vs_benchmark_pct'); break;
        case 'dte': r = cmp(a, b, 'dte'); break;
        case 'days_held': r = cmp(a, b, 'days_held'); break;
        case 'pct_port': r = cmp(a, b, 'pct_port'); break;
        case 'pnl': r = cmp(a, b, 'row_total_pnl'); break;
        default: r = 0;
      }
      if (r === 0) return (a.dte ?? 0) - (b.dte ?? 0);
      return r;
    });
    return list;
  }, [holdings, sortKey, sortDir]);

  // Weighted-average rates across long and short separately. Weighted by
  // open principal so larger boxes pull the average toward their rate.
  const weightedRates = useMemo(() => {
    let longNum = 0, longDen = 0, shortNum = 0, shortDen = 0;
    let longCount = 0, shortCount = 0;
    let belowBench = 0;
    for (const h of holdings) {
      if (h.implied_rate_pct == null || h.open_principal == null) continue;
      if (h.direction === 'long') {
        longNum += h.implied_rate_pct * h.open_principal;
        longDen += h.open_principal;
        longCount += 1;
        if (h.below_benchmark) belowBench += 1;
      } else if (h.direction === 'short') {
        shortNum += h.implied_rate_pct * h.open_principal;
        shortDen += h.open_principal;
        shortCount += 1;
      }
    }
    return {
      longCount, shortCount, belowBench,
      longRate: longDen > 0 ? longNum / longDen : null,
      shortRate: shortDen > 0 ? shortNum / shortDen : null,
    };
  }, [holdings]);

  const groupRollups = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { count: 0, longFace: 0, shortFace: 0 });
        const g = m.get(tid);
        g.count += 1;
        if (h.direction === 'long') g.longFace += h.face_value || 0;
        else if (h.direction === 'short') g.shortFace += h.face_value || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
      }))
      .sort((a, b) => (b.shortFace + b.longFace) - (a.shortFace + a.longFace));
  }, [holdings, tagById]);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'underlying' || key === 'type' || key === 'dte' ? 'asc' : 'desc');
    }
  };

  if (isLoading) return <div className="mt-4 text-sm text-gray-500">Loading box spreads…</div>;
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load: {error.message}
      </div>
    );
  }

  return (
    <section className="mt-4 bg-white border border-gray-200 rounded">
      <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {benchmark?.rate_pct != null
            ? <>benchmark {fmtPct(benchmark.rate_pct)} ({benchmark.series_id}, {benchmark.rate_date})</>
            : ''}
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Type & status badges</div>
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

      {/* KPI strip — emphasizes face-value liability over margin (PM
          makes margin ~$0 for SPX boxes, so it's not the real story). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat
          label="Open"
          value={holdings.length}
          hint={`${weightedRates.longCount} long · ${weightedRates.shortCount} short`}
        />
        <Stat
          label="Lent (face)"
          value={
            <span className="text-emerald-700 inline-flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              {fmtMoney0(exposure.long_face_total)}
            </span>
          }
          hint="Face value receivable from long boxes at expiration"
        />
        <Stat
          label="Borrowed (face)"
          value={
            <span className="text-amber-700 inline-flex items-center gap-1">
              <TrendingDown className="w-3.5 h-3.5" />
              {fmtMoney0(exposure.short_face_total)}
            </span>
          }
          hint="Face value owed back at short-box expiration"
        />
        <Stat
          label="Borrowed today"
          value={<span className="text-gray-700">{fmtMoney0(exposure.short_cash_at_open)}</span>}
          hint="Net credit you received at open across short boxes"
        />
        <Stat
          label="Lending yield"
          value={
            weightedRates.longRate != null
              ? <span className="text-emerald-700">{fmtPct(weightedRates.longRate)}</span>
              : '—'
          }
          hint="Weighted-avg implied yield across open long boxes"
        />
        <Stat
          label="Borrowing rate"
          value={
            weightedRates.shortRate != null
              ? <span className="text-amber-700">{fmtPct(weightedRates.shortRate)}</span>
              : '—'
          }
          hint={
            benchmark?.rate_pct != null && weightedRates.shortRate != null
              ? `Weighted avg vs FRED ${fmtPct(benchmark.rate_pct)} = ${fmtPct(weightedRates.shortRate - benchmark.rate_pct, true)}`
              : 'Weighted-avg implied rate across open short boxes'
          }
        />
        <Stat
          label="Settling ≤30d"
          value={
            (exposure.short_face_30d || 0) > 0
              ? <span className="text-amber-700">{fmtMoney0(exposure.short_face_30d)}</span>
              : <span className="text-gray-700">$0</span>
          }
          hint="Short-box face value resolving in the next 30 days — cash you'll need on hand"
        />
      </div>

      {/* Account exposure ribbon — the borrowed-against-portfolio framing. */}
      {(exposure.short_face_total > 0 || exposure.long_face_total > 0) && (
        <div className="px-3 py-2 border-b border-gray-200 bg-amber-50/40">
          <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-1">Account exposure</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {exposure.short_face_pct_port != null && (
              <div>
                <span className="text-gray-700">Short-box liabilities</span>{' '}
                <span className="font-medium tabular-nums text-amber-800">
                  {fmtMoney0(exposure.short_face_total)} ({fmtPct(exposure.short_face_pct_port)} of LV)
                </span>
              </div>
            )}
            <div>
              <span className="text-gray-700">≤30d settle</span>{' '}
              <span className="tabular-nums">{fmtMoney0(exposure.short_face_30d)}</span>
            </div>
            <div>
              <span className="text-gray-700">≤90d settle</span>{' '}
              <span className="tabular-nums">{fmtMoney0(exposure.short_face_90d)}</span>
            </div>
            {exposure.long_face_total > 0 && (
              <div>
                <span className="text-gray-700">Long-box assets</span>{' '}
                <span className="text-emerald-800 font-medium tabular-nums">{fmtMoney0(exposure.long_face_total)}</span>
              </div>
            )}
            <div>
              <span className="text-gray-700">Net at expiration</span>{' '}
              <span className={pnlClass(exposure.net_face) + ' font-medium tabular-nums'}>
                {fmtMoney0(exposure.net_face, true)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Per-expiration concentration callout — useful when multiple short
          boxes settle on the same date and the user needs to plan cash. */}
      {(exposure.short_concentration || []).length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1 inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Short-box settlements by date
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {exposure.short_concentration.map((c) => (
              <span
                key={c.expiration}
                className="border border-gray-200 rounded px-1.5 py-0.5 bg-white tabular-nums"
                title={`${fmtMoney0(c.face_value)} owed at ${c.expiration}`}
              >
                <span className="text-gray-600">{c.expiration}</span>
                <span className="ml-1.5 text-amber-800 font-medium">{fmtMoney0(c.face_value)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Targeting calculator — collapsible. Pure client-side math; no
          extra API call. Helps you decide what credit to target on a new
          short box at a given rate × DTE, across common face sizes. */}
      <div className="border-b border-gray-200">
        <button
          onClick={() => setCalcOpen((o) => !o)}
          className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] hover:bg-gray-50"
        >
          <span className="inline-flex items-center gap-1.5 uppercase tracking-wide text-gray-500">
            <Calculator className="w-3 h-3" />
            Target pricing calculator
            {!calcOpen && (
              <span className="ml-2 normal-case tracking-normal text-gray-400">
                — what should I bid for a {calcDTE}d box?
              </span>
            )}
          </span>
          {calcOpen
            ? <ChevronUp className="w-3 h-3 text-gray-500" />
            : <ChevronDown className="w-3 h-3 text-gray-500" />
          }
        </button>

        {calcOpen && (
          <div className="px-3 pb-2">
            {/* Inputs */}
            <div className="flex flex-wrap items-end gap-3 mb-2 text-[11px]">
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Rate %</span>
                <input
                  type="number"
                  step="0.01"
                  value={Number.isFinite(calcRate) ? calcRate : ''}
                  onChange={(e) => {
                    setCalcRate(parseFloat(e.target.value));
                    setUserEditedRate(true);
                  }}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-xs tabular-nums"
                />
              </label>
              {benchmark?.rate_pct != null && (
                <button
                  type="button"
                  onClick={() => {
                    setCalcRate(benchmark.rate_pct);
                    setUserEditedRate(false);
                  }}
                  className="text-[10px] text-sky-700 hover:underline self-end pb-1.5"
                  title={`Reset to FRED ${benchmark.series_id} as of ${benchmark.rate_date}`}
                >
                  reset to FRED {benchmark.rate_pct.toFixed(2)}%
                </button>
              )}
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">DTE (days)</span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={Number.isFinite(calcDTE) ? calcDTE : ''}
                  onChange={(e) => setCalcDTE(parseInt(e.target.value, 10))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-xs tabular-nums"
                />
              </label>
              <span className="text-[10px] text-gray-500 self-end pb-1.5">
                Tier spreads: {CALC_TIERS.map((t) => `${t.label} +${t.bps} bps`).join(' · ')}
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-gray-50 text-gray-500 border-y border-gray-200">
                  <tr>
                    <th className="px-2 py-1 text-right font-medium">Face value</th>
                    {CALC_TIERS.map((t) => (
                      <th key={t.key} className="px-2 py-1 text-right font-medium" title={t.desc}>
                        {t.label}
                        <span className="ml-1 text-[10px] text-gray-400 font-normal">+{t.bps}bp</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calcRows.map((row) => (
                    <tr key={row.face} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-2 py-1 text-right font-medium text-gray-900">
                        {fmtMoney0(row.face)}
                      </td>
                      {row.cells.map((cell) => (
                        <td key={cell.key} className="px-2 py-1 text-right">
                          <div className="font-medium text-gray-900">
                            {cell.credit != null ? fmtMoney0(cell.credit) : '—'}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            @ {cell.rate.toFixed(2)}%
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-1.5 text-[10px] text-gray-500 leading-snug">
              Target value = face ÷ (1 + rate × DTE/365). Shown as the
              credit a short box should generate at open (or, equivalently,
              the debit a long box should cost). For a fill that beats
              "Good", offer the Aggressive number; if you need it filled
              instantly, pay the Fast number. SPX boxes typically clear
              between Good and Fast.
            </div>
          </div>
        )}
      </div>

      {/* By-group rollup */}
      {groupRollups.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">By group</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {groupRollups.map((g) => (
              <div key={g.tag.id} className="border border-gray-200 rounded px-2 py-1.5 bg-gray-50">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.tag.color || '#9ca3af' }} />
                  <span className="text-xs font-medium text-gray-900 truncate">{g.tag.name}</span>
                  <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{g.count}</span>
                </div>
                <div className="flex items-baseline gap-2 text-[11px] tabular-nums flex-wrap">
                  {g.shortFace > 0 && <span className="text-amber-800">borrowed {fmtMoney0(g.shortFace)}</span>}
                  {g.longFace > 0 && <span className="text-emerald-800">lent {fmtMoney0(g.longFace)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active box spreads tagged with this strategy. A box is a
          4-leg balanced structure (1 long+1 short call, 1 long+1 short
          put, matched strike pairs, equal contracts, same expiration),
          classified into a Group with strategy class
          <span className="font-medium"> Box Spreads</span>.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                {/* ----- POSITION DATA ----- */}
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Type" sortKey="type" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-left">Strikes</th>
                <th className="px-2 py-1.5 font-medium text-right">Contr.</th>
                <SortableTh label="Face" sortKey="face" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Cash that changes hands at expiration" />
                <SortableTh label="Net @open" sortKey="open" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Signed cash at trade entry" />
                <th className="px-2 py-1.5 font-medium text-right">Mark</th>
                {/* ----- YIELD / RATE ----- */}
                <SortableTh label="Implied %" sortKey="rate" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Annualized lending yield (long) or borrowing cost (short)" />
                <SortableTh label="Δ vs FRED" sortKey="delta" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Implied rate − FRED 3-mo T-bill rate" />
                <th className="px-2 py-1.5 font-medium text-right" title="Daily yield accrual (long, +) or cost (short, −)">$/day</th>
                {/* ----- TIME ----- */}
                <SortableTh label="DTE" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Held" sortKey="days_held" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="P&L" sortKey="pnl" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Mark-to-market vs net @open" />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Face value ÷ portfolio liquidation value" />
                {/* ----- SIGNALS ----- */}
                <th className="px-2 py-1.5 font-medium text-center">Status</th>
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => (
                <tr
                  key={h.chain_id}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 align-top"
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-gray-900">{h.underlying}</div>
                    {h.expiration && (
                      <div className="text-[10px] text-gray-500">{h.expiration}</div>
                    )}
                    {h.chain_name && (
                      <div className="text-[10px] text-gray-400 truncate max-w-[180px]">{h.chain_name}</div>
                    )}
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
                    </div>
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[h.type] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {h.type}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-gray-700">{h.strikes_label}</td>
                  <td className="text-right px-2 py-1.5 text-gray-700">{fmtInt(h.contracts)}</td>
                  <td className="text-right px-2 py-1.5 text-gray-900 font-medium">{fmtMoney0(h.face_value)}</td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.net_at_open)}`}>{fmtMoney0(h.net_at_open, true)}</td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {fmtMoney0(h.current_value, true)}
                  </td>
                  <td className={`text-right px-2 py-1.5 font-medium ${
                    h.direction === 'long' ? 'text-emerald-700' : 'text-amber-700'
                  }`}>
                    {fmtPct(h.implied_rate_pct)}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${
                    h.below_benchmark ? 'text-red-700 font-medium' : pnlClass(h.delta_vs_benchmark_pct)
                  }`}>
                    {fmtPct(h.delta_vs_benchmark_pct, true)}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.daily_carry)}`}>
                    {fmtMoney(h.daily_carry, true)}
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(h.dte)}`}>
                      {h.dte == null ? '—' : `${h.dte}d`}
                    </span>
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    {h.days_held != null ? `${h.days_held}d` : '—'}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.row_total_pnl)}`}>
                    {fmtMoney0(h.row_total_pnl, true)}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">{fmtPct(h.pct_port)}</td>
                  <td className="text-center px-2 py-1.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_BADGE[h.status] || STATUS_BADGE['?']}`}>
                        {h.status}
                      </span>
                      {h.below_benchmark && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          Below bench
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <ReconBadge recon={h.reconciliation} />
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-300">
                    <ChevronRight className="w-3.5 h-3.5 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Box spreads are 4-leg balanced
          structures that act as synthetic loans. <span className="font-medium">Long box</span>:
          you lend cash today, receive face at expiration (earn yield).
          <span className="font-medium"> Short box</span>: you borrow cash today, owe face at
          expiration (pay implied rate). Most retail use is short SPX boxes for
          cheap PM-financing. <span className="font-medium">Δ vs FRED</span> compares the
          implied rate to the 3-mo T-bill rate
          {benchmark?.rate_pct != null && (
            <> (currently {fmtPct(benchmark.rate_pct)} as of {benchmark.rate_date})</>
          )}; for short boxes, +25–75 bps over T-bill is normal SPX-box spread,
          and the <span className="font-medium">Below benchmark</span> chip only fires on
          long boxes lending materially below risk-free.
          {(data?.excluded_complex_count > 0) && (
            <> <span className="font-medium">Excluded:</span> {data.excluded_complex_count} tagged
            chain{data.excluded_complex_count === 1 ? '' : 's'} that don't match the 4-leg balanced-box shape.</>
          )}
        </div>
      </div>
    </section>
  );
};

export default BoxSpreadsPanel;
