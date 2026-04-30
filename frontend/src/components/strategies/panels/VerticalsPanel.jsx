/**
 * VerticalsPanel — Verticals strategy detail.
 *
 * Group-driven: each tagged transaction_position with two same-type,
 * same-expiration option legs (one short, one long, equal contracts,
 * different strikes) is one vertical. Anything else is excluded as
 * "complex" and surfaced in the footer count.
 *
 * Headline questions for verticals:
 *   - Ready to close? (capture% vs DTE — verticals don't roll)
 *   - Where's the assignment risk? (short strike vs spot)
 *   - What's still on the table? (cost to close)
 *   - Worst case? (max loss if held to expiry)
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw, Zap,
} from 'lucide-react';
import { fetchVerticalsHoldings } from '../../../services/tags';
import { useSelectedAccountHash } from '../../../hooks/useSelectedAccount';

// Legend lives next to the chip color maps below. Only non-obvious items.
const LEGEND_BADGES = [
  { name: 'Credit Put / Call', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Spread opened for a net credit (sell the closer-to-money strike, buy the farther one). Profit if the short strike stays OTM.' },
  { name: 'Debit Put / Call', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: 'Spread opened for a net debit (long-biased). Profit if the underlying moves enough toward the long strike.' },
  { name: 'Take it / Close', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Take it = ≥75% of max profit captured. Close = ≥50%. Standard credit-spread close triggers.' },
  { name: 'ITM-risk', cls: 'bg-red-50 text-red-700 border-red-200',
    desc: 'Short leg has been crossed. Assignment risk on the short side, particularly near expiration.' },
  { name: 'DTE-stop', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: '≤7 DTE without meaningful capture (<25%). Force a decision before pin risk and gamma blow up.' },
  { name: 'Risk: Safe → Likely', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'PoP from short-leg |Δ| (1 − |Δ| = ~chance short expires worthless). Falls back to short-vs-spot OTM% bands when greeks aren’t synced.' },
];
const LEGEND_COLUMNS = [
  { name: 'Net @open', desc: 'Signed cash at trade entry. Positive = credit collected; negative = debit paid. Combines both legs.' },
  { name: 'Width', desc: '|short_strike − long_strike| × 100 × contracts. The spread’s payoff range — credit max profit + debit max profit always sum to width.' },
  { name: 'Captured', desc: 'Unrealized P&L vs combined max profit, expressed as %. For credit spreads: how much of the credit you’ve already earned by waiting.' },
  { name: '$/day left', desc: 'Cost-to-close ÷ DTE. Forward-looking expected daily decay rate on the spread.' },
  { name: 'Short OTM', desc: 'Distance from spot to the short strike (signed). Negative = short crossed. The leg that drives assignment risk.' },
];

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
  'Credit Put':  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Credit Call': 'bg-rose-50 text-rose-700 border-rose-200',
  'Debit Put':   'bg-sky-50 text-sky-700 border-sky-200',
  'Debit Call':  'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const RISK_BADGE = {
  Safe:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  OK:      'bg-sky-50 text-sky-700 border-sky-200',
  'At risk': 'bg-amber-50 text-amber-700 border-amber-200',
  Likely:  'bg-red-50 text-red-700 border-red-200',
  ITM:     'bg-red-50 text-red-700 border-red-200',
  '?':     'bg-gray-50 text-gray-500 border-gray-200',
};

const ACTION_BADGE = {
  'Take it':   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Zap },
  Close:       { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: Zap },
  'ITM-risk':  { cls: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
  'DTE-stop':  { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  Hold:        { cls: 'bg-gray-50 text-gray-500 border-gray-200', icon: null },
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

const Stat = ({ label, value, hint }) => (
  <div>
    <div className="text-gray-500 flex items-center gap-1">
      {label}
      {hint && <span className="text-gray-400" title={hint}><Info className="w-3 h-3 inline" /></span>}
    </div>
    <div className="font-medium text-gray-900 tabular-nums">{value}</div>
  </div>
);

const VerticalsPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountHash = useSelectedAccountHash();
  const [sortKey, setSortKey] = useState('action');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['verticals-holdings', accountHash],
    queryFn: () => fetchVerticalsHoldings(accountHash),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['verticals-holdings'] });
  };

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const portfolioMv = data?.portfolio_liquidation_value || 0;

  const enriched = useMemo(() => {
    // Spread "MV" for portfolio concentration: the cost-to-close magnitude
    // (open premium at risk, plus current debit/credit). For credit
    // spreads, MV is approximately net premium received minus close cost
    // — the "skin in the game" right now.
    return holdings.map((h) => ({
      ...h,
      // Use abs(current_value) as the row's MV proxy: how much the spread
      // could move you in either direction if it ran to either max.
      rowMv: Math.abs(h.max_loss || h.width || 0),
      pctPort: portfolioMv > 0 ? (Math.abs(h.max_loss || 0) / portfolioMv) * 100 : null,
    }));
  }, [holdings, portfolioMv]);

  const sorted = useMemo(() => {
    const list = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    const ACTION_PRIORITY = { 'Take it': 5, 'Close': 4, 'ITM-risk': 3, 'DTE-stop': 2, 'Hold': 1 };
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
        case 'capture': r = cmp(a, b, 'capture_pct'); break;
        case 'unreal': r = cmp(a, b, 'unrealized_pnl'); break;
        case 'net_open': r = cmp(a, b, 'net_at_open'); break;
        case 'max_loss': r = cmp(a, b, 'max_loss'); break;
        case 'dte': r = cmp(a, b, 'dte'); break;
        case 'short_otm': r = cmp(a, b, 'short_otm_pct'); break;
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
    let netPremium = 0, captured = 0, maxRisk = 0, totalPnl = 0, day = 0;
    let dayKnown = false;
    let creditCount = 0, debitCount = 0;
    let totalMaxProfit = 0;
    let dteMin = null, dteMax = null;
    let dollarsPerDay = 0; let dollarsPerDayKnown = false;
    for (const h of enriched) {
      netPremium += h.net_at_open || 0;
      captured += h.unrealized_pnl || 0;
      maxRisk += h.max_loss || 0;
      totalMaxProfit += h.max_profit || 0;
      totalPnl += h.unrealized_pnl || 0;
      if (h.day_pnl != null) { day += h.day_pnl; dayKnown = true; }
      if (h.is_credit) creditCount += 1; else debitCount += 1;
      if (h.dte != null) {
        if (dteMin === null || h.dte < dteMin) dteMin = h.dte;
        if (dteMax === null || h.dte > dteMax) dteMax = h.dte;
      }
      if (h.dollars_per_day != null) { dollarsPerDay += h.dollars_per_day; dollarsPerDayKnown = true; }
    }
    const capturePct = totalMaxProfit > 0 ? (captured / totalMaxProfit) * 100 : null;
    const pctOfPort = portfolioMv > 0 ? (maxRisk / portfolioMv) * 100 : null;
    return {
      count: enriched.length, creditCount, debitCount,
      netPremium, captured, capturePct,
      maxRisk, totalPnl, day, dayKnown, pctOfPort,
      dteMin, dteMax, dollarsPerDay, dollarsPerDayKnown,
    };
  }, [enriched, portfolioMv]);

  const groupRollups = useMemo(() => {
    const m = new Map();
    for (const h of enriched) {
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { count: 0, netPremium: 0, captured: 0, maxRisk: 0, maxProfit: 0 });
        const g = m.get(tid);
        g.count += 1;
        g.netPremium += h.net_at_open || 0;
        g.captured += h.unrealized_pnl || 0;
        g.maxRisk += h.max_loss || 0;
        g.maxProfit += h.max_profit || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
        capturePct: g.maxProfit > 0 ? (g.captured / g.maxProfit) * 100 : null,
      }))
      .sort((a, b) => b.maxRisk - a.maxRisk);
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

  if (isLoading) return <div className="mt-4 text-sm text-gray-500">Loading verticals…</div>;
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Type & action badges</div>
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
          label="Spreads"
          value={totals.count}
          hint={`${totals.creditCount} credit · ${totals.debitCount} debit`}
        />
        <Stat
          label="Net premium"
          value={
            <span className={pnlClass(totals.netPremium)}>{fmtMoney(totals.netPremium, true)}</span>
          }
          hint="Σ credits received − Σ debits paid at open"
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
          hint="Combined unrealized vs combined max profit"
        />
        <Stat
          label="Max risk left"
          value={<span className="text-red-700">{fmtMoney(totals.maxRisk)}</span>}
          hint="Σ worst-case loss across open spreads"
        />
        <Stat
          label="Total P&L"
          value={<span className={pnlClass(totals.totalPnl)}>{fmtMoney(totals.totalPnl, true)}</span>}
        />
        <Stat
          label="Today"
          value={totals.dayKnown ? <span className={pnlClass(totals.day)}>{fmtMoney(totals.day, true)}</span> : '—'}
        />
        <Stat
          label="% of portfolio"
          value={
            totals.pctOfPort != null
              ? <span className={concentrationClass(totals.pctOfPort)}>{fmtPct(totals.pctOfPort)}</span>
              : '—'
          }
          hint={portfolioMv ? `risk vs ${fmtMoney(portfolioMv)} liquidation` : null}
        />
      </div>

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
                  <span className={pnlClass(g.netPremium)}>{fmtMoney(g.netPremium, true)}</span>
                  <span className={pnlClass(g.captured)}>cap {fmtMoney(g.captured, true)}</span>
                  {g.capturePct != null && (
                    <span className={pnlClass(g.capturePct)}>({fmtPct(g.capturePct, true)})</span>
                  )}
                  <span className="text-red-700">risk {fmtMoney(g.maxRisk)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active verticals tagged with this strategy. A vertical is a
          two-leg same-type, same-expiration spread (one short, one long,
          equal contract counts, different strikes), classified into a
          Group with strategy class <span className="font-medium">Verticals</span>.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Type" sortKey="type" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <th className="px-2 py-1.5 font-medium text-left">Strikes</th>
                <th className="px-2 py-1.5 font-medium text-right">Width</th>
                <SortableTh label="Net @open" sortKey="net_open" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Captured" sortKey="capture" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Total P&L" sortKey="unreal" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Max loss" sortKey="max_loss" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Risk" sortKey="risk" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <SortableTh label="Action" sortKey="action" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <SortableTh label="Short OTM" sortKey="short_otm" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="DTE" sortKey="dte" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="px-2 py-1.5 font-medium text-right" title="Cost-to-close ÷ DTE: forward decay rate">$/day left</th>
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const action = ACTION_BADGE[h.action] || ACTION_BADGE.Hold;
                const ActionIcon = action.icon;
                return (
                  <tr
                    key={h.chain_id}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer align-top"
                    onClick={() => goToTicker(h.underlying)}
                    title={`Open ${h.underlying} transaction history`}
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
                    <td className="px-2 py-1.5 text-gray-700">
                      {h.strikes_label}
                      <div className="text-[10px] text-gray-500">{fmtInt(h.contracts)}× contracts</div>
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney(h.width)}</td>
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.net_at_open)}`}>
                      {fmtMoney(h.net_at_open, true)}
                    </td>
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.unrealized_pnl)}`}>
                      <div>{fmtMoney(h.unrealized_pnl, true)}</div>
                      <div className="text-[10px]">{fmtPct(h.capture_pct, true)}</div>
                    </td>
                    <td className={`text-right px-2 py-1.5 font-medium ${pnlClass(h.row_total_pnl)}`}>
                      {fmtMoney(h.row_total_pnl, true)}
                    </td>
                    <td className="text-right px-2 py-1.5 text-red-700">
                      {fmtMoney(h.max_loss)}
                    </td>
                    <td className="text-center px-2 py-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_BADGE[h.risk_label] || RISK_BADGE['?']}`}
                        title={
                          h.risk_pop_pct != null
                            ? `~${Math.round(h.risk_pop_pct)}% probability short expires worthless (1 − |Δ|)`
                            : (h.short_delta == null
                              ? 'Approximated from short-strike vs spot %; delta not yet synced.'
                              : null)
                        }
                      >
                        {h.risk_label}
                      </span>
                    </td>
                    <td className="text-center px-2 py-1.5">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${action.cls}`}
                        title={
                          h.action === 'Close' ? '50% of max profit captured — classic close trigger'
                            : h.action === 'Take it' ? '75% captured — high-confidence close'
                            : h.action === 'ITM-risk' ? 'Short strike has crossed; assignment risk'
                            : h.action === 'DTE-stop' ? '≤7 days and not much captured — force a decision'
                            : 'No close trigger active'
                        }
                      >
                        {ActionIcon && <ActionIcon className="w-3 h-3" />}
                        {h.action}
                      </span>
                    </td>
                    <td className={`text-right px-2 py-1.5 ${
                      h.short_otm_pct != null && h.short_otm_pct < 0 ? 'text-red-700 font-medium' : 'text-gray-700'
                    }`}
                        title={h.short_otm_pct != null && h.short_otm_pct < 0 ? 'Short strike crossed — ITM risk' : 'Distance from spot to short strike'}
                    >
                      {fmtPct(h.short_otm_pct, true)}
                    </td>
                    <td className="text-right px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dteStyle(h.dte)}`}>
                        {h.dte == null ? '—' : `${h.dte}d`}
                      </span>
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-700"
                        title="Cost-to-close ÷ DTE: forward expected decay rate per day"
                    >
                      {h.dollars_per_day != null ? fmtMoney(h.dollars_per_day) : '—'}
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
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-300 font-medium text-gray-800">
              <tr>
                <td className="px-3 py-2 text-left">
                  {totals.count} spread{totals.count === 1 ? '' : 's'}
                  {totals.count > 0 && (
                    <span className="text-[10px] text-gray-500 ml-1">
                      ({totals.creditCount}cr / {totals.debitCount}db)
                    </span>
                  )}
                </td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className={`px-2 py-2 text-right ${pnlClass(totals.netPremium)}`}>
                  {fmtMoney(totals.netPremium, true)}
                </td>
                <td className={`px-2 py-2 text-right ${pnlClass(totals.captured)}`}>
                  <div>{fmtMoney(totals.captured, true)}</div>
                  {totals.capturePct != null && (
                    <div className="text-[10px]">{fmtPct(totals.capturePct, true)}</div>
                  )}
                </td>
                <td className={`px-2 py-2 text-right ${pnlClass(totals.totalPnl)}`}>
                  {fmtMoney(totals.totalPnl, true)}
                </td>
                <td className="px-2 py-2 text-right text-red-700">
                  {fmtMoney(totals.maxRisk)}
                </td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {totals.dteMin != null && totals.dteMax != null
                    ? (totals.dteMin === totals.dteMax
                        ? `${totals.dteMin}d`
                        : `${totals.dteMin}–${totals.dteMax}d`)
                    : '—'}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {totals.dollarsPerDayKnown ? fmtMoney(totals.dollarsPerDay) : '—'}
                </td>
                <td className={`px-2 py-2 text-right ${concentrationClass(totals.pctOfPort)}`}>
                  {fmtPct(totals.pctOfPort)}
                </td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Verticals are 2-leg same-type, same-expiration
          spreads. <span className="font-medium">Action</span> fires at standard close triggers:
          50% (Close), 75% (Take it), short crossed (ITM-risk), ≤7 DTE without capture (DTE-stop).
          <span className="font-medium"> Risk</span> uses real PoP from short-leg delta when synced;
          otherwise falls back to short-vs-spot OTM%. Greeks (delta, theta) and IV will improve the
          Risk chip and add a real "$/day theta" once they're populated on synced legs.
          {(data?.excluded_complex_count > 0) && (
            <> <span className="font-medium">Excluded:</span> {data.excluded_complex_count} tagged
            chain{data.excluded_complex_count === 1 ? '' : 's'} with non-vertical leg shape (e.g. iron
            condor, ratio, broken-wing) — those will get their own strategy area.</>
          )}
        </div>
      </div>
    </section>
  );
};

export default VerticalsPanel;
