/**
 * SingleLegPanel — Single-Leg short-premium strategy detail.
 *
 * Group-driven: each tagged transaction_position whose currently-open
 * legs are 1-2 short option legs (no longs, no stock) is one row.
 * Covers sold puts, sold calls, short straddles, short strangles.
 *
 * Headline questions for short premium:
 *   - Where's the assignment risk? (any leg ITM, low extrinsic remaining)
 *   - Worth rolling? (loose: ≤30 DTE + losing + low extrinsic)
 *   - Easy take? (≥80% captured, still time to redeploy)
 *   - What capital is tied up vs annualized return?
 *
 * Column order follows user preference: position data on the left,
 * signal badges on the right, action chip at the far right.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw, Zap, Eye,
} from 'lucide-react';
import { fetchSingleLegHoldings } from '../../../services/tags';

// Legend lives next to the chip color maps below so future chip-set
// changes hit the legend in the same patch. Only non-obvious items.
const LEGEND_BADGES = [
  { name: 'Take it', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: '≥80% of premium captured AND >7 DTE. High-confidence close before time risk creeps in.' },
  { name: 'Review', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: '≤30 DTE AND (losing OR strike breached) AND extrinsic <25% of premium. Roll candidate worth a look.' },
  { name: 'Assignment risk', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: 'A leg is ITM AND extrinsic remaining is <5% of premium. Close or roll soon — you’ll likely be assigned.' },
  { name: 'Safe / OK / At risk / Likely', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Risk badge using PoP from |Δ| (1 − |Δ| of worst leg). Falls back to OTM% bands when greeks aren’t synced.' },
];
const LEGEND_COLUMNS = [
  { name: '×N pill (underlying)', desc: 'How many open Single-Leg positions you have on this underlying. Color tiers: 1 green (safe), 2 gray (neutral), 3 amber (at your stated soft cap on strong names), 4+ red (over the cap, review).' },
  { name: 'Close cost (intr / extr)', desc: 'Cash to buy back every short leg right now, split into intrinsic vs extrinsic. Watch extrinsic — when it’s near zero on an ITM leg, you have nothing to gain by holding.' },
  { name: 'Captured', desc: 'premium received − close cost. The slice you’ve already earned by waiting.' },
  { name: '$/day θ', desc: 'Daily decay accruing to you (positive = your friend, you’re the seller). Uses synced theta when available; falls back to premium ÷ DTE-at-open.' },
  { name: 'Annual %', desc: '(premium ÷ capital) × (365 ÷ DTE-at-open). Only meaningful for cash-secured puts where capital is defined; blank for naked calls/straddles/strangles.' },
  { name: 'Max loss', desc: 'Cash-secured floor for puts (strike × 100 × contracts − premium). Shows "—" for naked calls and straddles/strangles where loss is unbounded.' },
  { name: 'BE dist', desc: 'Distance from spot to nearest breakeven (strike ± per-share premium). Negative = past breakeven on at least one side.' },
];

// Color tiers for the per-underlying count pill. Calibrated to the user's
// stated rule of thumb: ≥3 positions on one name is a soft cap on strong
// stocks; 4+ is over the line and warrants review.
const countPillStyle = (n) => {
  if (n >= 4) return 'bg-red-50 text-red-700 border-red-200';
  if (n === 3) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (n === 2) return 'bg-gray-100 text-gray-700 border-gray-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

const CONC_WARN = 10;
const CONC_DANGER = 20;
const DTE_NEAR = 7;
const DTE_SOON = 30;

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
const fmtInt = (v) => (v === null || v === undefined || isNaN(v) ? '—' : parseInt(v, 10).toLocaleString('en-US'));
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

const TYPE_BADGE = {
  'Short Put':       'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Short Call':      'bg-rose-50 text-rose-700 border-rose-200',
  'Short Straddle':  'bg-violet-50 text-violet-700 border-violet-200',
  'Short Strangle':  'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const RISK_BADGE = {
  Safe:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  OK:          'bg-sky-50 text-sky-700 border-sky-200',
  'At risk':   'bg-amber-50 text-amber-700 border-amber-200',
  Likely:      'bg-red-50 text-red-700 border-red-200',
  Breached:    'bg-red-50 text-red-700 border-red-200',
  '?':         'bg-gray-50 text-gray-500 border-gray-200',
};

const ACTION_BADGE = {
  'Take it':            { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Zap },
  'Review':             { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: Eye },
  'Assignment risk':    { cls: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
  'Hold':               { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: null },
};

const RECON_BADGE = {
  live:     { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Live' },
  mismatch: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Mismatch' },
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

const SingleLegPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState('action');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['single-leg-holdings'],
    queryFn: fetchSingleLegHoldings,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['single-leg-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const portfolioMv = data?.portfolio_liquidation_value || 0;

  // Count open Single-Leg rows per underlying. Broadcast back to each row
  // so the user can scan exposure pressure on a single name (their stated
  // soft cap is 3 on strong stocks; 4+ wants review).
  const countByUnderlying = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      const u = (h.underlying || '').toUpperCase();
      if (!u) continue;
      m.set(u, (m.get(u) || 0) + 1);
    }
    return m;
  }, [holdings]);

  // Underlyings at or over the soft cap — surfaced as a top-of-panel
  // callout when any exist, so the user gets the warning without scrolling.
  const atCapUnderlyings = useMemo(() => {
    const out = [];
    for (const [u, n] of countByUnderlying.entries()) {
      if (n >= 3) out.push({ underlying: u, count: n });
    }
    out.sort((a, b) => b.count - a.count || a.underlying.localeCompare(b.underlying));
    return out;
  }, [countByUnderlying]);

  const enriched = useMemo(() => {
    return holdings.map((h) => ({
      ...h,
      // For % portfolio, prefer capital_at_risk (defined for SP) and fall
      // back to premium_received as a "skin in the game" proxy when capital
      // isn't computable (naked calls, straddles, strangles).
      pctPort: portfolioMv > 0
        ? ((h.capital_at_risk || h.premium_received || 0) / portfolioMv) * 100
        : null,
      underlyingCount: countByUnderlying.get((h.underlying || '').toUpperCase()) || 1,
    }));
  }, [holdings, portfolioMv, countByUnderlying]);

  const sorted = useMemo(() => {
    const list = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    const ACTION_PRIORITY = { 'Assignment risk': 5, 'Review': 4, 'Take it': 3, 'Hold': 1 };
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
        case 'premium': r = cmp(a, b, 'premium_received'); break;
        case 'close_cost': r = cmp(a, b, 'close_cost'); break;
        case 'capture': r = cmp(a, b, 'capture_pct'); break;
        case 'unreal': r = cmp(a, b, 'unrealized_pnl'); break;
        case 'dte': r = cmp(a, b, 'dte'); break;
        case 'otm': r = cmp(a, b, 'worst_otm_pct'); break;
        case 'be': r = cmp(a, b, 'distance_from_be_pct'); break;
        case 'max_loss': r = cmp(a, b, 'max_loss'); break;
        case 'annual': r = cmp(a, b, 'annualized_return_pct'); break;
        case 'theta': r = cmp(a, b, 'dollars_per_day'); break;
        case 'risk': r = cmp(a, b, 'risk_pop_pct'); break;
        case 'action': r = ((ACTION_PRIORITY[a.action] || 0) - (ACTION_PRIORITY[b.action] || 0)) * dir; break;
        case 'pct_port': r = cmp(a, b, 'pctPort'); break;
        default: r = 0;
      }
      if (r === 0) {
        const u = (a.underlying || '').localeCompare(b.underlying || '');
        if (u !== 0) return u;
        return (a.dte ?? 0) - (b.dte ?? 0);
      }
      return r;
    });
    return list;
  }, [enriched, sortKey, sortDir]);

  const totals = useMemo(() => {
    let count = 0, premium = 0, closeCost = 0, captured = 0, unreal = 0;
    let day = 0, dayKnown = false;
    let capital = 0;
    let actionCounts = { 'Assignment risk': 0, 'Review': 0, 'Take it': 0, 'Hold': 0 };
    let typeCounts = { 'Short Put': 0, 'Short Call': 0, 'Short Straddle': 0, 'Short Strangle': 0 };
    for (const h of enriched) {
      count += 1;
      premium += h.premium_received || 0;
      closeCost += h.close_cost || 0;
      captured += h.unrealized_pnl || 0;
      unreal += h.unrealized_pnl || 0;
      capital += h.capital_at_risk || 0;
      if (h.day_pnl != null) { day += h.day_pnl; dayKnown = true; }
      if (actionCounts[h.action] != null) actionCounts[h.action] += 1;
      if (typeCounts[h.type] != null) typeCounts[h.type] += 1;
    }
    const capturePct = premium > 0 ? (captured / premium) * 100 : null;
    const pctPort = portfolioMv > 0 && (capital + 0) > 0 ? (capital / portfolioMv) * 100 : null;
    return {
      count, premium, closeCost, captured, capturePct, unreal,
      day, dayKnown, capital, pctPort, actionCounts, typeCounts,
    };
  }, [enriched, portfolioMv]);

  const groupRollups = useMemo(() => {
    const m = new Map();
    for (const h of enriched) {
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { count: 0, premium: 0, captured: 0, capital: 0 });
        const g = m.get(tid);
        g.count += 1;
        g.premium += h.premium_received || 0;
        g.captured += h.unrealized_pnl || 0;
        g.capital += h.capital_at_risk || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
        capturePct: g.premium > 0 ? (g.captured / g.premium) * 100 : null,
      }))
      .sort((a, b) => b.premium - a.premium);
  }, [enriched, tagById]);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'underlying' || key === 'type' || key === 'dte' ? 'asc' : 'desc');
    }
  };

  const goToTicker = (underlying) => {
    if (underlying) navigate(`/schwab/transactions/${encodeURIComponent(underlying)}`);
  };

  if (isLoading) return <div className="mt-4 text-sm text-gray-500">Loading single-leg positions…</div>;
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load: {error.message}
      </div>
    );
  }

  const actionableCount =
    (totals.actionCounts['Assignment risk'] || 0) +
    (totals.actionCounts['Review'] || 0) +
    (totals.actionCounts['Take it'] || 0);

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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Action & risk badges</div>
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
        <Stat
          label="Open"
          value={totals.count}
          hint={
            `${totals.typeCounts['Short Put']} put · ${totals.typeCounts['Short Call']} call · ` +
            `${totals.typeCounts['Short Straddle']} straddle · ${totals.typeCounts['Short Strangle']} strangle`
          }
        />
        <Stat
          label="Premium received"
          value={<span className="text-emerald-700">{fmtMoney(totals.premium)}</span>}
          hint="Σ credit collected at open across all live rows"
        />
        <Stat
          label="Close cost"
          value={<span className="text-gray-700">{fmtMoney(totals.closeCost)}</span>}
          hint="Σ cost to buy back every short leg right now"
        />
        <Stat
          label="Captured"
          value={
            <span className={pnlClass(totals.captured)}>
              {fmtMoney(totals.captured, true)}
              {totals.capturePct != null && (
                <span className="ml-1 text-[11px]">({fmtPct(totals.capturePct, true)})</span>
              )}
            </span>
          }
          hint="premium_received − close_cost (positive = winning)"
        />
        <Stat
          label="Total P&L"
          value={<span className={pnlClass(totals.unreal)}>{fmtMoney(totals.unreal, true)}</span>}
        />
        <Stat
          label="Today"
          value={totals.dayKnown ? <span className={pnlClass(totals.day)}>{fmtMoney(totals.day, true)}</span> : '—'}
        />
        <Stat
          label="Needs review"
          value={
            actionableCount > 0
              ? <span className="text-amber-700">{actionableCount}</span>
              : <span className="text-gray-700">0</span>
          }
          hint={
            `${totals.actionCounts['Assignment risk']} assignment risk · ` +
            `${totals.actionCounts['Review']} review · ` +
            `${totals.actionCounts['Take it']} take-it`
          }
        />
      </div>

      {atCapUnderlyings.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 bg-amber-50/40">
          <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-1">
            Underlyings at or over your soft cap
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {atCapUnderlyings.map((u) => (
              <span
                key={u.underlying}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${countPillStyle(u.count)}`}
                title={`${u.count} open Single-Leg position${u.count === 1 ? '' : 's'} on ${u.underlying}`}
              >
                <span className="font-medium">{u.underlying}</span>
                <span className="tabular-nums">×{u.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

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
                  <span className="text-emerald-700">prem {fmtMoney(g.premium)}</span>
                  <span className={pnlClass(g.captured)}>cap {fmtMoney(g.captured, true)}</span>
                  {g.capturePct != null && (
                    <span className={pnlClass(g.capturePct)}>({fmtPct(g.capturePct, true)})</span>
                  )}
                  {g.capital > 0 && (
                    <span className="text-gray-700">cap@risk {fmtMoney(g.capital)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active short-premium positions tagged with this strategy. A
          single-leg position is 1-2 short option legs (no longs, no
          stock), classified into a Group with strategy class
          <span className="font-medium"> Single-leg</span>. Covers sold
          puts, sold calls, short straddles, short strangles.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                {/* ----- POSITION DATA (left) ----- */}
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Type" sortKey="type" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-left">Strikes</th>
                <th className="px-2 py-1.5 font-medium text-right">Spot</th>
                <SortableTh label="Premium" sortKey="premium" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Credit received at open" />
                <SortableTh
                  label="Close cost"
                  sortKey="close_cost"
                  currentKey={sortKey} currentDir={sortDir} onSort={onSort}
                  align="right"
                  title="Cash to buy back all shorts now (intrinsic + extrinsic split shown below)"
                />
                {/* ----- P&L DATA ----- */}
                <SortableTh label="Captured" sortKey="capture" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="premium − close cost" />
                <SortableTh label="Total P&L" sortKey="unreal" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                {/* ----- RISK METRICS ----- */}
                <SortableTh label="DTE" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="$/day θ" sortKey="theta" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Daily decay accruing to seller (real theta if synced, else premium ÷ DTE-at-open)" />
                <SortableTh label="OTM%" sortKey="otm" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Worst leg's distance from strike (negative = breached)" />
                <SortableTh label="BE dist" sortKey="be" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Distance from spot to nearest breakeven" />
                <SortableTh label="Max loss" sortKey="max_loss" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Cash-secured floor for puts; undefined for naked calls / straddles / strangles" />
                <SortableTh label="Annual %" sortKey="annual" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="(premium ÷ capital) × (365 ÷ DTE-at-open). Cash-secured puts only." />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="capital@risk ÷ portfolio liquidation" />
                {/* ----- SIGNALS (right) ----- */}
                <SortableTh label="Risk" sortKey="risk" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                {/* ----- ACTION (far right) ----- */}
                <SortableTh label="Action" sortKey="action" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const action = ACTION_BADGE[h.action] || ACTION_BADGE.Hold;
                const ActionIcon = action.icon;
                const closeCostExtr = h.extrinsic_remaining;
                const closeCostIntr = h.intrinsic_remaining;
                return (
                  <tr
                    key={h.chain_id}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer align-top"
                    onClick={() => goToTicker(h.underlying)}
                    title={`Open ${h.underlying} transaction history`}
                  >
                    {/* Position */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-gray-900">{h.underlying}</span>
                        {h.underlyingCount > 0 && (
                          <span
                            className={`inline-flex items-center px-1 py-0 rounded border text-[10px] tabular-nums ${countPillStyle(h.underlyingCount)}`}
                            title={
                              h.underlyingCount === 1
                                ? `Only Single-Leg position on ${h.underlying}`
                                : `${h.underlyingCount} open Single-Leg positions on ${h.underlying}` +
                                  (h.underlyingCount >= 4 ? ' — over your soft cap' :
                                   h.underlyingCount === 3 ? ' — at your soft cap' : '')
                            }
                          >
                            ×{h.underlyingCount}
                          </span>
                        )}
                      </div>
                      {h.expiration && (
                        <div className="text-[10px] text-gray-500">{h.expiration}</div>
                      )}
                      {h.chain_name && (
                        <div className="text-[10px] text-gray-400 truncate max-w-[180px]">{h.chain_name}</div>
                      )}
                    </td>
                    {/* Groups */}
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
                    {/* Type */}
                    <td className="text-center px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[h.type] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {h.type}
                      </span>
                    </td>
                    {/* Strikes */}
                    <td className="px-2 py-1.5 text-gray-700">
                      {h.strikes_label}
                      <div className="text-[10px] text-gray-500">{fmtInt(h.contracts)}× contracts</div>
                    </td>
                    {/* Spot */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {h.spot ? fmtMoney(h.spot) : '—'}
                    </td>
                    {/* Premium */}
                    <td className="text-right px-2 py-1.5 text-emerald-700">
                      {fmtMoney(h.premium_received)}
                    </td>
                    {/* Close cost (with intrinsic + extrinsic split) */}
                    <td
                      className="text-right px-2 py-1.5 text-gray-700"
                      title={
                        `Total: ${fmtMoney(h.close_cost)}\n` +
                        `Intrinsic: ${fmtMoney(closeCostIntr)}\n` +
                        `Extrinsic: ${fmtMoney(closeCostExtr)}` +
                        (h.extrinsic_pct_of_premium != null
                          ? ` (${fmtPct(h.extrinsic_pct_of_premium)} of premium)`
                          : '')
                      }
                    >
                      <div>{fmtMoney(h.close_cost)}</div>
                      <div className="text-[10px] text-gray-500">
                        intr {fmtMoney(closeCostIntr)} · extr {fmtMoney(closeCostExtr)}
                      </div>
                    </td>
                    {/* Captured */}
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.unrealized_pnl)}`}>
                      <div>{fmtMoney(h.unrealized_pnl, true)}</div>
                      <div className="text-[10px]">{fmtPct(h.capture_pct, true)}</div>
                    </td>
                    {/* Total P&L */}
                    <td className={`text-right px-2 py-1.5 font-medium ${pnlClass(h.row_total_pnl)}`}>
                      {fmtMoney(h.row_total_pnl, true)}
                    </td>
                    {/* DTE */}
                    <td className="text-right px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(h.dte)}`}>
                        {h.dte == null ? '—' : `${h.dte}d`}
                      </span>
                    </td>
                    {/* $/day theta */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {h.dollars_per_day != null ? fmtMoney(h.dollars_per_day) : '—'}
                    </td>
                    {/* OTM% (worst leg) */}
                    <td
                      className={`text-right px-2 py-1.5 ${
                        h.worst_otm_pct != null && h.worst_otm_pct < 0 ? 'text-red-700 font-medium' : 'text-gray-700'
                      }`}
                      title={
                        h.worst_otm_pct != null && h.worst_otm_pct < 0
                          ? 'Worst-leg strike has been crossed — assignment risk'
                          : 'Worst-leg distance from spot to strike'
                      }
                    >
                      {fmtPct(h.worst_otm_pct, true)}
                    </td>
                    {/* BE distance */}
                    <td
                      className={`text-right px-2 py-1.5 ${
                        h.distance_from_be_pct != null && h.distance_from_be_pct < 0 ? 'text-red-700 font-medium' : 'text-gray-700'
                      }`}
                      title="Distance from spot to nearest breakeven (strike ± per-share premium)"
                    >
                      {fmtPct(h.distance_from_be_pct, true)}
                    </td>
                    {/* Max loss */}
                    <td className="text-right px-2 py-1.5 text-red-700">
                      {h.max_loss != null ? fmtMoney(h.max_loss) : <span className="text-gray-400" title="Undefined: naked call / straddle / strangle">—</span>}
                    </td>
                    {/* Annualized return */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {h.annualized_return_pct != null ? fmtPct(h.annualized_return_pct) : '—'}
                    </td>
                    {/* % port */}
                    <td className={`text-right px-2 py-1.5 ${concentrationClass(h.pctPort)}`}>
                      {fmtPct(h.pctPort)}
                    </td>
                    {/* Risk badge (signal) */}
                    <td className="text-center px-2 py-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_BADGE[h.risk_label] || RISK_BADGE['?']}`}
                        title={
                          h.risk_pop_pct != null
                            ? `~${Math.round(h.risk_pop_pct)}% probability worst-leg expires worthless (1 − |Δ|)`
                            : 'Approximated from worst-leg OTM%; greeks not yet synced.'
                        }
                      >
                        {h.risk_label}
                      </span>
                    </td>
                    {/* Live recon (signal) */}
                    <td className="text-center px-2 py-1.5">
                      <ReconBadge recon={h.reconciliation} />
                    </td>
                    {/* Action chip (far right) */}
                    <td className="text-center px-2 py-1.5">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${action.cls}`}
                        title={
                          h.action === 'Assignment risk' ? 'Worst leg ITM and extrinsic < 5% of premium — close or roll'
                            : h.action === 'Review' ? '≤30 DTE, losing or breached, and extrinsic < 25% of premium — consider rolling'
                            : h.action === 'Take it' ? '≥80% captured with time still on the clock — bank it'
                            : 'No close trigger active'
                        }
                      >
                        {ActionIcon && <ActionIcon className="w-3 h-3" />}
                        {h.action}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      <ChevronRight className="w-3.5 h-3.5 inline" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Single-leg short premium covers sold puts,
          sold calls, short straddles, short strangles. <span className="font-medium">Action</span>{' '}
          fires on rolling-style triggers: Assignment risk = leg ITM with &lt;5% extrinsic; Review =
          ≤30 DTE, losing or breached, extrinsic &lt;25% of premium; Take it = ≥80% captured with time
          left. <span className="font-medium">Close cost</span> shows the intrinsic + extrinsic split
          so you can spot positions that have decayed to mostly intrinsic — those are the roll
          candidates. <span className="font-medium">$/day θ</span> uses real synced theta when
          present and falls back to premium ÷ DTE-at-open. <span className="font-medium">Annual %</span>{' '}
          and <span className="font-medium">Max loss</span> are only meaningful for cash-secured
          puts; naked calls / straddles / strangles show "—" because their loss is unbounded.
          {(data?.excluded_complex_count > 0) && (
            <> <span className="font-medium">Excluded:</span> {data.excluded_complex_count} tagged
            chain{data.excluded_complex_count === 1 ? '' : 's'} that don't fit the single-leg shape
            (long premium, mixed long/short, 3+ legs, or stock-bearing) — those will get their own
            strategy area.</>
          )}
        </div>
      </div>
    </section>
  );
};

export default SingleLegPanel;
