/**
 * DividendsPanel — past-first dividend income view.
 *
 * Why past-first: we have actual cash dividends in Schwab transaction cache
 * (filed under DIVIDEND_OR_INTEREST). We do NOT have ex-div dates / forward
 * yield without an external data source, so we don't fake projections.
 * The panel tells the user what they actually received — which is the right
 * lens for the user's stated tax/STCG concern about non-qualified dividends.
 *
 * Curation is tag-driven: only tickers in a Group with strategy_class
 * 'dividends' show up. Random penny dividends on unrelated holdings
 * intentionally don't appear.
 *
 * Qualified flag is user-set per ticker. Click the chip to cycle:
 *   verify → qualified → non-qualified → verify
 * The 1099-DIV is still authoritative; the chip is a self-tracking nudge.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, AlertTriangle, HelpCircle, Info,
  RefreshCw, ChevronUp, ChevronDown, ShieldQuestion,
} from 'lucide-react';
import {
  fetchDividendsHoldings,
  setDividendClassification,
} from '../../../services/tags';
import { useSelectedAccountHash } from '../../../hooks/useSelectedAccount';

const CONC_WARN = 10;
const CONC_DANGER = 20;

// ---------- formatters ----------

const fmtMoney = (v, signed = false, decimals = 2) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};

const fmtPct = (v, decimals = 2) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return `${parseFloat(v).toFixed(decimals)}%`;
};

const fmtShares = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
};

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '—');

const concentrationClass = (pct) => {
  if (pct == null || isNaN(pct)) return 'text-gray-700';
  if (pct >= CONC_DANGER) return 'text-red-700 font-semibold';
  if (pct >= CONC_WARN) return 'text-amber-700 font-medium';
  return 'text-gray-700';
};

const monthsBetween = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (30.44 * 86400000));
};

// ---------- qualified chip ----------

const QualifiedChip = ({ value, source, onCycle, busy }) => {
  // value: true | false | null (unset)
  // source: 'schwab' | 'user' | 'unknown'
  let cls = 'bg-gray-50 text-gray-500 border-gray-200';
  let label = 'verify';
  let title = 'Click to set qualified status. Authoritative source is the 1099-DIV.';
  if (value === true) {
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    label = 'qualified';
    title = source === 'user'
      ? 'Qualified (your override). Click to mark non-qualified.'
      : 'Qualified — Schwab marks every TTM payment as qualified. Click to override.';
  } else if (value === false) {
    cls = 'bg-amber-50 text-amber-700 border-amber-200';
    label = 'non-qual';
    title = source === 'user'
      ? 'Non-qualified (your override). Click to clear.'
      : 'Non-qualified — Schwab marks every TTM payment as non-qualified. Click to override.';
  } else {
    title = source === 'schwab'
      ? 'Mixed: TTM payments include both qualified and non-qualified. Click to set a manual override.'
      : 'Not yet classified. Click to set, or wait for Schwab dividend data.';
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
      disabled={busy}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border hover:brightness-95 disabled:opacity-50 ${cls}`}
      title={title}
    >
      {value === null && <ShieldQuestion className="w-3 h-3" />}
      {label}
      {source === 'user' && (value === true || value === false) && (
        <span className="text-[8px] opacity-70">·you</span>
      )}
    </button>
  );
};

// ---------- sortable th ----------

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

const DividendsPanel = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountHash = useSelectedAccountHash();
  const dividendsKey = useMemo(() => ['dividends-holdings', accountHash], [accountHash]);
  const [sortKey, setSortKey] = useState('ttm_income');
  const [sortDir, setSortDir] = useState('desc');
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: dividendsKey,
    queryFn: () => fetchDividendsHoldings(accountHash),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const tagById = useMemo(() => {
    const m = new Map();
    for (const t of (data?.tags || [])) m.set(t.id, t);
    return m;
  }, [data]);

  const holdings = useMemo(() => data?.holdings || [], [data]);
  const aggregates = data?.aggregates || {};

  // Footer aggregates not already in `aggregates`: total payouts (count of
  // TTM payments across all rows) and the most recent dividend date.
  const footer = useMemo(() => {
    let payouts = 0;
    let lastPaid = null;
    let pctPortSum = 0;
    for (const h of holdings) {
      payouts += Number(h.ttm_payment_count) || 0;
      if (h.last_paid && (!lastPaid || h.last_paid > lastPaid)) lastPaid = h.last_paid;
      pctPortSum += Number(h.pct_port_mv) || 0;
    }
    return { payouts, lastPaid, pctPortSum };
  }, [holdings]);

  const classMutation = useMutation({
    mutationFn: ({ symbol, qualified }) =>
      setDividendClassification(symbol, { qualified }),
    onMutate: async ({ symbol, qualified }) => {
      await queryClient.cancelQueries({ queryKey: dividendsKey });
      const prev = queryClient.getQueryData(dividendsKey);
      queryClient.setQueryData(dividendsKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          holdings: (old.holdings || []).map((h) =>
            h.underlying === symbol ? { ...h, qualified } : h
          ),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(dividendsKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dividendsKey });
    },
  });

  const cycleQualified = (h) => {
    // null → true → false → null
    let next;
    if (h.qualified === null || h.qualified === undefined) next = true;
    else if (h.qualified === true) next = false;
    else next = null;
    classMutation.mutate({ symbol: h.underlying, qualified: next });
  };

  const sorted = useMemo(() => {
    const list = [...holdings];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a, b, key) => {
      const av = a[key]; const bv = b[key];
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
        case 'shares': r = cmp(a, b, 'shares'); break;
        case 'mv': r = cmp(a, b, 'market_value'); break;
        case 'unreal': r = cmp(a, b, 'unrealized_pnl'); break;
        case 'net': r = cmp(a, b, 'net_return'); break;
        case 'net_pct': r = cmp(a, b, 'net_return_pct'); break;
        case 'ttm_income': r = cmp(a, b, 'ttm_income'); break;
        case 'all_time_income': r = cmp(a, b, 'all_time_income'); break;
        case 'ttm_yield': r = cmp(a, b, 'ttm_yield_pct'); break;
        case 'count': r = cmp(a, b, 'ttm_payment_count'); break;
        case 'last_paid': r = (a.last_paid || '').localeCompare(b.last_paid || '') * dir; break;
        case 'pct_port': r = cmp(a, b, 'pct_port_mv'); break;
        case 'qualified': {
          // unset (null) sorts last in desc, last in asc
          const av = a.qualified === true ? 2 : a.qualified === false ? 1 : 0;
          const bv = b.qualified === true ? 2 : b.qualified === false ? 1 : 0;
          r = (av - bv) * dir;
          break;
        }
        default: r = 0;
      }
      if (r === 0) return (a.underlying || '').localeCompare(b.underlying || '');
      return r;
    });
    return list;
  }, [holdings, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(['underlying', 'last_paid'].includes(key) ? 'asc' : 'desc');
    }
  };

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: dividendsKey });
  };

  const goToTicker = (underlying) => {
    if (underlying) navigate(`/schwab/transactions/${encodeURIComponent(underlying)}`);
  };

  if (isLoading) {
    return <div className="mt-4 text-sm text-gray-500">Loading dividends…</div>;
  }
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load: {error.message}
      </div>
    );
  }

  const ttmGrand = aggregates.ttm_income_total || 0;
  const qDollars = aggregates.ttm_income_qualified || 0;
  const nqDollars = aggregates.ttm_income_non_qualified || 0;
  const unsetDollars = aggregates.ttm_income_unclassified || 0;
  const qPct = ttmGrand > 0 ? (qDollars / ttmGrand) * 100 : null;
  const nqPct = ttmGrand > 0 ? (nqDollars / ttmGrand) * 100 : null;
  const totalCost = aggregates.total_cost_basis || 0;
  const totalUnreal = aggregates.total_unrealized_pnl || 0;
  const totalAllTimeDiv = aggregates.total_all_time_income || 0;
  const totalNet = aggregates.total_net_return || 0;
  const totalNetPct = aggregates.total_net_return_pct;
  const netPositive = totalNet >= 0;

  return (
    <section className="mt-4 bg-white border border-gray-200 rounded">
      {/* Header strip */}
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Tax classification chip</div>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 flex-shrink-0">qualified</span>
                  <span className="text-gray-700">Held long enough around ex-div for LTCG-rate treatment. Most US C-corp dividends qualify.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 flex-shrink-0">non-qual</span>
                  <span className="text-gray-700">Taxed as ordinary income — REITs, MLPs, single-stock yieldmax ETFs (e.g. YMAG), some foreign ADRs. Click to confirm.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-200 flex-shrink-0">verify</span>
                  <span className="text-gray-700">Not yet marked. Click to set. The 1099-DIV is the authoritative source; this chip is a self-tracking aid.</span>
                </li>
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Columns explained</div>
              <ul className="space-y-1.5">
                <li><span className="font-medium text-gray-900">MV / cost</span><span className="text-gray-700"> — top: current market value. Bottom: original cost basis.</span></li>
                <li><span className="font-medium text-gray-900">Unreal</span><span className="text-gray-700"> — unrealized P&L (MV − cost). Negative = NAV has decayed below your entry. Common with high-yield ETFs.</span></li>
                <li><span className="font-medium text-gray-900">TTM / all-time</span><span className="text-gray-700"> — top: trailing-365d cash income (current run-rate). Bottom: total received across the cached transaction window.</span></li>
                <li><span className="font-medium text-gray-900">Net</span><span className="text-gray-700"> — unrealized P&L + all dividends received. Pre-tax. The honest "are we ahead or behind, all-in?" number. Negative means NAV decay has eaten the income.</span></li>
                <li><span className="font-medium text-gray-900">TTM yield</span><span className="text-gray-700"> — TTM income / current market value. Trailing — not a forward yield projection.</span></li>
                <li><span className="font-medium text-gray-900">Payouts</span><span className="text-gray-700"> — number of dividend payments received in the trailing 365d. Quarterly payers show 4; monthly show 12.</span></li>
                <li><span className="font-medium text-gray-900">% port</span><span className="text-gray-700"> — current market value as % of total portfolio MV.</span></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Top stats — 7 cells; lg:grid-cols-7 keeps them on one row.
          Net since inception is the headline: cash dividends + NAV change. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <Stat
          label="Net since inception"
          value={
            <span className={netPositive ? 'text-emerald-700' : 'text-red-700'}>
              {fmtMoney(totalNet, true)}
              {totalNetPct != null && (
                <span className="ml-1 text-[11px]">({fmtPct(totalNetPct, 1)})</span>
              )}
            </span>
          }
          hint="Unrealized P&L on the positions + all dividends received (cached window, ≈730d). The honest 'are we ahead?' number, pre-tax."
        />
        <Stat
          label="Unrealized"
          value={
            <span className={totalUnreal >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {fmtMoney(totalUnreal, true)}
            </span>
          }
          hint={`MV ${fmtMoney(aggregates.total_market_value || 0)} − cost ${fmtMoney(totalCost)}. NAV-decay tracker for high-yield ETFs.`}
        />
        <Stat
          label="All-time div"
          value={<span className="text-emerald-700">{fmtMoney(totalAllTimeDiv)}</span>}
          hint="Total cash dividends received across the cached transaction window."
        />
        <Stat
          label="TTM income"
          value={<span className="text-emerald-700">{fmtMoney(ttmGrand)}</span>}
          hint="Trailing-365d cash dividends — current run-rate."
        />
        <Stat
          label="Qualified"
          value={
            <>
              <span className="text-emerald-700">{fmtMoney(qDollars)}</span>
              {qPct != null && (
                <span className="ml-1 text-[11px] text-gray-500">({fmtPct(qPct, 0)})</span>
              )}
            </>
          }
          hint="TTM dividends marked qualified — eligible for LTCG rates."
        />
        <Stat
          label="Non-qualified"
          value={
            <>
              <span className="text-amber-700">{fmtMoney(nqDollars)}</span>
              {nqPct != null && (
                <span className="ml-1 text-[11px] text-gray-500">({fmtPct(nqPct, 0)})</span>
              )}
            </>
          }
          hint="TTM dividends marked non-qualified — ordinary-income / potential STCG drag."
        />
        <Stat
          label="To verify"
          value={
            <span className={unsetDollars > 0 ? 'text-gray-700' : 'text-gray-400'}>
              {fmtMoney(unsetDollars)}
            </span>
          }
          hint="TTM dividends with no qualified flag set. Click chips on the rows to classify."
        />
      </div>

      {/* Tax-bucket bar */}
      {ttmGrand > 0 && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="flex h-2 rounded overflow-hidden bg-gray-100">
            {qPct != null && qPct > 0 && (
              <div
                className="bg-emerald-400"
                style={{ width: `${qPct}%` }}
                title={`Qualified ${fmtMoney(qDollars)} (${fmtPct(qPct, 1)})`}
              />
            )}
            {nqPct != null && nqPct > 0 && (
              <div
                className="bg-amber-400"
                style={{ width: `${nqPct}%` }}
                title={`Non-qualified ${fmtMoney(nqDollars)} (${fmtPct(nqPct, 1)})`}
              />
            )}
            {unsetDollars > 0 && (
              <div
                className="bg-gray-300"
                style={{ width: `${(unsetDollars / ttmGrand) * 100}%` }}
                title={`Unclassified ${fmtMoney(unsetDollars)}`}
              />
            )}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No holdings tagged for dividends yet. Tag a transaction-position
          covering a dividend-paying stock into a Group with strategy class{' '}
          <span className="font-medium">Dividends</span>. Penny dividends on
          unrelated holdings are intentionally excluded — only what you tag.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <SortableTh label="Position" sortKey="underlying" currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
                <th className="px-2 py-1.5 font-medium text-left">Groups</th>
                <SortableTh label="Tax" sortKey="qualified" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="center" />
                <SortableTh label="Shares" sortKey="shares" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="MV / cost" sortKey="mv" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Unreal" sortKey="unreal" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="TTM / all-time" sortKey="ttm_income" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Net" sortKey="net" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="TTM yield" sortKey="ttm_yield" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Payouts" sortKey="count" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <SortableTh label="Last paid" sortKey="last_paid" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="left" />
                <SortableTh label="% port" sortKey="pct_port" currentKey={sortKey} currentDir={sortDir} onSort={onSort} align="right" />
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const monthsSince = monthsBetween(h.last_paid);
                const stale = monthsSince != null && monthsSince > 6;
                const noPayouts = h.ttm_payment_count === 0;
                return (
                  <tr
                    key={h.underlying}
                    className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => goToTicker(h.underlying)}
                    title={`Open ${h.underlying} transaction history`}
                  >
                    <td className="px-3 py-1.5 align-top">
                      <div className="font-medium text-gray-900">{h.underlying}</div>
                      {h.account_numbers && h.account_numbers.length > 0 && (
                        <div className="text-[10px] text-gray-500">
                          {h.account_numbers.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-top">
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
                    <td className="text-center px-2 py-1.5 align-top">
                      <QualifiedChip
                        value={h.qualified ?? null}
                        source={h.qualified_source || 'unknown'}
                        onCycle={() => cycleQualified(h)}
                        busy={classMutation.isPending}
                      />
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-700 align-top">
                      {fmtShares(h.shares)}
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-900 align-top">
                      <div>{fmtMoney(h.market_value)}</div>
                      <div className="text-[10px] text-gray-500">
                        {fmtMoney(h.cost_basis)} cost
                      </div>
                    </td>
                    <td className={`text-right px-2 py-1.5 align-top ${
                      h.unrealized_pnl >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}>
                      <div>{fmtMoney(h.unrealized_pnl, true)}</div>
                      {h.cost_basis > 0 && (
                        <div className="text-[10px] opacity-75">
                          {fmtPct((h.unrealized_pnl / h.cost_basis) * 100, 1)}
                        </div>
                      )}
                    </td>
                    <td className="text-right px-2 py-1.5 align-top">
                      <div className={h.ttm_income > 0 ? 'text-emerald-700' : 'text-gray-400'}>
                        {fmtMoney(h.ttm_income)}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {fmtMoney(h.all_time_income)} all-time
                      </div>
                      {h.ttm_income > 0
                       && h.ttm_qualified_income > 0
                       && h.ttm_non_qualified_income > 0 && (
                        <div
                          className="text-[10px] text-gray-500"
                          title="Schwab marks each payment qualified or non-qualified. This security's TTM payments are mixed."
                        >
                          {fmtMoney(h.ttm_qualified_income, false, 0)}q / {fmtMoney(h.ttm_non_qualified_income, false, 0)}nq
                        </div>
                      )}
                    </td>
                    <td className={`text-right px-2 py-1.5 align-top font-medium ${
                      h.net_return >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                      title="Unrealized P&L + all dividends received. Pre-tax. Negative means NAV decay has eaten the income."
                    >
                      <div>{fmtMoney(h.net_return, true)}</div>
                      {h.net_return_pct != null && (
                        <div className="text-[10px] opacity-75">
                          {fmtPct(h.net_return_pct, 1)}
                        </div>
                      )}
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-700 align-top">
                      {fmtPct(h.ttm_yield_pct)}
                    </td>
                    <td className="text-right px-2 py-1.5 text-gray-700 align-top">
                      <div>{h.ttm_payment_count}</div>
                      {h.all_payment_count > h.ttm_payment_count && (
                        <div className="text-[10px] text-gray-400">
                          {h.all_payment_count} all-time
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700 align-top">
                      {noPayouts ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700"
                          title="No dividend payments in the cached transaction history."
                        >
                          <AlertTriangle className="w-3 h-3" />
                          none cached
                        </span>
                      ) : (
                        <>
                          <div className={stale ? 'text-amber-700' : ''}>
                            {fmtDate(h.last_paid)}
                          </div>
                          {monthsSince != null && (
                            <div className="text-[10px] text-gray-500">
                              {monthsSince === 0 ? 'this month' : `${monthsSince}mo ago`}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`text-right px-2 py-1.5 align-top ${concentrationClass(h.pct_port_mv)}`}>
                      <div>{fmtPct(h.pct_port_mv, 1)}</div>
                      {h.pct_port_cost != null && (
                        <div className="text-[10px] text-gray-500">
                          {fmtPct(h.pct_port_cost, 1)} cost
                        </div>
                      )}
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
                <td className="px-3 py-2 text-left">{sorted.length} tickers</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right">
                  <div>{fmtMoney(aggregates.total_market_value || 0)}</div>
                  <div className="text-[10px] text-gray-500">
                    {fmtMoney(aggregates.total_cost_basis || 0)} cost
                  </div>
                </td>
                <td className={`px-2 py-2 text-right ${
                  (aggregates.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}>
                  {fmtMoney(aggregates.total_unrealized_pnl || 0, true)}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="text-emerald-700">{fmtMoney(aggregates.ttm_income_total || 0)}</div>
                  <div className="text-[10px] text-gray-500">
                    {fmtMoney(aggregates.total_all_time_income || 0)} all-time
                  </div>
                </td>
                <td className={`px-2 py-2 text-right ${
                  (aggregates.total_net_return || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}>
                  <div>{fmtMoney(aggregates.total_net_return || 0, true)}</div>
                  {aggregates.total_net_return_pct != null && (
                    <div className="text-[10px] opacity-75">
                      {fmtPct(aggregates.total_net_return_pct, 1)}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">
                  {aggregates.weighted_ttm_yield_pct != null
                    ? fmtPct(aggregates.weighted_ttm_yield_pct)
                    : '—'}
                </td>
                <td className="px-2 py-2 text-right text-gray-700">{footer.payouts}</td>
                <td className="px-2 py-2 text-left text-gray-700">{fmtDate(footer.lastPaid)}</td>
                <td className={`px-2 py-2 text-right ${concentrationClass(footer.pctPortSum)}`}>
                  {fmtPct(footer.pctPortSum, 1)}
                </td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-medium">Notes.</span> Trailing-twelve-months
          income is summed from cached Schwab DIVIDEND_OR_INTEREST transactions.
          Schwab puts only USD in the transferItems for dividend payments —
          the payer is identified by fuzzy-matching the description against
          tickers you've tagged (e.g. "YIELDMAX MAGFT 7 FND OPTINCM ETF" → YMAG).
          Each payment carries Schwab's <span className="font-medium">qualifiedDividend</span> flag,
          so the chip defaults to that classification and only surfaces "verify"
          for mixed (some-qualified, some-non) securities. Click the chip to
          override. The 1099-DIV remains authoritative for tax filing.
          Forward / projected dividends are intentionally not shown — we don't
          have ex-div dates or rates without an external data source.
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

export default DividendsPanel;
