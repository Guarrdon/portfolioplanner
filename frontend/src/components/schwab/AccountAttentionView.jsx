/**
 * AccountAttentionView — account-level "what needs attention" screen.
 *
 * Positions are grouped by earliest option-leg expiration. Stock-only positions
 * are excluded (no expiration to surface). Groups self-hide when empty.
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

const DAY_MS = 24 * 60 * 60 * 1000;

const parseExpiry = (iso) => {
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

const fmtExpiryHeader = (iso) => {
  const d = parseExpiry(iso);
  if (!d) return iso || '-';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday} ${month} ${d.getDate()}, ${d.getFullYear()}`;
};

const fmtExpiryShort = (iso) => {
  const d = parseExpiry(iso);
  if (!d) return '';
  const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `${d.getDate()}${mon}${String(d.getFullYear()).slice(-2)}`;
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

const AccountAttentionView = () => {
  const queryClient = useQueryClient();

  const [selectedAccount, setSelectedAccount] = useState('all');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const positionsQueryKey = ['schwab-attention-positions'];
  const { data: posData, isLoading: posLoading, error: posError, refetch, isFetching } = useQuery({
    queryKey: positionsQueryKey,
    queryFn: () => fetchActualPositions({ status: 'active' }),
  });

  const flagsQueryKey = ['position-flags'];
  const { data: flagsData } = useQuery({
    queryKey: flagsQueryKey,
    queryFn: fetchPositionFlags,
  });

  const positions = posData?.positions || [];
  const accounts = posData?.accounts || [];
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
        days: daysUntil(parseExpiry(exp)),
        positions: list.sort((a, b) => (a.underlying || a.symbol || '').localeCompare(b.underlying || b.symbol || '')),
      }))
      .sort((a, b) => (a.expiration || '').localeCompare(b.expiration || ''));

    return groups;
  }, [positions, flags, selectedAccount, showFlaggedOnly]);

  // On first load, collapse groups further than 30 days away; keep near-term expanded.
  useEffect(() => {
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
                      const optionLegs = (p.legs || []).filter(
                        (l) => (l.asset_type || '').toLowerCase() === 'option'
                      );
                      return (
                        <div key={p.id} className="px-3 py-2 hover:bg-gray-50">
                          <div className="flex items-start gap-3">
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
                                <span className="font-semibold text-gray-900">
                                  {p.underlying || p.symbol}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {strategyLabel(p.strategy_type)}
                                </span>
                                {p.account_number && (
                                  <span className="text-xs text-gray-400">
                                    {p.account_number}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                                {optionLegs.map((leg, idx) => {
                                  const legDays = daysUntil(parseExpiry(leg.expiration));
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
