/**
 * BigOptionsPanel — Big Options (long-premium, lottery-style) detail.
 *
 * Group-driven: 1+ long option legs, no shorts, no stock. Long calls,
 * long puts, long straddles, long strangles, long_multi.
 *
 * Designed as informational, not prescriptive. The user has explicitly
 * said take-partial / take-all / cut decisions are contextual judgment
 * calls. So we surface state (Sweet spot / Decay zone / Theta cliff,
 * catalyst proximity, trim history, big winners, over-sized warnings)
 * and let the user make the trade.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw, Calendar, TrendingUp, Scissors,
} from 'lucide-react';
import { fetchBigOptionsHoldings } from '../../../services/tags';

// Legend content. Lives next to the chip/badge color maps below so a
// future edit to the chip set hits the legend in the same patch.
// Skips obvious things (Underlying, Strikes, Spot, DTE, P&L, etc.) and
// only explains the non-obvious computed columns and signal pills.
const LEGEND_BADGES = [
  { name: 'Sweet spot', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: '30–75 DTE AND a leg within ±5% of ATM. Your stated leveraged window.' },
  { name: 'Patient', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: '>75 DTE. Plenty of time for the thesis to develop.' },
  { name: 'Decay zone', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: '14–30 DTE (or 30–75 outside the ATM band). Theta starting to bite.' },
  { name: 'Theta cliff', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: '≤14 DTE AND any leg OTM AND not winning. Get out or accept goose-egg.' },
  { name: 'Catalyst pill', cls: 'bg-blue-50 text-blue-700 border-blue-200',
    desc: 'Earnings (auto from Yahoo) or manual catalyst date inside the row’s expiration window.' },
  { name: 'Over (size)', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Capital deployed exceeds soft cap (lower of $5k or 1% of portfolio).' },
  { name: '2× (size)', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: 'Capital deployed is 2× the soft cap. Way over your stated comfort zone.' },
  { name: 'Trimmed −X%', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Some contracts have already been closed. The slice still open is shown alongside the original count.' },
];
const LEGEND_COLUMNS = [
  { name: 'Multiple', desc: 'Total return × original capital. A 50%-trimmed-at-2× position with the rest holding flat reads ~1.5×. Colored ≥2× bold green, ≥1× green, ≥0.5× amber, <0.5× red.' },
  { name: 'TP left', desc: 'Time premium remaining on the open slice. This is the chunk that evaporates if held to expiry — separate from intrinsic value.' },
  { name: 'θ /day', desc: 'Daily decay (negative for long premium). Uses synced theta when available; falls back to TP left ÷ DTE when greeks haven’t been refreshed.' },
  { name: 'ATM dist', desc: 'Distance from spot to the closest leg’s strike (always positive). Smaller = more leveraged. Distinct from OTM% which is signed for direction.' },
  { name: 'Hit rate (KPI)', desc: 'Across closed Big Options chains: winners ÷ (winners + losers). A win is any chain with positive realized P&L when fully exited.' },
  { name: 'Locked (P&L sub-line)', desc: 'Realized portion of total P&L from prior trims. Shown when a row has been partially closed.' },
];

const DTE_NEAR = 14;
const DTE_SOON = 30;

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
const fmtPct = (v, signed = false, decimals = 1) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v).toFixed(decimals);
  if (signed) return `${v >= 0 ? '+' : '−'}${abs}%`;
  return `${v < 0 ? '−' : ''}${abs}%`;
};
const fmtMultiple = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return `${v.toFixed(2)}×`;
};
const fmtInt = (v) => (v === null || v === undefined || isNaN(v) ? '—' : parseInt(v, 10).toLocaleString('en-US'));
const pnlClass = (n) => {
  if (n === null || n === undefined || isNaN(n)) return 'text-gray-500';
  return n >= 0 ? 'text-emerald-700' : 'text-red-700';
};
const multipleClass = (m) => {
  if (m === null || m === undefined || isNaN(m)) return 'text-gray-500';
  if (m >= 2) return 'text-emerald-700 font-bold';
  if (m >= 1) return 'text-emerald-700';
  if (m >= 0.5) return 'text-amber-700';
  return 'text-red-700';
};
const dteStyle = (dte) => {
  if (dte == null) return 'bg-gray-100 text-gray-500 border-gray-200';
  if (dte < 0) return 'bg-gray-50 text-gray-400 border-gray-200';
  if (dte <= DTE_NEAR) return 'bg-red-50 text-red-700 border-red-200';
  if (dte <= DTE_SOON) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
};

const TYPE_BADGE = {
  'Long Call':     'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Long Put':      'bg-rose-50 text-rose-700 border-rose-200',
  'Long Straddle': 'bg-violet-50 text-violet-700 border-violet-200',
  'Long Strangle': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Long Multi':    'bg-sky-50 text-sky-700 border-sky-200',
};

const STATUS_BADGE = {
  'Sweet spot':  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Patient':     'bg-sky-50 text-sky-700 border-sky-200',
  'Decay zone':  'bg-amber-50 text-amber-700 border-amber-200',
  'Theta cliff': 'bg-red-50 text-red-700 border-red-200',
  '?':           'bg-gray-50 text-gray-500 border-gray-200',
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

const daysFromIso = (iso) => {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return Math.round((t.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const BigOptionsPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState('multiple');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['big-options-holdings'],
    queryFn: fetchBigOptionsHoldings,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['big-options-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const stats = data?.stats || {};
  const thresholds = data?.concentration_thresholds || {};

  const sorted = useMemo(() => {
    const list = [...holdings];
    const dir = sortDir === 'asc' ? 1 : -1;
    const STATUS_PRIORITY = { 'Theta cliff': 5, 'Sweet spot': 4, 'Decay zone': 3, 'Patient': 2, '?': 1 };
    const OVERSIZED_PRIORITY = { hard: 3, soft: 2 };
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
        case 'cost': r = cmp(a, b, 'cost_paid'); break;
        case 'value': r = cmp(a, b, 'current_value'); break;
        case 'multiple': r = cmp(a, b, 'multiple'); break;
        case 'pnl': r = cmp(a, b, 'row_total_pnl'); break;
        case 'dte': r = cmp(a, b, 'min_dte'); break;
        case 'theta': r = cmp(a, b, 'theta_per_day'); break;
        case 'atm': r = cmp(a, b, 'min_atm_dist_pct'); break;
        case 'days_held': r = cmp(a, b, 'days_held'); break;
        case 'pct_port': r = cmp(a, b, 'pct_port'); break;
        case 'oversized': r = ((OVERSIZED_PRIORITY[a.oversized] || 0) - (OVERSIZED_PRIORITY[b.oversized] || 0)) * dir; break;
        case 'status': r = ((STATUS_PRIORITY[a.status] || 0) - (STATUS_PRIORITY[b.status] || 0)) * dir; break;
        default: r = 0;
      }
      if (r === 0) {
        const u = (a.underlying || '').localeCompare(b.underlying || '');
        if (u !== 0) return u;
        return (a.min_dte ?? 0) - (b.min_dte ?? 0);
      }
      return r;
    });
    return list;
  }, [holdings, sortKey, sortDir]);

  const totals = useMemo(() => {
    let cost = 0, value = 0, pnl = 0;
    let oversizedSoft = 0, oversizedHard = 0;
    let bigWinners = 0;  // multiple >= 2x
    let inSweetSpot = 0, inThetaCliff = 0;
    for (const h of holdings) {
      cost += h.cost_paid || 0;
      value += h.current_value || 0;
      pnl += h.row_total_pnl || 0;
      if (h.oversized === 'soft') oversizedSoft += 1;
      if (h.oversized === 'hard') oversizedHard += 1;
      if ((h.multiple || 0) >= 2) bigWinners += 1;
      if (h.status === 'Sweet spot') inSweetSpot += 1;
      if (h.status === 'Theta cliff') inThetaCliff += 1;
    }
    const overallMultiple = cost > 0 ? (cost + pnl) / cost : null;
    return {
      count: holdings.length, cost, value, pnl, overallMultiple,
      oversizedSoft, oversizedHard, bigWinners, inSweetSpot, inThetaCliff,
    };
  }, [holdings]);

  // Concentration ribbon: top 3 underlyings by cost paid in Big Options.
  const topUnderlyings = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      const u = h.underlying;
      if (!u) continue;
      if (!m.has(u)) m.set(u, { cost: 0, value: 0, pnl: 0, positions: 0 });
      const e = m.get(u);
      e.cost += h.cost_paid || 0;
      e.value += h.current_value || 0;
      e.pnl += h.row_total_pnl || 0;
      e.positions += 1;
    }
    return Array.from(m.entries())
      .map(([underlying, e]) => ({ underlying, ...e }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3);
  }, [holdings]);

  // Upcoming catalysts inside Big Options window. Dedup by (symbol, date).
  const upcomingCatalysts = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of holdings) {
      if (!h.catalyst || !h.catalyst.date || !h.underlying) continue;
      const key = `${h.underlying}|${h.catalyst.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        underlying: h.underlying,
        date: h.catalyst.date,
        label: h.catalyst.label,
        source: h.catalyst.source,
        days: daysFromIso(h.catalyst.date),
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [holdings]);

  const groupRollups = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { count: 0, cost: 0, value: 0, pnl: 0 });
        const g = m.get(tid);
        g.count += 1;
        g.cost += h.cost_paid || 0;
        g.value += h.current_value || 0;
        g.pnl += h.row_total_pnl || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
        multiple: g.cost > 0 ? (g.cost + g.pnl) / g.cost : null,
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [holdings, tagById]);

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

  if (isLoading) return <div className="mt-4 text-sm text-gray-500">Loading Big Options…</div>;
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Status & signals</div>
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat
          label="Open"
          value={totals.count}
          hint={`${totals.bigWinners} at ≥2× · ${totals.inSweetSpot} sweet spot · ${totals.inThetaCliff} theta cliff`}
        />
        <Stat
          label="Capital deployed"
          value={fmtMoney0(totals.cost)}
          hint={`Target $${thresholds.target_usd?.toLocaleString() || 2000}/pos · soft cap $${thresholds.soft_cap_usd?.toLocaleString() || 5000} or ${thresholds.soft_cap_port_pct || 1}% port`}
        />
        <Stat
          label="Current value"
          value={<span className={pnlClass(totals.value - totals.cost)}>{fmtMoney0(totals.value)}</span>}
        />
        <Stat
          label="Multiple"
          value={
            totals.overallMultiple != null
              ? <span className={multipleClass(totals.overallMultiple)}>{fmtMultiple(totals.overallMultiple)}</span>
              : '—'
          }
          hint="Total return × original capital across all open Big Options rows"
        />
        <Stat
          label="P&L (open)"
          value={<span className={pnlClass(totals.pnl)}>{fmtMoney0(totals.pnl, true)}</span>}
        />
        <Stat
          label="Hit rate"
          value={
            stats.hit_rate_pct != null
              ? <span>
                  {fmtPct(stats.hit_rate_pct)}
                  <span className="ml-1 text-[11px] text-gray-500">({stats.winners}W/{stats.losers}L)</span>
                </span>
              : '—'
          }
          hint={`Avg win ${fmtMoney0(stats.avg_win, true)} · avg loss ${fmtMoney0(stats.avg_loss, true)} · realized ${fmtMoney0(stats.total_realized, true)} over ${stats.closed_count || 0} closed`}
        />
        <Stat
          label="Over-sized"
          value={
            (totals.oversizedHard || totals.oversizedSoft)
              ? <span className={totals.oversizedHard ? 'text-red-700' : 'text-amber-700'}>
                  {totals.oversizedHard + totals.oversizedSoft}
                </span>
              : <span className="text-gray-700">0</span>
          }
          hint={`${totals.oversizedHard} hard · ${totals.oversizedSoft} soft`}
        />
      </div>

      {/* Top-3 concentration ribbon */}
      {topUnderlyings.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Top tickers by capital</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {topUnderlyings.map((u) => {
              const m = u.cost > 0 ? (u.cost + u.pnl) / u.cost : null;
              return (
                <div key={u.underlying} className="border border-gray-200 rounded px-2 py-1.5 bg-gray-50">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-medium text-gray-900">{u.underlying}</span>
                    <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{u.positions} pos</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-[11px] tabular-nums flex-wrap">
                    <span className="text-gray-700">cost {fmtMoney0(u.cost)}</span>
                    <span className={pnlClass(u.pnl)}>{fmtMoney0(u.pnl, true)}</span>
                    {m != null && (
                      <span className={multipleClass(m)}>{fmtMultiple(m)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming catalysts */}
      {upcomingCatalysts.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 bg-amber-50/40">
          <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-1 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Upcoming catalysts inside Big Options windows
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {upcomingCatalysts.map((c) => (
              <div key={`${c.underlying}|${c.date}`} className="border border-amber-200 rounded px-1.5 py-0.5 bg-white">
                <span className="font-medium text-amber-800">{c.underlying}</span>
                <span className="text-gray-600 ml-1.5">{c.label}</span>
                <span className="text-gray-500 ml-1.5">{c.date}</span>
                {c.days != null && c.days >= 0 && (
                  <span className="text-amber-700 ml-1.5">
                    ({c.days === 0 ? 'today' : `${c.days}d`})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <span className="text-gray-700">cost {fmtMoney0(g.cost)}</span>
                  <span className={pnlClass(g.pnl)}>{fmtMoney0(g.pnl, true)}</span>
                  {g.multiple != null && (
                    <span className={multipleClass(g.multiple)}>{fmtMultiple(g.multiple)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main table */}
      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active Big Options positions tagged with this strategy.
          A Big Options position is 1+ long option legs (no shorts, no
          stock), classified into a Group with strategy class
          <span className="font-medium"> Big Options</span>.
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
                <SortableTh label="DTE" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="px-2 py-1.5 font-medium text-right" title="Original / current contracts">Contr.</th>
                {/* ----- P&L DATA ----- */}
                <SortableTh label="Cost" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Original debit paid" />
                <SortableTh label="Value" sortKey="value" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Multiple" sortKey="multiple" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Total return × original capital" />
                <SortableTh label="Total P&L" sortKey="pnl" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                {/* ----- RISK METRICS ----- */}
                <SortableTh label="ATM dist" sortKey="atm" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Closest leg's distance to ATM (smaller = more leveraged)" />
                <th className="px-2 py-1.5 font-medium text-right" title="Time premium remaining — what evaporates on a hold to expiry">TP left</th>
                <SortableTh label="θ /day" sortKey="theta" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" title="Daily decay (real theta when greeks synced; fallback = TP left ÷ DTE)" />
                <SortableTh label="Days held" sortKey="days_held" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                {/* ----- SIGNALS (right) ----- */}
                <SortableTh label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <SortableTh label="Size" sortKey="oversized" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" title="Concentration warning" />
                <th className="px-2 py-1.5 font-medium text-center">Tags</th>
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const isOversizedHard = h.oversized === 'hard';
                const isOversizedSoft = h.oversized === 'soft';
                const isBigWinner = (h.multiple || 0) >= 2;
                const trimmed = (h.trimmed_pct || 0) > 0.5;
                const catDays = h.catalyst?.date ? daysFromIso(h.catalyst.date) : null;
                return (
                  <tr
                    key={h.chain_id}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer align-top"
                    onClick={() => goToTicker(h.underlying)}
                    title={`Open ${h.underlying} transaction history`}
                  >
                    {/* Position */}
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-900">{h.underlying}</div>
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
                    <td className="px-2 py-1.5 text-gray-700">{h.strikes_label}</td>
                    {/* Spot */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {h.spot ? fmtMoney(h.spot) : '—'}
                    </td>
                    {/* DTE */}
                    <td className="text-right px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(h.min_dte)}`}>
                        {h.min_dte == null ? '—' : `${h.min_dte}d`}
                      </span>
                    </td>
                    {/* Contracts (original / current) */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {trimmed ? (
                        <div>
                          <div>{fmtInt(h.contracts)} / {fmtInt(h.original_contracts)}</div>
                          <div className="text-[10px] text-amber-700 inline-flex items-center gap-0.5">
                            <Scissors className="w-2.5 h-2.5" />
                            −{(h.trimmed_pct || 0).toFixed(0)}%
                          </div>
                        </div>
                      ) : (
                        fmtInt(h.contracts)
                      )}
                    </td>
                    {/* Cost */}
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney0(h.cost_paid)}</td>
                    {/* Current value */}
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney0(h.current_value)}</td>
                    {/* Multiple */}
                    <td className={`text-right px-2 py-1.5 ${multipleClass(h.multiple)}`}>
                      {fmtMultiple(h.multiple)}
                      {isBigWinner && (
                        <TrendingUp className="w-3 h-3 inline ml-0.5" />
                      )}
                    </td>
                    {/* Total P&L */}
                    <td className={`text-right px-2 py-1.5 font-medium ${pnlClass(h.row_total_pnl)}`}>
                      {fmtMoney0(h.row_total_pnl, true)}
                      {h.partials_realized != null && Math.abs(h.partials_realized) > 1 && (
                        <div className="text-[10px] text-gray-500">
                          locked {fmtMoney0(h.partials_realized, true)}
                        </div>
                      )}
                    </td>
                    {/* ATM dist */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {fmtPct(h.min_atm_dist_pct)}
                    </td>
                    {/* Time premium left */}
                    <td className="text-right px-2 py-1.5 text-amber-700" title="Time premium remaining — evaporates if held to expiry">
                      {fmtMoney0(h.time_premium_left)}
                    </td>
                    {/* θ/day */}
                    <td className="text-right px-2 py-1.5 text-red-700" title={h.theta_next_7d != null ? `Next 7d: ~${fmtMoney0(h.theta_next_7d)}` : null}>
                      {h.theta_per_day != null ? fmtMoney0(h.theta_per_day) : '—'}
                    </td>
                    {/* Days held */}
                    <td className="text-right px-2 py-1.5 text-gray-700">
                      {h.days_held != null ? `${h.days_held}d` : '—'}
                    </td>
                    {/* % port */}
                    <td className={`text-right px-2 py-1.5 ${
                      isOversizedHard ? 'text-red-700 font-semibold'
                      : isOversizedSoft ? 'text-amber-700 font-medium'
                      : 'text-gray-700'
                    }`}>
                      {fmtPct(h.pct_port)}
                    </td>
                    {/* Status (signal) */}
                    <td className="text-center px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_BADGE[h.status] || STATUS_BADGE['?']}`}>
                        {h.status}
                      </span>
                    </td>
                    {/* Over-sized + Catalyst (signal) */}
                    <td className="text-center px-2 py-1.5">
                      <div className="flex flex-col items-center gap-0.5">
                        {(isOversizedHard || isOversizedSoft) && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${
                              isOversizedHard
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                            title={
                              isOversizedHard
                                ? 'Capital deployed is 2× the soft cap. Way over your stated comfort zone.'
                                : `Capital deployed exceeds the soft cap ($${(thresholds.soft_cap_usd || 5000).toLocaleString()} or ${thresholds.soft_cap_port_pct || 1}% of portfolio).`
                            }
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {isOversizedHard ? '2×' : 'Over'}
                          </span>
                        )}
                        {h.catalyst && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 inline-flex items-center gap-0.5"
                            title={`${h.catalyst.label} on ${h.catalyst.date}`}
                          >
                            <Calendar className="w-3 h-3" />
                            {catDays != null && catDays >= 0
                              ? (catDays === 0 ? 'today' : `${catDays}d`)
                              : h.catalyst.date.slice(5)}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Tags column placeholder */}
                    <td className="text-center px-2 py-1.5">
                      {/* Future: per-row note quick-edit. Placeholder column kept for symmetry. */}
                    </td>
                    {/* Live recon */}
                    <td className="text-center px-2 py-1.5">
                      <ReconBadge recon={h.reconciliation} />
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
          <span className="font-medium">Notes.</span> Big Options is long-premium lottery
          plays — max loss = debit paid, upside uncapped (or strike-defined for puts). The
          panel is informational, not prescriptive: <span className="font-medium">Multiple</span> is
          colored (≥2× bold green, ≥1× green, &lt;1× red), <span className="font-medium">Status</span> shows
          Sweet spot (30–75d, ±5% ATM), Patient (&gt;75d), Decay zone (≤30d), or Theta cliff
          (≤14d, OTM, losing). <span className="font-medium">Catalyst</span> badge marks
          earnings/manual catalysts inside the row's expiration window. <span className="font-medium">Size</span> warns
          when capital tied up exceeds your soft cap (${(thresholds.soft_cap_usd || 5000).toLocaleString()} or
          {' '}{thresholds.soft_cap_port_pct || 1}% of portfolio); 2× soft cap fires red.
          {(data?.excluded_complex_count > 0) && (
            <> <span className="font-medium">Excluded:</span> {data.excluded_complex_count} tagged
            chain{data.excluded_complex_count === 1 ? '' : 's'} that don't fit the long-premium
            shape (any short leg, or a stock leg).</>
          )}
        </div>
      </div>
    </section>
  );
};

export default BigOptionsPanel;
