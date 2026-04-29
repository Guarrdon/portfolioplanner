/**
 * LongStockPanel — Long Stock strategy detail.
 *
 * Live-first: rows are active Schwab stock positions (per account) tagged
 * into a Group whose strategy_classes contains "long_stock". Schwab's live
 * shares / avg cost / market value are the source of truth. Tagged
 * transaction-position chains are overlay — they contribute group chips,
 * a realized-on-classified-sells P&L estimate, and reconciliation state.
 *
 * Why live-first: original buy transactions are often older than the
 * cache window; only the user's later sells get classified. The chain's
 * net stock qty can be ≤ 0 while Schwab still reports the position as
 * open. Walking from live → chain (rather than chain → live) shows every
 * holding the user has tagged for this strategy and lets us flag the
 * pre-window case explicitly.
 *
 * Concentration thresholds: 10% of portfolio = warn, 20% = strong-warn.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, CheckCircle2, HelpCircle, Info,
  ChevronUp, ChevronDown, RefreshCw,
} from 'lucide-react';
import { fetchLongStockHoldings } from '../../../services/tags';

const CONC_WARN = 10;
const CONC_DANGER = 20;
const LT_DAYS = 365;

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

const pnlClass = (n) => {
  if (n === null || n === undefined || isNaN(n)) return 'text-gray-500';
  return n >= 0 ? 'text-emerald-700' : 'text-red-700';
};

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '—');

const concentrationClass = (pct) => {
  if (pct == null || isNaN(pct)) return 'text-gray-500';
  if (pct >= CONC_DANGER) return 'text-red-700 font-semibold';
  if (pct >= CONC_WARN) return 'text-amber-700 font-medium';
  return 'text-gray-700';
};

// ---------- reconciliation chip ----------

const RECON_BADGE = {
  reconciled: {
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Live',
  },
  pre_window: {
    icon: Info,
    cls: 'bg-sky-50 text-sky-700 border-sky-200',
    label: 'Pre-window',
  },
  discrepancy: {
    icon: AlertTriangle,
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    label: 'Gap',
  },
  no_chain: {
    icon: HelpCircle,
    cls: 'bg-gray-50 text-gray-500 border-gray-200',
    label: 'No chain',
  },
};

// Legend lives next to the chips. Only non-obvious items.
const LEGEND_BADGES = [
  { name: 'LT', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Long-term: held ≥365 days. Sell qualifies for long-term capital gains rates.' },
  { name: 'ST', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Short-term: held <365 days. Sell taxed as ordinary income.' },
  { name: 'Live', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    desc: 'Reconciled: synced share count matches the chain history derived from transaction tags.' },
  { name: 'Pre-window', cls: 'bg-sky-50 text-sky-700 border-sky-200',
    desc: 'The original buy is older than our 730-day transaction cache. Cost basis is taken from Schwab’s synced average; chain-derived realized P&L is partial.' },
  { name: 'Gap', cls: 'bg-amber-50 text-amber-700 border-amber-200',
    desc: 'Synced shares disagree with what the tagged chain implies. Usually means an unclassified buy/sell needs to be added to the Group.' },
  { name: 'No chain', cls: 'bg-gray-50 text-gray-500 border-gray-200',
    desc: 'Position is tagged but no transactions are classified into it yet — only Schwab’s live snapshot is contributing.' },
];
const LEGEND_COLUMNS = [
  { name: 'Held days', desc: 'Days since the earliest classified buy in this chain. Rolls into LT/ST status at 365.' },
  { name: 'Realized %', desc: 'Realized P&L from prior trims of this chain, expressed against cost basis. Distinct from unrealized which marks the current open shares to market.' },
  { name: 'Today', desc: 'Schwab-reported intraday P&L on the position. Net of any same-day buys/sells.' },
];

const ReconBadge = ({ recon }) => {
  if (!recon || !recon.state) return <span className="text-gray-300">—</span>;
  const cfg = RECON_BADGE[recon.state] || RECON_BADGE.no_chain;
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

// ---------- sortable column header ----------

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

// ---------- panel ----------

const LongStockPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState('mv');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  // Cache-only: backend reads from synced Position table. staleTime
  // Infinity means switching between strategy panels doesn't refetch.
  // Manual Refresh button below invalidates when the user wants fresh.
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['long-stock-holdings'],
    queryFn: fetchLongStockHoldings,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const portfolioMv = data?.portfolio_liquidation_value || 0;

  const enriched = useMemo(() => {
    const stratMv = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
    return holdings.map((h) => {
      const dayPct = h.current_day_pnl_percentage;
      const heldDays = h.earliest_chain_tx_date
        ? Math.max(0, Math.round(
            (Date.now() - new Date(h.earliest_chain_tx_date).getTime()) / 86400000
          ))
        : null;
      // LT/ST: pre-window means the original buy is older than the
      // transaction history window (≥365 days), so LT by definition. If
      // chain coverage is reconciled, use earliest classified tx date.
      // Mixed lots (pre_window state with some chain history) still get
      // LT — at minimum the pre-window portion qualifies, and we show
      // the floor.
      const reconState = h.reconciliation?.state;
      let ltStatus;
      if (reconState === 'pre_window') {
        ltStatus = 'LT';
      } else if (heldDays != null) {
        ltStatus = heldDays >= LT_DAYS ? 'LT' : 'ST';
      } else {
        // No chain coverage at all — shouldn't happen in this view
        // (filter requires ≥1 chain) but guard anyway.
        ltStatus = '?';
      }
      const pnlPct = h.cost_basis > 0
        ? (h.unrealized_pnl / h.cost_basis) * 100 : null;
      return {
        ...h,
        pnlPct,
        heldDays,
        ltStatus,
        pctStrat: stratMv > 0 ? (h.market_value / stratMv) * 100 : null,
        pctPort: portfolioMv > 0 ? (h.market_value / portfolioMv) * 100 : null,
        dayPct,
      };
    });
  }, [holdings, portfolioMv]);

  // Sort across columns. Primary key plus stable-by-ticker fallback.
  const sorted = useMemo(() => {
    const list = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b, key) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;       // nulls last
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    };
    list.sort((a, b) => {
      let r;
      switch (sortKey) {
        case 'underlying': r = (a.underlying || '').localeCompare(b.underlying || '') * dir; break;
        case 'shares': r = cmp(a, b, 'shares'); break;
        case 'avg_cost': r = cmp(a, b, 'avg_cost'); break;
        case 'current_price': r = cmp(a, b, 'current_price'); break;
        case 'mv': r = cmp(a, b, 'market_value'); break;
        case 'unreal': r = cmp(a, b, 'unrealized_pnl'); break;
        case 'unreal_pct': r = cmp(a, b, 'pnlPct'); break;
        case 'day': r = cmp(a, b, 'current_day_pnl'); break;
        case 'realized': r = cmp(a, b, 'realized_pnl'); break;
        case 'pct_port': r = cmp(a, b, 'pctPort'); break;
        case 'pct_strat': r = cmp(a, b, 'pctStrat'); break;
        case 'held': r = cmp(a, b, 'heldDays'); break;
        case 'lt': r = (a.ltStatus || '').localeCompare(b.ltStatus || '') * dir; break;
        default: r = 0;
      }
      if (r === 0) return (a.underlying || '').localeCompare(b.underlying || '');
      return r;
    });
    return list;
  }, [enriched, sortKey, sortDir]);

  const totals = useMemo(() => {
    let cost = 0, value = 0, pnl = 0, day = 0, realized = 0;
    let dayKnown = false, realizedKnown = false;
    for (const h of enriched) {
      cost += h.cost_basis || 0;
      value += h.market_value || 0;
      pnl += h.unrealized_pnl || 0;
      if (h.current_day_pnl != null) { day += h.current_day_pnl; dayKnown = true; }
      if (h.realized_pnl != null) { realized += h.realized_pnl; realizedKnown = true; }
    }
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
    const denom = value - day;
    const dayPct = (dayKnown && denom !== 0) ? (day / Math.abs(denom)) * 100 : null;
    const pctOfPort = portfolioMv > 0 ? (value / portfolioMv) * 100 : null;
    return {
      count: enriched.length,
      cost, value, pnl, pnlPct,
      day, dayPct, dayKnown,
      realized, realizedKnown,
      pctOfPort,
    };
  }, [enriched, portfolioMv]);

  // Per-Group rollup: a holding with N tags appears in N groups (intentional —
  // the user wants to see each group's composition). MV double-counts across
  // groups; that's how groupings work.
  const groupRollups = useMemo(() => {
    const m = new Map();
    for (const h of enriched) {
      for (const tid of (h.tag_ids || [])) {
        if (!m.has(tid)) m.set(tid, { count: 0, mv: 0, cb: 0, pnl: 0 });
        const g = m.get(tid);
        g.count += 1;
        g.mv += h.market_value || 0;
        g.cb += h.cost_basis || 0;
        g.pnl += h.unrealized_pnl || 0;
      }
    }
    return Array.from(m.entries())
      .map(([tid, g]) => ({
        tag: tagById.get(tid) || { id: tid, name: tid, color: '#9ca3af' },
        ...g,
        pnlPct: g.cb > 0 ? (g.pnl / g.cb) * 100 : null,
      }))
      .sort((a, b) => b.mv - a.mv);
  }, [enriched, tagById]);

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['long-stock-holdings'] });
  };

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(['underlying', 'lt'].includes(key) ? 'asc' : 'desc');
    }
  };

  const goToTicker = (underlying) => {
    if (underlying) navigate(`/schwab/transactions/${encodeURIComponent(underlying)}`);
  };

  if (isLoading) {
    return <div className="mt-4 text-sm text-gray-500">Loading positions…</div>;
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
      {/* Freshness bar */}
      <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {data?.last_synced
            ? <>Synced <SyncedAgo iso={data.last_synced} /> · cached</>
            : 'No sync timestamp'}
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Tax & reconciliation badges</div>
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

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat label="Holdings" value={totals.count} />
        <Stat label="Market value" value={fmtMoney(totals.value)} />
        <Stat label="Cost basis" value={fmtMoney(totals.cost)} />
        <Stat
          label="Unrealized P&L"
          value={
            <span className={pnlClass(totals.pnl)}>
              {fmtMoney(totals.pnl, true)}
              <span className="ml-1 text-[11px]">({fmtPct(totals.pnlPct, true)})</span>
            </span>
          }
        />
        <Stat
          label="Today"
          value={
            totals.dayKnown ? (
              <span className={pnlClass(totals.day)}>
                {fmtMoney(totals.day, true)}
                {totals.dayPct != null && (
                  <span className="ml-1 text-[11px]">({fmtPct(totals.dayPct, true)})</span>
                )}
              </span>
            ) : '—'
          }
        />
        <Stat
          label="% of portfolio"
          value={
            totals.pctOfPort != null ? (
              <span className={concentrationClass(totals.pctOfPort)}>
                {fmtPct(totals.pctOfPort)}
              </span>
            ) : '—'
          }
          hint={portfolioMv ? `of ${fmtMoney(portfolioMv)} total liquidation` : 'no portfolio total'}
        />
      </div>

      {totals.realizedKnown && (
        <div className="px-3 py-1.5 border-b border-gray-200 text-xs text-gray-600 flex items-center gap-2">
          <span>Realized P&amp;L on classified sells (estimate):</span>
          <span className={`font-medium tabular-nums ${pnlClass(totals.realized)}`}>
            {fmtMoney(totals.realized, true)}
          </span>
          <span className="text-gray-400" title="Estimated as sells_proceeds − sells_qty × chain's avg-buy-price. Only counts sells whose buys are within the tx history window.">
            <Info className="w-3 h-3 inline" />
          </span>
        </div>
      )}

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
                  <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{g.count}</span>
                </div>
                <div className="flex items-baseline gap-2 text-[11px] tabular-nums">
                  <span className="text-gray-700">{fmtMoney(g.mv)}</span>
                  <span className={pnlClass(g.pnl)}>{fmtMoney(g.pnl, true)}</span>
                  <span className={`${pnlClass(g.pnlPct)}`}>({fmtPct(g.pnlPct, true)})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active long-stock holdings tagged with this strategy. Tag a
          transaction-position covering an open stock holding into a Group
          with strategy class <span className="font-medium">Long Stock</span>.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Shares" sortKey="shares" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Avg cost" sortKey="avg_cost" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Last" sortKey="current_price" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Mkt value" sortKey="mv" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Unrealized" sortKey="unreal" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Today" sortKey="day" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Realized" sortKey="realized" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Tax" sortKey="lt" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Held" sortKey="held" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="left" />
                <th className="px-2 py-1.5 font-medium text-center">Live</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const rowKey = `${h.underlying}|${h.account_hash || ''}`;
                return (
                  <tr
                    key={rowKey}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer align-top"
                    onClick={() => goToTicker(h.underlying)}
                    title={`Open ${h.underlying} transaction history`}
                  >
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-900">{h.underlying}</div>
                      {h.account_number && (
                        <div className="text-[10px] text-gray-500">{h.account_number}</div>
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
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtShares(h.shares)}</td>
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney(h.avg_cost)}</td>
                    <td className="text-right px-2 py-1.5 text-gray-700">{fmtMoney(h.current_price)}</td>
                    <td className="text-right px-2 py-1.5 text-gray-900">{fmtMoney(h.market_value)}</td>
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.unrealized_pnl)}`}>
                      <div>{fmtMoney(h.unrealized_pnl, true)}</div>
                      <div className="text-[10px]">{fmtPct(h.pnlPct, true)}</div>
                    </td>
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.current_day_pnl)}`}>
                      <div>{h.current_day_pnl != null ? fmtMoney(h.current_day_pnl, true) : '—'}</div>
                      <div className="text-[10px]">{h.dayPct != null ? fmtPct(h.dayPct, true) : ''}</div>
                    </td>
                    <td className={`text-right px-2 py-1.5 ${pnlClass(h.realized_pnl)}`}>
                      {h.realized_pnl != null ? fmtMoney(h.realized_pnl, true) : '—'}
                    </td>
                    <td className="text-center px-2 py-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          h.ltStatus === 'LT'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : h.ltStatus === 'ST'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-gray-50 text-gray-500 border-gray-200'
                        }`}
                        title={
                          h.ltStatus === 'LT'
                            ? (h.reconciliation?.state === 'pre_window'
                              ? 'Long-term: original buy is older than the tx history window (≥365 days)'
                              : 'Long-term: gains qualify for LTCG rates')
                            : h.ltStatus === 'ST'
                              ? `Short-term: ${LT_DAYS - (h.heldDays ?? 0)} days until LT`
                              : 'No chain coverage'
                        }
                      >
                        {h.ltStatus}
                      </span>
                    </td>
                    <td className={`text-right px-2 py-1.5 ${concentrationClass(h.pctPort)}`}
                        title={
                          h.pctPort != null && h.pctPort >= CONC_DANGER ? 'Heavy concentration (>20% of portfolio)'
                            : h.pctPort != null && h.pctPort >= CONC_WARN ? 'Concentrated (>10% of portfolio)'
                              : '% of total portfolio'
                        }>
                      <div>{fmtPct(h.pctPort)}</div>
                      <div className="text-[10px] text-gray-500">{fmtPct(h.pctStrat)} of strat</div>
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">
                      <div>{fmtDate(h.earliest_chain_tx_date)}</div>
                      {h.heldDays != null && (
                        <div className="text-[10px] text-gray-500">{h.heldDays}d</div>
                      )}
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
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Live shares / cost / MV come straight from
          Schwab. <span className="font-medium">Held since</span> shows the earliest classified tx
          date — the actual entry date may be older (pre-window). Pre-window holdings count as LT
          since the original buy is by definition older than the 365-day tx history window.
          Realized P&amp;L counts only chain-classified sells whose matching buys are also
          classified. Not yet wired: sector, dividend yield + ex-div, 52-week hi/lo, beta.
        </div>
      </div>
    </section>
  );
};

const SyncedAgo = ({ iso }) => {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60000);
  if (m < 1) return <>just now</>;
  if (m < 60) return <>{m}m ago</>;
  const h = Math.floor(m / 60);
  if (h < 24) return <>{h}h ago</>;
  const d = Math.floor(h / 24);
  return <>{d}d ago</>;
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

export default LongStockPanel;
