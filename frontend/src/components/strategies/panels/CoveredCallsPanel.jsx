/**
 * CoveredCallsPanel — Covered Calls strategy detail.
 *
 * Live-first: rows are short-call legs paired with their underlying long
 * stock holding. Laddered calls get their own row sharing stock context.
 *
 * Headline questions for evaluating covered calls:
 *   - How much premium am I capturing today vs collected at open?
 *   - How close am I to assignment (strike vs spot)?
 *   - When do I have to decide (DTE)?
 *   - Would assignment lock in a stock gain or loss?
 *   - What's the sub-mode play — Income, Accumulation, or Protection?
 *
 * Greeks aren't currently captured on the raw fetch path, so assignment
 * risk is approximated from strike-vs-spot %. Mode hint uses moneyness
 * + DTE.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw, RotateCw,
} from 'lucide-react';
import { fetchCoveredCallsHoldings } from '../../../services/tags';

const CONC_WARN = 10;
const CONC_DANGER = 20;
const DTE_NEAR = 7;
const DTE_SOON = 30;

// ---------- formatters ----------

const fmtMoney = (v, signed = false) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};

const fmtPct = (v, signed = false, decimals = 1) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v).toFixed(decimals);
  if (signed) return `${v >= 0 ? '+' : '−'}${abs}%`;
  return `${v < 0 ? '−' : ''}${abs}%`;
};

const fmtShares = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
};

const fmtInt = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return parseInt(v, 10).toLocaleString('en-US');
};

const pnlClass = (n) => {
  if (n === null || n === undefined || isNaN(n)) return 'text-gray-500';
  return n >= 0 ? 'text-emerald-700' : 'text-red-700';
};

const concentrationClass = (pct) => {
  if (pct == null || isNaN(pct)) return 'text-gray-500';
  if (pct >= CONC_DANGER) return 'text-red-700 font-semibold';
  if (pct >= CONC_WARN) return 'text-amber-700 font-medium';
  return 'text-gray-700';
};

const dteStyle = (dte) => {
  if (dte == null) return 'bg-gray-100 text-gray-500 border-gray-200';
  if (dte < 0) return 'bg-gray-50 text-gray-400 border-gray-200';
  if (dte <= DTE_NEAR) return 'bg-red-50 text-red-700 border-red-200';
  if (dte <= DTE_SOON) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
};

const MODE_BADGE = {
  Income:       { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Accumulation: { cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  Protection:   { cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  ATM:          { cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  '?':          { cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

// Legend lives next to the chip color maps. Only non-obvious items.
const LEGEND_BADGES = [
  { name: 'Income', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'OTM call, ≤60 DTE. You’re harvesting time premium and don’t mind keeping the shares.' },
  { name: 'Accumulation', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: 'OTM call, >60 DTE. Low-Δ overlay; you’re willing to hold the stock through the call’s life.' },
  { name: 'Protection', cls: 'bg-purple-50 text-purple-700 border-purple-200',
    desc: 'ITM call. Mostly intrinsic — acts as downside protection on the long stock.' },
  { name: 'ATM', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Strike within ±2% of spot. Mode is ambiguous without delta — could be either income or assignment risk.' },
  { name: 'Roll', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: '≥75% of premium captured AND ≥14 DTE. Classic close/roll trigger — bank the credit, sell new time.' },
  { name: 'Covered', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Shares ≥ short calls × 100. The call is fully backed by stock you own.' },
  { name: 'Over-covered', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: 'You own more shares than the calls cover. The unsold shares sit naked of any call overlay.' },
  { name: 'Naked', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: 'Short calls without enough underlying shares to cover them. Margin/assignment risk.' },
];
const LEGEND_COLUMNS = [
  { name: 'Captured', desc: 'Premium received − cost to close, expressed in $ and % of original credit. The slice already earned.' },
  { name: 'OTM%', desc: '(strike − spot) / spot. Positive = OTM, negative = ITM. The buffer between current price and the strike.' },
  { name: '$/day decay', desc: 'Cost-to-close ÷ DTE. Forward-looking expected daily theta capture on the short call.' },
  { name: 'Risk: Safe → Likely', desc: 'PoP from short-call |Δ| (1 − |Δ| ≈ chance call expires worthless). Falls back to OTM% bands when greeks aren’t synced.' },
];

const RECON_BADGE = {
  covered:       { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Covered' },
  over_covered:  { icon: Info, cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Over-covered' },
  naked:         { icon: AlertTriangle, cls: 'bg-red-50 text-red-700 border-red-200', label: 'Naked' },
};

const ReconBadge = ({ recon }) => {
  if (!recon || !recon.state) return <span className="text-gray-300">—</span>;
  const cfg = RECON_BADGE[recon.state] || { icon: HelpCircle, cls: 'bg-gray-50 text-gray-500 border-gray-200', label: recon.state };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${cfg.cls}`}
      title={recon.summary || cfg.label}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
};

const SortableTh = ({ label, sortKey, currentKey, currentDir, onSort, align = 'left' }) => {
  const active = currentKey === sortKey;
  const Arrow = active ? (currentDir === 'asc' ? ChevronUp : ChevronDown) : null;
  return (
    <th
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

const CoveredCallsPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState('dte');
  const [sortDir, setSortDir] = useState('asc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['covered-calls-holdings'],
    queryFn: fetchCoveredCallsHoldings,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['covered-calls-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const portfolioMv = data?.portfolio_liquidation_value || 0;

  // Strategy MV is the sum of *unique* stock MV per (underlying, account)
  // — multiple call rows for the same stock holding share that MV.
  const stockMvByKey = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      const k = `${h.underlying}|${h.account_hash || ''}`;
      if (!m.has(k)) m.set(k, h.stock_market_value || 0);
    }
    return m;
  }, [holdings]);
  const stratStockMv = useMemo(
    () => Array.from(stockMvByKey.values()).reduce((s, v) => s + v, 0),
    [stockMvByKey]
  );

  const enriched = useMemo(() => {
    return holdings.map((h) => {
      const k = `${h.underlying}|${h.account_hash || ''}`;
      // Stock $ at strike: would assignment lock in a gain or loss?
      const strikeProceeds = (h.call_strike != null)
        ? h.call_strike * Math.min(Math.abs(h.call_quantity || 0) * 100, h.stock_shares || 0)
        : null;
      const stockCostAtStrike = (h.stock_avg_cost && Math.abs(h.call_quantity || 0) > 0)
        ? h.stock_avg_cost * Math.min(Math.abs(h.call_quantity || 0) * 100, h.stock_shares || 0)
        : null;
      const assignmentPnl = (strikeProceeds != null && stockCostAtStrike != null)
        ? strikeProceeds - stockCostAtStrike + (h.premium_received || 0)
        : null;

      // Annualized premium yield on the covered shares (for the user's
      // mental model: "what's this leg worth annually if I keep doing this?")
      const sharesCovered = Math.min(Math.abs(h.call_quantity || 0) * 100, h.stock_shares || 0);
      const stockBasis = sharesCovered * (h.stock_avg_cost || 0);
      const annYield = (h.premium_received > 0 && h.call_dte != null && h.call_dte > 0 && stockBasis > 0)
        ? (h.premium_received / stockBasis) * (365 / h.call_dte) * 100
        : null;

      // Value-to-time signals.
      const dollarsPerDay = (h.call_dte != null && h.call_dte > 0 && h.close_cost != null)
        ? h.close_cost / h.call_dte    // forward extrinsic decay rate per day
        : null;

      // Qualitative risk chip (PoP proxy without delta). Use real delta
      // when synced; fall back to OTM% bucket otherwise.
      let risk;
      if (h.call_delta != null) {
        const popPct = Math.max(0, Math.min(100, (1 - Math.abs(h.call_delta)) * 100));
        if (popPct >= 75) risk = { label: 'Safe', popPct, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
        else if (popPct >= 55) risk = { label: 'OK', popPct, cls: 'bg-sky-50 text-sky-700 border-sky-200' };
        else if (popPct >= 35) risk = { label: 'At risk', popPct, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
        else risk = { label: 'Likely', popPct, cls: 'bg-red-50 text-red-700 border-red-200' };
      } else if (h.otm_pct != null) {
        if (h.otm_pct >= 5) risk = { label: 'Safe', popPct: null, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
        else if (h.otm_pct >= 0) risk = { label: 'At risk', popPct: null, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
        else risk = { label: 'ITM', popPct: null, cls: 'bg-red-50 text-red-700 border-red-200' };
      } else {
        risk = { label: '?', popPct: null, cls: 'bg-gray-50 text-gray-500 border-gray-200' };
      }

      // Roll candidate: most premium harvested + plenty of life left.
      const isRollCandidate = (h.capture_pct != null && h.capture_pct >= 75
                               && h.call_dte != null && h.call_dte >= 14);

      return {
        ...h,
        rowKey: `${k}|${h.call_symbol || ''}`,
        pctPort: portfolioMv > 0 ? ((h.stock_market_value || 0) / portfolioMv) * 100 : null,
        pctStrat: stratStockMv > 0 ? ((h.stock_market_value || 0) / stratStockMv) * 100 : null,
        assignmentPnl,
        annYield,
        sharesCovered,
        dollarsPerDay,
        risk,
        isRollCandidate,
      };
    });
  }, [holdings, portfolioMv, stratStockMv]);

  const sorted = useMemo(() => {
    const list = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b, key) => {
      const av = a[key];
      const bv = b[key];
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
        case 'strike': r = cmp(a, b, 'call_strike'); break;
        case 'dte': r = cmp(a, b, 'call_dte'); break;
        case 'otm': r = cmp(a, b, 'otm_pct'); break;
        case 'premium': r = cmp(a, b, 'premium_received'); break;
        case 'capture': r = cmp(a, b, 'capture_pct'); break;
        case 'mode': r = (a.mode || '').localeCompare(b.mode || '') * dir; break;
        case 'stock_mv': r = cmp(a, b, 'stock_market_value'); break;
        case 'stock_pnl': r = cmp(a, b, 'stock_unrealized_pnl'); break;
        case 'row_pnl': r = cmp(a, b, 'row_total_pnl'); break;
        case 'pct_port': r = cmp(a, b, 'pctPort'); break;
        case 'ann_yield': r = cmp(a, b, 'annYield'); break;
        case 'risk': r = ((a.risk?.popPct ?? -1) - (b.risk?.popPct ?? -1)) * dir; break;
        default: r = 0;
      }
      if (r === 0) {
        // Stable tiebreak: ticker, then expiry, then strike.
        const u = (a.underlying || '').localeCompare(b.underlying || '');
        if (u !== 0) return u;
        const e = (a.call_expiration || '').localeCompare(b.call_expiration || '');
        if (e !== 0) return e;
        return (a.call_strike || 0) - (b.call_strike || 0);
      }
      return r;
    });
    return list;
  }, [enriched, sortKey, sortDir]);

  const totals = useMemo(() => {
    let stockMv = 0, stockUnreal = 0, premium = 0, currentClose = 0;
    let callUnreal = 0, day = 0;
    let dayKnown = false;
    const seenStock = new Set();
    for (const h of enriched) {
      const k = `${h.underlying}|${h.account_hash || ''}`;
      // Avoid double-counting stock MV when a holding has multiple call rows
      if (!seenStock.has(k)) {
        seenStock.add(k);
        stockMv += h.stock_market_value || 0;
        stockUnreal += h.stock_unrealized_pnl || 0;
        if (h.stock_current_day_pnl != null) { day += h.stock_current_day_pnl; dayKnown = true; }
      }
      premium += h.premium_received || 0;
      currentClose += h.close_cost || 0;
      callUnreal += h.call_unrealized_pnl || 0;
      if (h.call_current_day_pnl != null) { day += h.call_current_day_pnl; dayKnown = true; }
    }
    const capturePct = premium > 0 ? (callUnreal / premium) * 100 : null;
    const totalPnl = stockUnreal + callUnreal;
    const pctOfPort = portfolioMv > 0 ? (stockMv / portfolioMv) * 100 : null;
    return {
      setups: seenStock.size,
      legs: enriched.length,
      stockMv, stockUnreal,
      premium, currentClose, callUnreal, capturePct,
      totalPnl,
      day, dayKnown,
      pctOfPort,
    };
  }, [enriched, portfolioMv]);

  const groupRollups = useMemo(() => {
    const m = new Map();
    const seenStockPerTag = new Map(); // tagId → Set<stockKey>
    for (const h of enriched) {
      const stockKey = `${h.underlying}|${h.account_hash || ''}`;
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { setups: 0, legs: 0, stockMv: 0, premium: 0, callUnreal: 0, stockUnreal: 0 });
        if (!seenStockPerTag.has(tid)) seenStockPerTag.set(tid, new Set());
        const g = m.get(tid);
        const seen = seenStockPerTag.get(tid);
        if (!seen.has(stockKey)) {
          seen.add(stockKey);
          g.setups += 1;
          g.stockMv += h.stock_market_value || 0;
          g.stockUnreal += h.stock_unrealized_pnl || 0;
        }
        g.legs += 1;
        g.premium += h.premium_received || 0;
        g.callUnreal += h.call_unrealized_pnl || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
        totalPnl: g.stockUnreal + g.callUnreal,
        capturePct: g.premium > 0 ? (g.callUnreal / g.premium) * 100 : null,
      }))
      .sort((a, b) => b.stockMv - a.stockMv);
  }, [enriched, tagById]);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(['underlying', 'mode'].includes(key) ? 'asc' : (key === 'dte' ? 'asc' : 'desc'));
    }
  };

  const goToTicker = (underlying) => {
    if (underlying) navigate(`/schwab/transactions/${encodeURIComponent(underlying)}`);
  };

  if (isLoading) {
    return <div className="mt-4 text-sm text-gray-500">Loading covered calls…</div>;
  }
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load: {error.message}
      </div>
    );
  }

  return (
    <section className="mt-4 bg-white border border-gray-200 rounded">
      <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-end text-[11px] text-gray-500">
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Mode, signal & coverage badges</div>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat label="Setups" value={totals.setups} hint={`${totals.legs} call leg${totals.legs === 1 ? '' : 's'}`} />
        <Stat label="Stock value" value={fmtMoney(totals.stockMv)} />
        <Stat
          label="Premium open"
          value={fmtMoney(totals.premium)}
          hint="Cumulative premium received on open calls"
        />
        <Stat
          label="Captured"
          value={
            <span className={pnlClass(totals.callUnreal)}>
              {fmtMoney(totals.callUnreal, true)}
              {totals.capturePct != null && (
                <span className="ml-1 text-[11px]">({fmtPct(totals.capturePct, true)})</span>
              )}
            </span>
          }
          hint="Premium retained if all calls were closed at current marks"
        />
        <Stat
          label="Total P&L"
          value={
            <span className={pnlClass(totals.totalPnl)}>
              {fmtMoney(totals.totalPnl, true)}
            </span>
          }
          hint="Stock unrealized + calls unrealized"
        />
        <Stat
          label="Today"
          value={
            totals.dayKnown ? (
              <span className={pnlClass(totals.day)}>{fmtMoney(totals.day, true)}</span>
            ) : '—'
          }
        />
        <Stat
          label="% of portfolio"
          value={
            totals.pctOfPort != null ? (
              <span className={concentrationClass(totals.pctOfPort)}>{fmtPct(totals.pctOfPort)}</span>
            ) : '—'
          }
          hint={portfolioMv ? `of ${fmtMoney(portfolioMv)} total liquidation` : null}
        />
      </div>

      {groupRollups.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">By group</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {groupRollups.map((g) => (
              <div key={g.tag.id} className="border border-gray-200 rounded px-2 py-1.5 bg-gray-50">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: g.tag.color || '#9ca3af' }}
                  />
                  <span className="text-xs font-medium text-gray-900 truncate">{g.tag.name}</span>
                  <span className="ml-auto text-[10px] text-gray-500 tabular-nums">
                    {g.setups} / {g.legs}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 text-[11px] tabular-nums flex-wrap">
                  <span className="text-gray-700">{fmtMoney(g.stockMv)}</span>
                  <span className="text-gray-500">prem {fmtMoney(g.premium)}</span>
                  <span className={pnlClass(g.totalPnl)}>{fmtMoney(g.totalPnl, true)}</span>
                  {g.capturePct != null && (
                    <span className={pnlClass(g.capturePct)}>({fmtPct(g.capturePct, true)} cap)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active covered-call setups tagged with this strategy. A setup is
          a long stock position with at least one short call open against it,
          tagged into a Group with strategy class
          <span className="font-medium"> Covered Calls</span>.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                {/* Anchor / context */}
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Stock MV" sortKey="stock_mv" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Stock P&L" sortKey="stock_pnl" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />

                {/* Premium narrative — money in / money still on the table */}
                <SortableTh label="Premium" sortKey="premium" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Captured" sortKey="capture" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />

                {/* Combined P&L moved LEFT */}
                <SortableTh label="Total P&L" sortKey="row_pnl" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />

                {/* Yield + assignment economics */}
                <SortableTh label="Ann. yld" sortKey="ann_yield" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="text-right px-2 py-1.5 font-medium" title="Stock gain/loss locked in if assigned at strike + premium kept">If assigned</th>

                {/* Sub-strategy + risk + roll signal */}
                <SortableTh label="Mode" sortKey="mode" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-center">Risk</th>
                <th className="px-2 py-1.5 font-medium text-center">Action</th>

                {/* Strike + time signals on the right — they're actionable */}
                <SortableTh label="Strike" sortKey="strike" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="OTM" sortKey="otm" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="DTE" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="text-right px-2 py-1.5 font-medium" title="Premium remaining ÷ days remaining: forward decay rate">$/day left</th>

                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => (
                <tr
                  key={h.rowKey}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer align-top"
                  onClick={() => goToTicker(h.underlying)}
                  title={`Open ${h.underlying} transaction history`}
                >
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-gray-900">{h.underlying}</div>
                    {h.account_number && (
                      <div className="text-[10px] text-gray-500">{h.account_number}</div>
                    )}
                    <div className="text-[10px] text-gray-500">
                      {fmtShares(h.stock_shares)} sh @ {fmtMoney(h.stock_avg_cost)}
                    </div>
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
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: t?.color || '#9ca3af' }}
                            />
                            {t?.name || '—'}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-900">{fmtMoney(h.stock_market_value)}</td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.stock_unrealized_pnl)}`}>
                    {fmtMoney(h.stock_unrealized_pnl, true)}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">
                    <div>{fmtMoney(h.premium_received)}</div>
                    <div className="text-[10px] text-gray-500">left {fmtMoney(h.close_cost)}</div>
                    <div className="text-[10px] text-gray-400">{fmtInt(h.call_quantity)} contract{Math.abs(h.call_quantity) === 1 ? '' : 's'}</div>
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.call_unrealized_pnl)}`}>
                    <div>{fmtMoney(h.call_unrealized_pnl, true)}</div>
                    <div className="text-[10px]">{fmtPct(h.capture_pct, true)}</div>
                  </td>
                  <td className={`text-right px-2 py-1.5 font-medium ${pnlClass(h.row_total_pnl)}`}>
                    {fmtMoney(h.row_total_pnl, true)}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700"
                      title="Annualized premium yield on covered shares (premium / cost basis × 365/DTE)">
                    {fmtPct(h.annYield)}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnlClass(h.assignmentPnl)}`}
                      title="Stock gain/loss locked in if assigned at strike + premium kept">
                    {fmtMoney(h.assignmentPnl, true)}
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        (MODE_BADGE[h.mode] || MODE_BADGE['?']).cls
                      }`}
                    >
                      {h.mode || '?'}
                    </span>
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${h.risk.cls}`}
                      title={
                        h.risk.popPct != null
                          ? `~${Math.round(h.risk.popPct)}% probability call expires worthless (1 − |Δ|)`
                          : (h.call_delta == null
                              ? 'Approximated from strike-vs-spot %; delta not yet synced.'
                              : null)
                      }
                    >
                      {h.risk.label}
                    </span>
                  </td>
                  <td className="text-center px-2 py-1.5">
                    {h.isRollCandidate ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200"
                        title="≥75% premium captured + ≥14 DTE — classic close/roll trigger"
                      >
                        <RotateCw className="w-3 h-3" />
                        Roll
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney(h.call_strike)}</td>
                  <td className={`text-right px-2 py-1.5 ${
                    h.otm_pct != null && h.otm_pct < 0 ? 'text-red-700 font-medium' : 'text-gray-700'
                  }`}
                      title={h.otm_pct != null && h.otm_pct < 0 ? 'In the money — assignment risk' : null}>
                    {fmtPct(h.otm_pct, true)}
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(h.call_dte)}`}>
                      {h.call_dte == null ? '—' : `${h.call_dte}d`}
                    </span>
                  </td>
                  <td className="text-right px-2 py-1.5 text-gray-700"
                      title="Premium remaining ÷ days remaining: forward expected decay rate per day">
                    {h.dollarsPerDay != null ? fmtMoney(h.dollarsPerDay) : '—'}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${concentrationClass(h.pctPort)}`}>
                    {fmtPct(h.pctPort)}
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
          <span className="font-medium">Notes.</span> Stock + call legs come from Schwab live data
          (no greeks on the raw path yet — assignment risk is approximated via strike vs spot %).
          <span className="font-medium"> Mode</span> hints at sub-strategy: Income (OTM, ≤60 DTE),
          Accumulation (OTM, &gt;60 DTE), Protection (ITM), or ATM if strike is within ±2% of spot.
          <span className="font-medium"> If assigned</span> = stock gain/loss locked in at strike +
          premium received (a partial-cover ladder counts only the covered shares). Pre-window
          reconciliation means original buys are older than the tx history window.
        </div>
      </div>
    </section>
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

export default CoveredCallsPanel;
