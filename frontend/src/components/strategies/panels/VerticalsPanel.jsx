/**
 * VerticalsPanel — KPI panel for the Verticals strategy.
 *
 * Shows every active vertical_spread position with the data that drives
 * close decisions: credit at open, current value, % of max profit captured,
 * DTE, short-leg delta (PoP proxy).
 *
 * Today this filters by the auto-detected position.strategy_type rather than
 * by tag membership — pragmatic v1, since linking actual positions to tag
 * memberships requires more plumbing. The Groups list above shows the
 * user-classified Verticals groups and their member counts so the framing
 * stays correct.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchActualPositions } from '../../../services/schwab';

const DAY_MS = 24 * 60 * 60 * 1000;

const fmtMoney = (v, signed = false) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};

const fmtPct = (v, signed = false) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v).toFixed(1);
  if (signed) return `${v >= 0 ? '+' : '−'}${abs}%`;
  return `${v < 0 ? '−' : ''}${abs}%`;
};

const fmtNum = (v, decimals = 2) => {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return parseFloat(v).toFixed(decimals);
};

const parseDate = (iso) => {
  if (!iso) return null;
  const s = typeof iso === 'string' ? (iso.length === 10 ? iso + 'T00:00:00' : iso) : iso;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const daysUntil = (date) => {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / DAY_MS);
};

const dteStyle = (dte) => {
  if (dte === null) return 'bg-gray-100 text-gray-700';
  if (dte < 0) return 'bg-gray-100 text-gray-500';
  if (dte <= 7) return 'bg-red-100 text-red-800';
  if (dte <= 30) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
};

// For a vertical, "earliest expiry" is enough — both legs share an expiration.
const positionDTE = (p) => {
  const legs = (p.legs || []).filter((l) => (l.asset_type || '').toLowerCase() === 'option');
  if (!legs.length) return null;
  const exps = legs.map((l) => parseDate(l.expiration)).filter(Boolean).map((d) => d.getTime());
  if (!exps.length) return null;
  return daysUntil(new Date(Math.min(...exps)));
};

// Short-leg delta acts as a probability-of-profit proxy on credit verticals.
// Long verticals have positive net delta; we still surface the more-extreme
// leg's delta so the user can eyeball PoP.
const shortLegDelta = (p) => {
  const legs = (p.legs || []).filter(
    (l) => (l.asset_type || '').toLowerCase() === 'option' && parseFloat(l.quantity || 0) < 0
  );
  if (!legs.length) return null;
  // Pick the absolute-largest delta among short legs.
  let pick = null;
  for (const l of legs) {
    const d = l.delta != null ? parseFloat(l.delta) : null;
    if (d === null) continue;
    if (pick === null || Math.abs(d) > Math.abs(pick)) pick = d;
  }
  return pick;
};

const formatStrikes = (p) => {
  const legs = (p.legs || []).filter((l) => (l.asset_type || '').toLowerCase() === 'option');
  if (!legs.length) return '';
  // Sort short-side first to mirror typical "150/145 P" reading order
  // (short above long for credits, long above short for debits — we just
  // print sorted strikes with the option type).
  const sorted = [...legs].sort((a, b) => parseFloat(b.strike || 0) - parseFloat(a.strike || 0));
  const cp = (sorted[0].option_type || '').charAt(0).toUpperCase();
  return sorted.map((l) => l.strike).join('/') + ' ' + cp;
};

const VerticalsPanel = ({ tags }) => {
  const [sortKey, setSortKey] = useState('captured_desc');

  const { data, isLoading, error } = useQuery({
    queryKey: ['actual-positions-active'],
    queryFn: () => fetchActualPositions({ status: 'active' }),
  });

  const verticals = useMemo(() => {
    const positions = data?.positions || [];
    return positions
      .filter((p) => (p.strategy_type || '').toLowerCase() === 'vertical_spread')
      .map((p) => {
        const cb = p.cost_basis != null ? parseFloat(p.cost_basis) : null;
        const pnl = p.unrealized_pnl != null ? parseFloat(p.unrealized_pnl) : null;
        // Credit verticals: cost_basis is negative (we collected); max profit
        // is |cost_basis|. Captured % = pnl / max_profit. For debits, this
        // doesn't apply cleanly so we leave captured = null.
        const isCredit = cb !== null && cb < 0;
        const maxProfit = isCredit ? Math.abs(cb) : null;
        const capturedPct = (isCredit && pnl !== null && maxProfit > 0)
          ? (pnl / maxProfit) * 100 : null;
        return {
          p,
          dte: positionDTE(p),
          shortDelta: shortLegDelta(p),
          cb,
          pnl,
          isCredit,
          maxProfit,
          capturedPct,
        };
      });
  }, [data]);

  const sorted = useMemo(() => {
    const list = [...verticals];
    switch (sortKey) {
      case 'captured_desc':
        return list.sort((a, b) => (b.capturedPct ?? -Infinity) - (a.capturedPct ?? -Infinity));
      case 'dte_asc':
        return list.sort((a, b) => (a.dte ?? Infinity) - (b.dte ?? Infinity));
      case 'pnl_desc':
        return list.sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
      case 'underlying':
        return list.sort((a, b) =>
          (a.p.underlying || '').localeCompare(b.p.underlying || '')
        );
      default:
        return list;
    }
  }, [verticals, sortKey]);

  const totals = useMemo(() => {
    const t = { count: verticals.length, totalCredit: 0, totalPnl: 0, creditCount: 0 };
    for (const v of verticals) {
      if (v.isCredit) {
        t.totalCredit += v.maxProfit;
        t.creditCount += 1;
      }
      if (v.pnl !== null) t.totalPnl += v.pnl;
    }
    return t;
  }, [verticals]);

  if (isLoading) {
    return <div className="mt-4 text-sm text-gray-500">Loading verticals…</div>;
  }
  if (error) {
    return (
      <div className="mt-4 p-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load positions: {error.message}
      </div>
    );
  }

  return (
    <section className="mt-4 bg-white border border-gray-200 rounded">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <div>
          <div className="text-gray-500">Open verticals</div>
          <div className="font-medium text-gray-900 tabular-nums">{totals.count}</div>
        </div>
        <div>
          <div className="text-gray-500">Max profit (credits)</div>
          <div className="font-medium text-gray-900 tabular-nums">
            {totals.creditCount ? fmtMoney(totals.totalCredit) : '—'}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Unrealized P&amp;L</div>
          <div className={`font-medium tabular-nums ${totals.totalPnl >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {fmtMoney(totals.totalPnl, true)}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Group coverage</div>
          <div className="font-medium text-gray-900 tabular-nums">
            {tags.length} group{tags.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Sort controls */}
      <div className="px-3 py-1.5 border-b border-gray-200 flex items-center gap-2 text-xs">
        <span className="text-gray-500">Sort:</span>
        {[
          ['captured_desc', '% captured ↓'],
          ['dte_asc', 'DTE ↑'],
          ['pnl_desc', 'P&L ↓'],
          ['underlying', 'Underlying'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSortKey(k)}
            className={`px-2 py-0.5 rounded ${
              sortKey === k ? 'bg-indigo-100 text-indigo-800' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          No active vertical_spread positions detected. (This v1 filters by auto-detected strategy_type;
          tag-driven membership coming next.)
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Underlying</th>
                <th className="text-left px-2 py-1.5 font-medium">Strikes</th>
                <th className="text-right px-2 py-1.5 font-medium">DTE</th>
                <th className="text-right px-2 py-1.5 font-medium">Credit / Debit</th>
                <th className="text-right px-2 py-1.5 font-medium">P&amp;L</th>
                <th className="text-right px-2 py-1.5 font-medium">% Captured</th>
                <th className="text-right px-2 py-1.5 font-medium">Short Δ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ p, dte, shortDelta, cb, pnl, isCredit, capturedPct }) => (
                <tr key={p.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-medium text-gray-900">{p.underlying || p.symbol}</td>
                  <td className="px-2 py-1.5 text-gray-700">{formatStrikes(p)}</td>
                  <td className="text-right px-2 py-1.5">
                    <span className={`text-[10px] px-1 rounded ${dteStyle(dte)}`}>
                      {dte === null ? '—' : `${dte}d`}
                    </span>
                  </td>
                  <td className="text-right px-2 py-1.5">
                    {cb !== null ? (
                      <span className={isCredit ? 'text-emerald-700' : 'text-red-700'}>
                        {fmtMoney(Math.abs(cb))} {isCredit ? 'cr' : 'db'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${pnl !== null && pnl >= 0 ? 'text-emerald-700' : pnl !== null ? 'text-red-700' : 'text-gray-500'}`}>
                    {fmtMoney(pnl, true)}
                  </td>
                  <td className={`text-right px-2 py-1.5 ${capturedPct !== null && capturedPct >= 75 ? 'text-emerald-700 font-medium' : 'text-gray-700'}`}>
                    {fmtPct(capturedPct)}
                  </td>
                  <td className="text-right px-2 py-1.5">{fmtNum(shortDelta, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default VerticalsPanel;
