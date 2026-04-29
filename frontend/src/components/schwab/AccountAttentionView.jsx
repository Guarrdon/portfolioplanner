/**
 * AccountAttentionView — account-level "what needs attention" screen.
 *
 * Positions are grouped by earliest option-leg expiration. Stock-only positions
 * are excluded (no expiration to surface). Each position row can be drilled
 * into for decision-support data: spot, moneyness, P&L, greeks, intrinsic/
 * extrinsic split.
 *
 * Route: /schwab/attention
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, ChevronDown, ChevronRight, Flag, StickyNote,
  History, AlertTriangle, Pencil, X,
} from 'lucide-react';
import { fetchActualPositions } from '../../services/schwab';
import { fetchPositionFlags, updatePositionFlag } from '../../services/positionFlags';
import { useRememberPage, useRestoreSnapshot } from '../../contexts/NavStackContext';

const DAY_MS = 24 * 60 * 60 * 1000;

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

const daysSince = (date) => {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - date.getTime()) / DAY_MS);
};

const fmtExpiryHeader = (iso) => {
  const d = parseDate(iso);
  if (!d) return iso || '-';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${month} ${d.getDate()}, ${d.getFullYear()}`;
};

const fmtExpiryShort = (iso) => {
  const d = parseDate(iso);
  if (!d) return '';
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${d.getDate()}${mon}${String(d.getFullYear()).slice(-2)}`;
};

const fmtMoney = (v, opts = {}) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const { signed = false, decimals = 2 } = opts;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (signed) return `${n >= 0 ? '+' : '−'}$${abs}`;
  return `${n < 0 ? '−' : ''}$${abs}`;
};

const fmtPct = (v, opts = {}) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  const { signed = false, decimals = 2 } = opts;
  const abs = Math.abs(n).toFixed(decimals);
  if (signed) return `${n >= 0 ? '+' : '−'}${abs}%`;
  return `${n < 0 ? '−' : ''}${abs}%`;
};

const fmtNum = (v, decimals = 2) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
};

const urgencyStyle = (days) => {
  if (days === null) return { bar: 'bg-gray-300', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-700' };
  if (days < 0) return { bar: 'bg-gray-400', text: 'text-gray-600', badge: 'bg-gray-100 text-gray-600' };
  if (days <= 7) return { bar: 'bg-red-500', text: 'text-red-800', badge: 'bg-red-100 text-red-800' };
  if (days <= 30) return { bar: 'bg-amber-500', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800' };
  return { bar: 'bg-gray-300', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-700' };
};

const formatDaysLabel = (days) => {
  if (days === null) return '';
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
};

const earliestOptionExpiration = (position) => {
  const legs = position?.legs || [];
  const expirations = legs
    .filter((l) => (l.asset_type || '').toLowerCase() === 'option' && l.expiration)
    .map((l) => l.expiration);
  if (!expirations.length) return null;
  return expirations.sort()[0];
};

const strategyLabel = (s) => {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Per-leg moneyness/intrinsic/extrinsic vs the underlying spot. Returns nulls
// when we don't have enough data — the UI shows "—" rather than guessing.
const computeLegMath = (leg, spot) => {
  const out = {
    moneyness: null,        // spot - strike (calls) or strike - spot (puts); +ITM, -OTM
    moneynessPct: null,     // moneyness / strike * 100
    intrinsic: null,        // per-share intrinsic value (always ≥ 0)
    extrinsic: null,        // mark - intrinsic
    state: null,            // 'ITM' | 'OTM' | 'ATM'
  };
  if ((leg.asset_type || '').toLowerCase() !== 'option') return out;
  const strike = leg.strike != null ? parseFloat(leg.strike) : null;
  const mark = leg.current_price != null ? parseFloat(leg.current_price) : null;
  const isCall = (leg.option_type || '').toLowerCase() === 'call';
  const isPut = (leg.option_type || '').toLowerCase() === 'put';
  if (strike === null || spot === null || spot === undefined) return out;
  const m = isCall ? spot - strike : isPut ? strike - spot : null;
  if (m === null) return out;
  out.moneyness = m;
  out.moneynessPct = strike !== 0 ? (m / strike) * 100 : null;
  if (Math.abs(m) < strike * 0.005) out.state = 'ATM';
  else if (m > 0) out.state = 'ITM';
  else out.state = 'OTM';
  out.intrinsic = Math.max(0, m);
  if (mark !== null) out.extrinsic = mark - out.intrinsic;
  return out;
};

// Lightweight, objective hints — not signals. Just surfacing patterns visible
// in the data the user might miss while scanning.
const decisionHints = (position, spot) => {
  const hints = [];
  const legs = (position.legs || []).filter((l) => (l.asset_type || '').toLowerCase() === 'option');
  if (!legs.length) return hints;

  const mathByLeg = legs.map((l) => ({ leg: l, math: computeLegMath(l, spot) }));

  // ITM short option close to expiration — assignment risk.
  for (const { leg, math } of mathByLeg) {
    const qty = parseFloat(leg.quantity || 0);
    const dte = daysUntil(parseDate(leg.expiration));
    if (qty < 0 && math.state === 'ITM' && dte !== null && dte <= 14) {
      hints.push({
        kind: 'risk',
        text: `Short ${leg.option_type} ${leg.strike} is ITM with ${dte}d to expiry — assignment risk`,
      });
    }
  }

  // Deep OTM short with little extrinsic left — close-to-zero candidate.
  for (const { leg, math } of mathByLeg) {
    const qty = parseFloat(leg.quantity || 0);
    const dte = daysUntil(parseDate(leg.expiration));
    if (
      qty < 0 &&
      math.state === 'OTM' &&
      math.extrinsic !== null &&
      math.extrinsic < 0.10 &&
      dte !== null && dte > 0
    ) {
      hints.push({
        kind: 'opportunity',
        text: `Short ${leg.option_type} ${leg.strike} extrinsic is ${fmtMoney(math.extrinsic)} — consider closing for near-max profit`,
      });
    }
  }

  // % of max profit captured (only for credit positions where cost_basis < 0,
  // i.e. net credit). Heuristic: if unrealized_pnl / |cost_basis| > 0.75.
  const cb = position.cost_basis != null ? parseFloat(position.cost_basis) : null;
  const pnl = position.unrealized_pnl != null ? parseFloat(position.unrealized_pnl) : null;
  if (cb !== null && pnl !== null && cb < 0) {
    const maxProfit = Math.abs(cb);
    const captured = pnl / maxProfit;
    if (captured >= 0.75) {
      hints.push({
        kind: 'opportunity',
        text: `${Math.round(captured * 100)}% of max profit captured — consider closing`,
      });
    }
  }

  return hints;
};

const HINT_STYLE = {
  risk: 'bg-red-50 border-red-200 text-red-800',
  opportunity: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const PositionDrillIn = ({ position, spot, spotFetchedAt }) => {
  const legs = (position.legs || []).filter((l) => (l.asset_type || '').toLowerCase() === 'option');
  const cb = position.cost_basis != null ? parseFloat(position.cost_basis) : null;
  const cv = position.current_value != null ? parseFloat(position.current_value) : null;
  const pnl = position.unrealized_pnl != null ? parseFloat(position.unrealized_pnl) : null;
  const dayPnl = position.current_day_pnl != null ? parseFloat(position.current_day_pnl) : null;
  const dayPnlPct = position.current_day_pnl_percentage != null
    ? parseFloat(position.current_day_pnl_percentage) : null;
  const pnlPct = cb !== null && cb !== 0 ? (pnl / Math.abs(cb)) * 100 : null;
  const held = daysSince(parseDate(position.entry_date));
  const hints = decisionHints(position, spot);
  const netTheta = legs.reduce((acc, l) => {
    const t = l.theta != null ? parseFloat(l.theta) : null;
    const q = l.quantity != null ? parseFloat(l.quantity) : 0;
    if (t === null) return acc;
    return acc + t * q * 100;  // option contracts represent 100 shares
  }, 0);

  const pnlColor = pnl === null ? 'text-gray-700' : pnl >= 0 ? 'text-emerald-700' : 'text-red-700';
  const dayColor = dayPnl === null ? 'text-gray-600' : dayPnl >= 0 ? 'text-emerald-600' : 'text-red-600';

  return (
    <div className="mt-2 ml-7 mr-1 bg-gray-50 border border-gray-200 rounded">
      {/* Position summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-3 py-2 border-b border-gray-200 text-xs">
        <div>
          <div className="text-gray-500">Underlying spot</div>
          <div className="font-medium text-gray-900 tabular-nums">
            {spot != null ? fmtMoney(spot) : '—'}
          </div>
          {spotFetchedAt && (
            <div className="text-[10px] text-gray-400">
              {new Date(spotFetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
        <div>
          <div className="text-gray-500">Unrealized P&amp;L</div>
          <div className={`font-medium tabular-nums ${pnlColor}`}>
            {pnl !== null ? fmtMoney(pnl, { signed: true }) : '—'}
            {pnlPct !== null && (
              <span className="text-[10px] ml-1 font-normal">
                ({fmtPct(pnlPct, { signed: true })})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Today</div>
          <div className={`font-medium tabular-nums ${dayColor}`}>
            {dayPnl !== null ? fmtMoney(dayPnl, { signed: true }) : '—'}
            {dayPnlPct !== null && (
              <span className="text-[10px] ml-1 font-normal">
                ({fmtPct(dayPnlPct, { signed: true })})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Days held</div>
          <div className="font-medium text-gray-900 tabular-nums">{held !== null ? `${held}d` : '—'}</div>
        </div>
        <div>
          <div className="text-gray-500">Cost basis</div>
          <div className="font-medium text-gray-900 tabular-nums">{cb !== null ? fmtMoney(cb, { signed: true }) : '—'}</div>
        </div>
        <div>
          <div className="text-gray-500">Current value</div>
          <div className="font-medium text-gray-900 tabular-nums">{cv !== null ? fmtMoney(cv, { signed: true }) : '—'}</div>
        </div>
        <div>
          <div className="text-gray-500">Net theta / day</div>
          <div className={`font-medium tabular-nums ${netTheta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {fmtMoney(netTheta, { signed: true })}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Maint. req.</div>
          <div className="font-medium text-gray-900 tabular-nums">
            {position.maintenance_requirement != null
              ? fmtMoney(position.maintenance_requirement)
              : '—'}
          </div>
        </div>
      </div>

      {/* Per-leg detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-white text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Leg</th>
              <th className="text-left px-2 py-1.5 font-medium">Exp</th>
              <th className="text-right px-2 py-1.5 font-medium">DTE</th>
              <th className="text-right px-2 py-1.5 font-medium">Mark</th>
              <th className="text-right px-2 py-1.5 font-medium">Δ</th>
              <th className="text-right px-2 py-1.5 font-medium">Θ</th>
              <th className="text-right px-2 py-1.5 font-medium">vs Spot</th>
              <th className="text-right px-2 py-1.5 font-medium">Intrinsic</th>
              <th className="text-right px-2 py-1.5 font-medium">Extrinsic</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, idx) => {
              const m = computeLegMath(leg, spot);
              const dte = daysUntil(parseDate(leg.expiration));
              const dteStyle = urgencyStyle(dte);
              const qty = parseFloat(leg.quantity || 0);
              const side = qty > 0 ? 'Long' : qty < 0 ? 'Short' : '';
              const cp = (leg.option_type || '').charAt(0).toUpperCase();
              const stateColor =
                m.state === 'ITM' ? 'text-amber-700 bg-amber-50' :
                m.state === 'OTM' ? 'text-gray-600 bg-gray-100' :
                m.state === 'ATM' ? 'text-blue-700 bg-blue-50' : 'text-gray-500';
              return (
                <tr key={idx} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className={qty < 0 ? 'text-red-700' : 'text-emerald-700'}>{side}</span>
                    {' '}{Math.abs(qty)} {cp}{leg.strike ?? ''}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">
                    {fmtExpiryShort(leg.expiration)}
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <span className={`text-[10px] px-1 rounded ${dteStyle.badge}`}>
                      {formatDaysLabel(dte)}
                    </span>
                  </td>
                  <td className="text-right px-2 py-1.5">{fmtMoney(leg.current_price)}</td>
                  <td className="text-right px-2 py-1.5">{fmtNum(leg.delta, 2)}</td>
                  <td className="text-right px-2 py-1.5">{fmtNum(leg.theta, 3)}</td>
                  <td className="text-right px-2 py-1.5">
                    {m.state ? (
                      <span className="inline-flex items-center gap-1">
                        <span className={`text-[10px] px-1 rounded ${stateColor}`}>{m.state}</span>
                        {m.moneyness !== null && (
                          <span className="text-gray-700">
                            {fmtMoney(Math.abs(m.moneyness))}
                            {m.moneynessPct !== null && (
                              <span className="text-gray-400 ml-0.5">
                                ({fmtPct(Math.abs(m.moneynessPct))})
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5">
                    {m.intrinsic !== null ? fmtMoney(m.intrinsic) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5">
                    {m.extrinsic !== null ? fmtMoney(m.extrinsic) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Decision hints */}
      {hints.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-200 space-y-1">
          {hints.map((h, idx) => (
            <div
              key={idx}
              className={`text-xs px-2 py-1 rounded border ${HINT_STYLE[h.kind] || HINT_STYLE.info}`}
            >
              {h.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AccountAttentionView = () => {
  const queryClient = useQueryClient();

  const restored = useRestoreSnapshot();
  const [selectedAccount, setSelectedAccount] = useState(() => restored?.selectedAccount ?? 'all');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(() => restored?.showFlaggedOnly ?? false);
  const [collapsedGroups, setCollapsedGroups] = useState(
    () => new Set(restored?.collapsedGroups ?? [])
  );
  const [expandedPositions, setExpandedPositions] = useState(
    () => new Set(restored?.expandedPositions ?? [])
  );
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Snapshot Sets as Arrays so they survive a structuredClone if we ever
  // serialize. In-memory it doesn't matter, but it's cheap insurance.
  useRememberPage('Account Attention', {
    selectedAccount,
    showFlaggedOnly,
    collapsedGroups: Array.from(collapsedGroups),
    expandedPositions: Array.from(expandedPositions),
  });

  const positionsQueryKey = ['schwab-attention-positions'];
  // Cache-only: backend serves cached spot quotes with no live Schwab fetch
  // and we don't refetch on focus/mount. Refresh happens via the global
  // sync button (which invalidates this key) or this view's own button.
  const { data: posData, isLoading: posLoading, error: posError, refetch, isFetching } = useQuery({
    queryKey: positionsQueryKey,
    queryFn: () => fetchActualPositions({ status: 'active' }),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const flagsQueryKey = ['position-flags'];
  const { data: flagsData } = useQuery({
    queryKey: flagsQueryKey,
    queryFn: fetchPositionFlags,
  });

  const positions = posData?.positions || [];
  const accounts = posData?.accounts || [];
  const underlyingQuotes = posData?.underlying_quotes || {};
  const flags = flagsData?.flags || {};

  const flagMutation = useMutation({
    mutationFn: ({ signature, patch }) => updatePositionFlag(signature, patch),
    onMutate: async ({ signature, patch }) => {
      await queryClient.cancelQueries({ queryKey: flagsQueryKey });
      const prev = queryClient.getQueryData(flagsQueryKey);
      queryClient.setQueryData(flagsQueryKey, (old) => {
        const nextFlags = { ...(old?.flags || {}) };
        const existing = nextFlags[signature] || { position_signature: signature, flagged: false, note: null };
        nextFlags[signature] = { ...existing, ...patch };
        return { ...(old || {}), flags: nextFlags };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(flagsQueryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: flagsQueryKey }),
  });

  const grouped = useMemo(() => {
    const filtered = positions.filter((p) => {
      if (selectedAccount !== 'all' && p.account_id !== selectedAccount) return false;
      if (!earliestOptionExpiration(p)) return false;
      if (showFlaggedOnly) {
        const f = p.schwab_position_signature ? flags[p.schwab_position_signature] : null;
        if (!f?.flagged) return false;
      }
      return true;
    });

    const byExp = new Map();
    for (const p of filtered) {
      const exp = earliestOptionExpiration(p);
      if (!byExp.has(exp)) byExp.set(exp, []);
      byExp.get(exp).push(p);
    }

    const groups = Array.from(byExp.entries())
      .map(([exp, list]) => ({
        expiration: exp,
        days: daysUntil(parseDate(exp)),
        positions: list.sort((a, b) => (a.underlying || a.symbol || '').localeCompare(b.underlying || b.symbol || '')),
      }))
      .sort((a, b) => (a.expiration || '').localeCompare(b.expiration || ''));

    return groups;
  }, [positions, flags, selectedAccount, showFlaggedOnly]);

  // On first load, collapse groups further than 30 days away; keep near-term
  // expanded. Skipped entirely when we restored from a nav-stack snapshot —
  // the user's explicit collapse state wins, even if it's "everything open."
  useEffect(() => {
    if (restored) return;
    if (!grouped.length) return;
    setCollapsedGroups((curr) => {
      if (curr.size > 0) return curr;
      const next = new Set();
      for (const g of grouped) {
        if (g.days !== null && g.days > 30) next.add(g.expiration);
      }
      return next;
    });
  }, [grouped.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (exp) => {
    setCollapsedGroups((curr) => {
      const next = new Set(curr);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const togglePosition = (id) => {
    setExpandedPositions((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFlag = (signature, currentlyFlagged) => {
    if (!signature) return;
    flagMutation.mutate({ signature, patch: { flagged: !currentlyFlagged } });
  };

  const startEditNote = (signature, currentNote) => {
    setNoteEditingId(signature);
    setNoteDraft(currentNote || '');
  };

  const saveNote = (signature) => {
    flagMutation.mutate({ signature, patch: { note: noteDraft || null } });
    setNoteEditingId(null);
    setNoteDraft('');
  };

  const flaggedCount = useMemo(() => {
    return Object.values(flags).filter((f) => f.flagged).length;
  }, [flags]);

  const totalAttentionCount = useMemo(
    () => grouped.reduce((acc, g) => acc + g.positions.length, 0),
    [grouped]
  );

  if (posLoading) {
    return (
      <div className="p-6">
        <div className="text-gray-600">Loading positions…</div>
      </div>
    );
  }

  if (posError) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Failed to load positions: {posError.message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Account Attention</h1>
          <p className="text-xs text-gray-500">
            Option positions grouped by earliest expiration. {totalAttentionCount} positions in view
            {flaggedCount > 0 && <> · {flaggedCount} flagged</>}.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 border border-gray-200 rounded">
        <label className="text-sm text-gray-700">
          Account:
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.account_hash || a.account_number} value={a.account_hash || ''}>
                {a.account_number} {a.account_type ? `(${a.account_type})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showFlaggedOnly}
            onChange={(e) => setShowFlaggedOnly(e.target.checked)}
            className="rounded"
          />
          Flagged only
        </label>

        <button
          onClick={() => {
            // Expand-all toggles between expanding every visible position and collapsing all.
            const visible = grouped.flatMap((g) => g.positions.map((p) => p.id));
            setExpandedPositions((curr) => {
              if (visible.every((id) => curr.has(id))) return new Set();
              return new Set(visible);
            });
          }}
          className="ml-auto text-xs px-2 py-1 border border-gray-300 rounded hover:bg-white text-gray-700"
        >
          Expand / collapse all
        </button>
      </div>

      {/* Groups */}
      {grouped.length === 0 ? (
        <div className="p-8 text-center text-gray-500 border border-dashed border-gray-300 rounded">
          {showFlaggedOnly
            ? 'No flagged option positions.'
            : 'No option positions in this account.'}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            const isCollapsed = collapsedGroups.has(group.expiration);
            const style = urgencyStyle(group.days);
            return (
              <div key={group.expiration} className="border border-gray-200 rounded overflow-hidden bg-white">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.expiration)}
                  className="w-full flex items-center gap-3 px-3 py-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 text-left"
                >
                  <div className={`w-1 h-8 rounded ${style.bar}`} />
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {fmtExpiryHeader(group.expiration)}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${style.badge}`}>
                        {formatDaysLabel(group.days)}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm text-gray-600 flex-shrink-0">
                    {group.positions.length} position{group.positions.length === 1 ? '' : 's'}
                  </span>
                </button>

                {/* Positions */}
                {!isCollapsed && (
                  <div className="divide-y divide-gray-100">
                    {group.positions.map((p) => {
                      const sig = p.schwab_position_signature;
                      const flag = sig ? flags[sig] : null;
                      const isFlagged = !!flag?.flagged;
                      const note = flag?.note || '';
                      const editing = noteEditingId === sig;
                      const isExpanded = expandedPositions.has(p.id);
                      const optionLegs = (p.legs || []).filter(
                        (l) => (l.asset_type || '').toLowerCase() === 'option'
                      );
                      const undKey = (p.underlying || p.symbol || '').toUpperCase();
                      const quote = underlyingQuotes[undKey];
                      const spot = quote?.last_price ?? null;
                      return (
                        <div key={p.id} className="px-3 py-2 hover:bg-gray-50">
                          <div className="flex items-start gap-3">
                            {/* Drill-in toggle */}
                            <button
                              onClick={() => togglePosition(p.id)}
                              className="mt-0.5 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"
                              title={isExpanded ? 'Collapse details' : 'Expand details'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>

                            {/* Flag toggle */}
                            <button
                              onClick={() => toggleFlag(sig, isFlagged)}
                              disabled={!sig}
                              title={sig ? (isFlagged ? 'Remove flag' : 'Flag for attention') : 'No signature — cannot flag'}
                              className={`mt-0.5 p-1 rounded flex-shrink-0 ${
                                isFlagged
                                  ? 'text-amber-600 hover:bg-amber-50'
                                  : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              <Flag className={`w-4 h-4 ${isFlagged ? 'fill-current' : ''}`} />
                            </button>

                            {/* Main content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => togglePosition(p.id)}
                                  className="font-semibold text-gray-900 hover:text-blue-700 text-left"
                                >
                                  {p.underlying || p.symbol}
                                </button>
                                <span className="text-xs text-gray-500">
                                  {strategyLabel(p.strategy_type)}
                                </span>
                                {spot != null && (
                                  <span className="text-xs text-gray-600 tabular-nums">
                                    @ {fmtMoney(spot)}
                                  </span>
                                )}
                                {p.unrealized_pnl != null && (
                                  <span className={`text-xs tabular-nums ${
                                    parseFloat(p.unrealized_pnl) >= 0 ? 'text-emerald-700' : 'text-red-700'
                                  }`}>
                                    {fmtMoney(parseFloat(p.unrealized_pnl), { signed: true })}
                                  </span>
                                )}
                                {p.account_number && (
                                  <span className="text-xs text-gray-400">
                                    {p.account_number}
                                  </span>
                                )}
                              </div>
                              {!isExpanded && (
                                <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                                  {optionLegs.map((leg, idx) => {
                                    const legDays = daysUntil(parseDate(leg.expiration));
                                    const legStyle = urgencyStyle(legDays);
                                    const qty = leg.quantity;
                                    const side = qty > 0 ? 'Long' : qty < 0 ? 'Short' : '';
                                    const cp = (leg.option_type || '').charAt(0).toUpperCase();
                                    return (
                                      <div key={idx} className="flex items-center gap-2">
                                        <span className="tabular-nums">
                                          {side} {Math.abs(qty || 0)} {cp}{leg.strike ?? ''} {fmtExpiryShort(leg.expiration)}
                                        </span>
                                        {legDays !== null && (
                                          <span className={`text-[10px] px-1 rounded ${legStyle.badge}`}>
                                            {formatDaysLabel(legDays)}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Note display / edit */}
                              {editing ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveNote(sig);
                                      if (e.key === 'Escape') { setNoteEditingId(null); setNoteDraft(''); }
                                    }}
                                    autoFocus
                                    placeholder="Add a note…"
                                    className="flex-1 text-sm border border-gray-300 rounded px-2 py-1"
                                  />
                                  <button
                                    onClick={() => saveNote(sig)}
                                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => { setNoteEditingId(null); setNoteDraft(''); }}
                                    className="text-xs p-1 text-gray-500 hover:text-gray-700"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : note ? (
                                <div className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                  <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-600" />
                                  <span className="flex-1">{note}</span>
                                  <button
                                    onClick={() => startEditNote(sig, note)}
                                    className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                                    title="Edit note"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : null}

                              {/* Drill-in panel */}
                              {isExpanded && (
                                <PositionDrillIn
                                  position={p}
                                  spot={spot}
                                  spotFetchedAt={quote?.fetched_at}
                                />
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {!editing && !note && sig && (
                                <button
                                  onClick={() => startEditNote(sig, '')}
                                  className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                                  title="Add note"
                                >
                                  <StickyNote className="w-4 h-4" />
                                </button>
                              )}
                              <Link
                                to={`/schwab/transactions/${encodeURIComponent(p.underlying || p.symbol)}${
                                  p.account_id ? `?account=${p.account_id}` : ''
                                }`}
                                className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                                title="View transactions"
                              >
                                <History className="w-4 h-4" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AccountAttentionView;
