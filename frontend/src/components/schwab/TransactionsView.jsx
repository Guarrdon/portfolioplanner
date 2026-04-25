/**
 * TransactionsView — per-underlying live transaction history from Schwab.
 *
 * Entry: linked from the Schwab Positions row.
 * Route: /schwab/transactions/:underlying?account=<account_hash>
 */
import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, RefreshCw, EyeOff, Eye, StickyNote, Link2, Link2Off, Pencil, X,
  ChevronDown, ChevronRight, Search,
} from 'lucide-react';
import {
  fetchTransactionsByUnderlying,
  fetchOpenPositionsForUnderlying,
  updateTransactionAnnotation,
  linkTransactions,
  unlinkTransactions,
  updateLinkGroup,
} from '../../services/transactions';
import { fetchActualPositions } from '../../services/schwab';

const fmtCurrency = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
};

const fmtQty = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 4,
  }).format(v);
};

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // Display as: "Apr 24, 26 10:52a" — date plus local time so intraday ordering
  // is visible. Schwab returns full ISO datetimes; we already sort by them.
  const datePart = d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' });
  const hour = d.getHours();
  const min = d.getMinutes();
  if (hour === 0 && min === 0) return datePart; // midnight likely means "no time provided"
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? 'a' : 'p';
  const mm = String(min).padStart(2, '0');
  return `${datePart} ${h12}:${mm}${ampm}`;
};

const fmtExpiry = (iso) => {
  if (!iso) return '';
  const d = new Date(typeof iso === 'string' ? (iso.length === 10 ? iso + 'T00:00:00' : iso) : iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getDate()}${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()}${String(d.getFullYear()).slice(-2)}`;
};

const fmtOptionSymbol = (leg) => {
  if (!leg) return '';
  const assetType = (leg.asset_type || '').toUpperCase();
  if (assetType !== 'OPTION' && assetType !== 'OPT') return leg.symbol || '';
  const strike = leg.strike != null ? Math.round(parseFloat(leg.strike)) : '';
  const underlying = leg.underlying || '';
  const cp = leg.option_type ? leg.option_type.charAt(0).toUpperCase() : '';
  return `${underlying} ${fmtExpiry(leg.expiration)} ${cp}${strike}`.trim();
};

// Deterministic color palette keyed by group_id hash. No calc impact, visual only.
const LINK_COLORS = [
  { bar: 'bg-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-300' },
  { bar: 'bg-sky-500',     bg: 'bg-sky-50',     text: 'text-sky-800',     border: 'border-sky-300' },
  { bar: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
  { bar: 'bg-fuchsia-500', bg: 'bg-fuchsia-50', text: 'text-fuchsia-800', border: 'border-fuchsia-300' },
  { bar: 'bg-rose-500',    bg: 'bg-rose-50',    text: 'text-rose-800',    border: 'border-rose-300' },
  { bar: 'bg-indigo-500',  bg: 'bg-indigo-50',  text: 'text-indigo-800',  border: 'border-indigo-300' },
  { bar: 'bg-lime-600',    bg: 'bg-lime-50',    text: 'text-lime-800',    border: 'border-lime-300' },
  { bar: 'bg-cyan-600',    bg: 'bg-cyan-50',    text: 'text-cyan-800',    border: 'border-cyan-300' },
];

// Color is assigned by a group's G-index (order of first appearance), so the
// first 8 groups always have distinct colors. Falls back to a stable hash for
// any caller that doesn't have access to the index map.
const hashStr = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const colorForGroup = (gid, indexByGroupId) => {
  if (indexByGroupId && indexByGroupId.has(gid)) {
    return LINK_COLORS[indexByGroupId.get(gid) % LINK_COLORS.length];
  }
  return LINK_COLORS[hashStr(gid) % LINK_COLORS.length];
};

// Frontend mirror of the backend summary calc — used for optimistic updates.
const computeSummary = (transactions, annotations) => {
  let stock = 0, opt = 0, hidden = 0, visible = 0;
  for (const t of transactions) {
    const ann = annotations[t.schwab_transaction_id] || {};
    if (ann.hidden) { hidden++; continue; }
    visible++;
    const amt = parseFloat(t.net_amount) || 0;
    if (t.category === 'stock') stock += amt;
    else if (t.category === 'option') opt += amt;
    else stock += amt;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    visible_count: visible,
    hidden_count: hidden,
    stock_net_cash: r2(stock),
    options_net_cash: r2(opt),
    total_net_cash: r2(stock + opt),
  };
};

const TransactionsView = () => {
  const { underlying } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const accountId = searchParams.get('account') || null;
  const queryClient = useQueryClient();

  const [days, setDays] = useState(365);
  const [typeFilter, setTypeFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [groupEditId, setGroupEditId] = useState(null);
  const [positionCollapsed, setPositionCollapsed] = useState(false);
  const [rollupCollapsed, setRollupCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [transactionsCollapsed, setTransactionsCollapsed] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState('');

  // Account list piggy-backs on the positions endpoint, which returns the user's
  // accounts alongside positions. Cached so opening this view doesn't refetch.
  const { data: accountsData } = useQuery({
    queryKey: ['schwab-accounts-list'],
    queryFn: () => fetchActualPositions(),
    staleTime: 5 * 60 * 1000,
  });
  const accounts = accountsData?.accounts || [];

  const navigateTo = (nextUnderlying, nextAccountId) => {
    const sym = (nextUnderlying || underlying || '').trim().toUpperCase();
    if (!sym) return;
    const qs = nextAccountId ? `?account=${encodeURIComponent(nextAccountId)}` : '';
    navigate(`/schwab/transactions/${encodeURIComponent(sym)}${qs}`);
  };

  const handleAccountChange = (e) => {
    const next = e.target.value || null;
    navigateTo(underlying, next);
  };

  const submitSymbolSearch = (e) => {
    e.preventDefault();
    if (!symbolDraft.trim()) return;
    navigateTo(symbolDraft, accountId);
    setSymbolDraft('');
  };

  const queryKey = useMemo(
    () => ['transactions', underlying, accountId, days],
    [underlying, accountId, days]
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchTransactionsByUnderlying(underlying, { accountId, days }),
    enabled: !!underlying,
  });

  // Current open positions for this underlying — live-fetched from Schwab so
  // we see actual contract counts rather than strategy-group-duplicated DB rows.
  const openPosKey = ['open-positions', underlying, accountId];
  const { data: openPositionsData } = useQuery({
    queryKey: openPosKey,
    queryFn: () => fetchOpenPositionsForUnderlying(underlying, { accountId }),
    enabled: !!underlying,
  });

  const annMutation = useMutation({
    mutationFn: ({ txId, patch }) => updateTransactionAnnotation(txId, patch),
    onMutate: async ({ txId, patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        const existing = annotations[txId] || { hidden: false };
        annotations[txId] = { ...existing, ...patch };
        const summary = computeSummary(old.transactions || [], annotations);
        return { ...old, annotations, summary };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const linkMutation = useMutation({
    mutationFn: ({ txIds, groupId }) => linkTransactions(txIds, groupId),
    onMutate: async ({ txIds, groupId }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      const tempId = groupId || `tmp-${Math.random().toString(36).slice(2, 10)}`;
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        const link_groups = { ...(old.link_groups || {}) };
        for (const id of txIds) {
          annotations[id] = { ...(annotations[id] || { hidden: false }), link_group_id: tempId };
        }
        if (!link_groups[tempId]) {
          link_groups[tempId] = { id: tempId, name: null, note: null };
        }
        return { ...old, annotations, link_groups };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unlinkMutation = useMutation({
    mutationFn: ({ txIds }) => unlinkTransactions(txIds),
    onMutate: async ({ txIds }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        for (const id of txIds) {
          if (annotations[id]) annotations[id] = { ...annotations[id], link_group_id: null };
        }
        return { ...old, annotations };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const groupMutation = useMutation({
    mutationFn: ({ groupId, patch }) => updateLinkGroup(groupId, patch),
    onMutate: async ({ groupId, patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const link_groups = { ...(old.link_groups || {}) };
        link_groups[groupId] = { ...(link_groups[groupId] || { id: groupId }), ...patch };
        return { ...old, link_groups };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const transactions = data?.transactions || [];
  const annotations = data?.annotations || {};
  const linkGroupsMeta = data?.link_groups || {};
  const summary = data?.summary || { visible_count: 0, hidden_count: 0, stock_net_cash: 0, options_net_cash: 0, total_net_cash: 0 };

  const types = useMemo(() => {
    const s = new Set();
    transactions.forEach(t => t.type && s.add(t.type));
    return Array.from(s).sort();
  }, [transactions]);

  const visibleRows = useMemo(() => {
    return transactions.filter(t => {
      const ann = annotations[t.schwab_transaction_id] || {};
      if (ann.hidden && !showHidden) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      return true;
    });
  }, [transactions, annotations, showHidden, typeFilter]);

  const toggleHidden = (tx) => {
    const current = annotations[tx.schwab_transaction_id]?.hidden || false;
    annMutation.mutate({ txId: tx.schwab_transaction_id, patch: { hidden: !current } });
  };

  const setDisposition = (tx, disposition) => {
    annMutation.mutate({ txId: tx.schwab_transaction_id, patch: { disposition } });
  };

  const saveNote = (tx) => {
    annMutation.mutate({ txId: tx.schwab_transaction_id, patch: { note: noteDraft } });
    setNoteEditingId(null);
    setNoteDraft('');
  };

  const toggleSelect = (txId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId); else next.add(txId);
      return next;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedGroupIds = useMemo(() => {
    const gs = new Set();
    selectedIds.forEach(id => { gs.add(annotations[id]?.link_group_id || null); });
    return gs;
  }, [selectedIds, annotations]);

  const handleGroup = () => {
    if (selectedIds.length < 1) return;
    const existingGroups = [...selectedGroupIds].filter(Boolean);
    const gid = existingGroups.length === 1 ? existingGroups[0] : null;
    linkMutation.mutate({ txIds: selectedIds, groupId: gid });
    setSelected(new Set());
  };

  const handleUngroup = () => {
    if (selectedIds.length === 0) return;
    unlinkMutation.mutate({ txIds: selectedIds });
    setSelected(new Set());
  };

  // Disposition applies to any transaction with at least one option leg — both
  // opens (to tag expirations that left no closing transaction) and closes.
  const hasOptionLeg = (tx) => (tx.legs || []).some(l => (l.asset_type || '').toUpperCase() === 'OPTION');

  // Per-group label ("G1", "G2", …) ordered by GROUP CREATION TIME (not by
  // transaction date), so a group you just made gets the highest G-number even
  // if its earliest transaction is years old. Index drives color assignment so
  // the first 8 groups always have distinct colors.
  const { groupLabels, indexByGroupId } = useMemo(() => {
    const gids = new Set();
    const firstAppearance = new Map();
    let order = 0;
    for (const t of transactions) {
      const g = annotations[t.schwab_transaction_id]?.link_group_id;
      if (g) {
        gids.add(g);
        if (!firstAppearance.has(g)) firstAppearance.set(g, order++);
      }
    }
    const arr = [...gids].sort((a, b) => {
      const ca = linkGroupsMeta[a]?.created_at;
      const cb = linkGroupsMeta[b]?.created_at;
      if (ca && cb) return ca.localeCompare(cb);
      if (ca) return -1;
      if (cb) return 1;
      return (firstAppearance.get(a) ?? 0) - (firstAppearance.get(b) ?? 0);
    });
    const labels = new Map();
    const idx = new Map();
    arr.forEach((g, i) => {
      labels.set(g, `G${i + 1}`);
      idx.set(g, i);
    });
    return { groupLabels: labels, indexByGroupId: idx };
  }, [transactions, annotations, linkGroupsMeta]);

  // Build a map: normalized OCC symbol → current market price. Used to show
  // inline "currently trading at" on each transaction leg whose contract is
  // still open today.
  const livePriceBySymbol = useMemo(() => {
    const map = new Map();
    (openPositionsData?.options || []).forEach(o => {
      if (o.symbol && o.current_price != null) {
        map.set(normalizeSymbol(o.symbol), parseFloat(o.current_price));
      }
    });
    // Also index the underlying stock price under its ticker
    if (openPositionsData?.stock && openPositionsData.stock.quantity !== 0) {
      // Derive per-share price from value/qty
      const q = parseFloat(openPositionsData.stock.quantity) || 0;
      const v = parseFloat(openPositionsData.stock.current_value) || 0;
      if (q !== 0) map.set(normalizeSymbol(underlying), v / q);
    }
    return map;
  }, [openPositionsData, underlying]);

  const currentPriceForLeg = (leg) => {
    if (!leg?.symbol) return null;
    const p = livePriceBySymbol.get(normalizeSymbol(leg.symbol));
    return p == null ? null : p;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm px-4 py-2 flex items-center gap-3">
        <Link to="/schwab/positions" className="text-gray-500 hover:text-gray-800" title="Back to positions">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-bold text-gray-900">{underlying} Transactions</h1>

        <select
          value={accountId || ''}
          onChange={handleAccountChange}
          className="px-2 py-1 text-xs border border-gray-300 rounded font-semibold focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          title="Account"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.account_hash} value={a.account_hash}>
              Account: {a.account_number}
            </option>
          ))}
        </select>

        <form onSubmit={submitSymbolSearch} className="flex items-center">
          <div className="relative">
            <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={symbolDraft}
              onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
              placeholder="Symbol…"
              className="pl-6 pr-2 py-1 text-xs border border-gray-300 rounded w-24 focus:w-36 transition-all uppercase focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="px-2 py-1 text-xs border border-gray-300 rounded">
            <option value={30}>30d</option>
            <option value={90}>90d</option>
            <option value={180}>180d</option>
            <option value={365}>365d</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-2 py-1 text-xs border border-gray-300 rounded">
            <option value="">All Types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
            Show hidden
          </label>
          <button onClick={() => refetch()} disabled={isFetching} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50" title="Refresh">
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Current open position strip */}
      <CurrentPositionStrip
        data={openPositionsData}
        realized={summary.total_net_cash}
        collapsed={positionCollapsed}
        onToggleCollapsed={() => setPositionCollapsed(v => !v)}
      />

      {/* Group/ungrouped rollup strip */}
      <RollupStrip
        transactions={transactions}
        annotations={annotations}
        linkGroupsMeta={linkGroupsMeta}
        groupLabels={groupLabels}
        indexByGroupId={indexByGroupId}
        livePriceBySymbol={livePriceBySymbol}
        visibleCount={summary.visible_count}
        hiddenCount={summary.hidden_count}
        onEditGroup={(gid) => setGroupEditId(gid)}
        collapsed={rollupCollapsed}
        onToggleCollapsed={() => setRollupCollapsed(v => !v)}
        expandedGroups={expandedGroups}
        onToggleExpandGroup={(key) => {
          setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          });
        }}
      />

      {/* Selection bar (only visible when rows are selected) */}
      {selectedIds.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-3 text-xs">
          <span className="font-medium text-blue-900">{selectedIds.length} selected</span>
          <button
            onClick={handleGroup}
            disabled={selectedIds.length < 1}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="Group selected rows"
          >
            <Link2 className="w-3 h-3" /> Group
          </button>
          <button onClick={handleUngroup} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300" title="Remove selected from their group">
            <Link2Off className="w-3 h-3" /> Ungroup
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-700 hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {/* Transactions table header (collapsible) */}
      <div className="bg-white border-b px-4 py-2">
        <div className="border border-gray-200 rounded-lg">
          <button
            onClick={() => setTransactionsCollapsed(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-left rounded-t-lg"
          >
            {transactionsCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
            <span className="text-sm font-bold text-gray-900">Transactions</span>
            <span className="text-xs text-gray-500">
              {transactions.length} in window · {visibleRows.length} showing
            </span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={`${transactionsCollapsed ? 'hidden' : 'flex-1'} overflow-auto`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 m-4 rounded">
            {error?.response?.data?.detail || error.message}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No transactions in this window.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-100 sticky top-0 z-10 border-b">
              <tr>
                <th className="text-center px-1 py-1.5 font-semibold w-8"></th>
                <th className="text-center px-1 py-1.5 font-semibold w-8"></th>
                <th className="text-left px-2 py-1.5 font-semibold w-24">Date</th>
                <th className="text-left px-2 py-1.5 font-semibold w-24">Type</th>
                <th className="text-left px-2 py-1.5 font-semibold w-16">Account</th>
                <th className="text-left px-2 py-1.5 font-semibold">Symbol / Legs</th>
                <th className="text-right px-2 py-1.5 font-semibold w-16">Qty</th>
                <th className="text-right px-2 py-1.5 font-semibold w-20">Price</th>
                <th className="text-right px-2 py-1.5 font-semibold w-20">Current</th>
                <th className="text-right px-2 py-1.5 font-semibold w-24">If Now</th>
                <th className="text-right px-2 py-1.5 font-semibold w-24">Net Cash</th>
                <th className="text-left px-2 py-1.5 font-semibold w-28">Disposition</th>
                <th className="text-left px-2 py-1.5 font-semibold w-48">Note</th>
                <th className="text-center px-2 py-1.5 font-semibold w-12">Hide</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {visibleRows.map(tx => {
                const ann = annotations[tx.schwab_transaction_id] || {};
                const editing = noteEditingId === tx.schwab_transaction_id;
                const showDisposition = hasOptionLeg(tx);
                const net = parseFloat(tx.net_amount || 0);
                const isSelected = selected.has(tx.schwab_transaction_id);
                const gid = ann.link_group_id;
                const color = gid ? colorForGroup(gid, indexByGroupId) : null;
                const groupLabel = gid ? groupLabels.get(gid) : null;
                return (
                  <tr
                    key={tx.schwab_transaction_id}
                    className={`border-b border-gray-100 hover:bg-blue-50 ${ann.hidden ? 'opacity-50' : ''} ${color ? color.bg : ''} ${isSelected ? 'ring-2 ring-inset ring-blue-300' : ''}`}
                  >
                    <td className="px-1 py-1.5 text-center">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(tx.schwab_transaction_id)} />
                    </td>
                    <td className={`px-0 py-0 w-2 ${color ? color.bar : ''}`}>
                      {groupLabel && (
                        <button
                          className={`block text-[10px] font-bold text-white text-center py-0.5 w-full ${color.bar} hover:brightness-110`}
                          onClick={() => setGroupEditId(gid)}
                          title="Edit group name / note"
                        >
                          {groupLabel}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">{fmtDate(tx.date)}</td>
                    <td className="px-2 py-1.5 text-gray-700">{tx.type}</td>
                    <td className="px-2 py-1.5 text-gray-500">{tx.account_number}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-col gap-0.5">
                        {tx.legs.map((leg, i) => {
                          const isOpt = (leg.asset_type || '').toUpperCase() === 'OPTION';
                          return (
                            <div key={i} className="flex items-center gap-2">
                              {isOpt ? (
                                <span className={`px-1 py-0.5 text-[10px] font-bold rounded ${leg.option_type === 'call' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'}`}>
                                  {leg.option_type === 'call' ? 'C' : 'P'}
                                </span>
                              ) : (
                                <span className="px-1 py-0.5 text-[10px] font-bold rounded bg-gray-300 text-gray-800">S</span>
                              )}
                              <span className="font-mono text-gray-900">{isOpt ? fmtOptionSymbol(leg) : (leg.symbol || '')}</span>
                              {leg.position_effect && (<span className="text-[10px] text-gray-500">{leg.position_effect}</span>)}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-800">
                      {tx.legs.map((l, i) => (
                        <div key={i} className={l.amount < 0 ? 'text-red-600' : 'text-green-700'}>
                          {l.amount != null ? (l.amount > 0 ? `+${fmtQty(l.amount)}` : fmtQty(l.amount)) : '-'}
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-700">
                      {tx.legs.map((l, i) => (
                        <div key={i}>{l.price != null ? fmtCurrency(l.price) : '-'}</div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-700">
                      {tx.legs.map((l, i) => {
                        // Only show Current / If Now for OPENING legs — a CLOSING
                        // leg is already realized, "if reversed now" makes no sense.
                        const isClosing = (l.position_effect || '').toUpperCase() === 'CLOSING';
                        const cur = isClosing ? null : currentPriceForLeg(l);
                        return (
                          <div key={i} className={cur != null ? '' : 'text-gray-300'}>
                            {cur != null ? fmtCurrency(cur) : '—'}
                          </div>
                        );
                      })}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {tx.legs.map((l, i) => {
                        const isClosing = (l.position_effect || '').toUpperCase() === 'CLOSING';
                        const cur = isClosing ? null : currentPriceForLeg(l);
                        const mult = (l.asset_type || '').toUpperCase() === 'OPTION' ? 100 : 1;
                        const traded = l.price != null ? parseFloat(l.price) : null;
                        const amt = l.amount != null ? parseFloat(l.amount) : null;
                        let reverse = null;
                        if (cur != null && traded != null && amt != null) {
                          reverse = (cur - traded) * amt * mult;
                        }
                        return (
                          <div key={i} className={reverse == null ? 'text-gray-300' : reverse > 0 ? 'text-green-700' : reverse < 0 ? 'text-red-700' : 'text-gray-600'}>
                            {reverse == null ? '—' : (reverse > 0 ? '+' : '') + fmtCurrency(reverse)}
                          </div>
                        );
                      })}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                      {fmtCurrency(net)}
                    </td>
                    <td className="px-2 py-1.5">
                      {showDisposition ? (
                        <select
                          value={ann.disposition || ''}
                          onChange={e => setDisposition(tx, e.target.value)}
                          className="text-xs border rounded px-1 py-0.5"
                        >
                          <option value="">—</option>
                          <option value="closed">Closed</option>
                          <option value="rolled">Rolled</option>
                          <option value="expired">Expired</option>
                          <option value="assigned">Assigned</option>
                        </select>
                      ) : (<span className="text-gray-300 text-xs">—</span>)}
                    </td>
                    <td className="px-2 py-1.5">
                      {editing ? (
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            value={noteDraft}
                            onChange={e => setNoteDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveNote(tx); if (e.key === 'Escape') { setNoteEditingId(null); setNoteDraft(''); } }}
                            className="text-xs border rounded px-1 py-0.5 flex-1"
                          />
                          <button onClick={() => saveNote(tx)} className="text-xs text-blue-600">Save</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setNoteEditingId(tx.schwab_transaction_id); setNoteDraft(ann.note || ''); }}
                          className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 group"
                        >
                          <StickyNote className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                          <span className="truncate max-w-[160px]">{ann.note || <span className="italic text-gray-400">add note</span>}</span>
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleHidden(tx)} className="text-gray-500 hover:text-gray-900" title={ann.hidden ? 'Show' : 'Hide'}>
                        {ann.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Status bar */}
      <div className="bg-white border-t px-3 py-1 text-xs text-gray-600 flex items-center gap-3">
        <span>{transactions.length} transactions in window • showing {visibleRows.length}</span>
        {groupLabels.size > 0 && (
          <span className="ml-auto flex items-center gap-2 flex-wrap">
            <span className="text-gray-500">Groups:</span>
            {[...groupLabels.entries()].map(([gid, label]) => {
              const c = colorForGroup(gid, indexByGroupId);
              const meta = linkGroupsMeta[gid] || {};
              return (
                <button
                  key={gid}
                  onClick={() => setGroupEditId(gid)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.bg} ${c.text} ${c.border} border hover:brightness-105`}
                  title={meta.note || 'Click to edit'}
                >
                  <span className={`inline-block w-2 h-2 rounded ${c.bar}`} />
                  {label}
                  {meta.name && <span className="font-normal">— {meta.name}</span>}
                </button>
              );
            })}
          </span>
        )}
      </div>

      {/* Group editor modal */}
      {groupEditId && (
        <GroupEditorModal
          groupId={groupEditId}
          label={groupLabels.get(groupEditId)}
          meta={linkGroupsMeta[groupEditId] || {}}
          indexByGroupId={indexByGroupId}
          onClose={() => setGroupEditId(null)}
          onSave={(patch) => {
            groupMutation.mutate({ groupId: groupEditId, patch });
            setGroupEditId(null);
          }}
        />
      )}
    </div>
  );
};

const normalizeSymbol = (s) => (s || '').toUpperCase().replace(/\s+/g, '');

const CurrentPositionStrip = ({ data, realized, collapsed, onToggleCollapsed }) => {
  if (!data) {
    return (
      <div className="bg-white border-b px-4 py-2 text-xs text-gray-500 italic">
        Loading current position…
      </div>
    );
  }

  const stock = data.stock || { quantity: 0, average_cost: 0, cost_basis: 0, current_value: 0, unrealized_pnl: 0 };
  const optionLegs = (data.options || []).map(o => ({
    ...o,
    premium: o.open_price,  // keep old key name for fmtOptionSymbol
    asset_type: 'option',
    pnl: o.unrealized_pnl,
  }));

  const hasStock = Math.abs(parseFloat(stock.quantity) || 0) > 0;
  const hasOptions = optionLegs.length > 0;
  if (!hasStock && !hasOptions) {
    return (
      <div className="bg-white border-b px-4 py-2 text-xs text-gray-500 italic">
        No open position for this underlying.
      </div>
    );
  }

  const stockQty = parseFloat(stock.quantity) || 0;
  const stockCost = Math.abs(parseFloat(stock.cost_basis) || 0);      // magnitude, always positive
  const stockMarketValue = Math.abs(parseFloat(stock.current_value) || 0);
  const stockNet = parseFloat(stock.unrealized_pnl) || 0;             // signed P&L
  const stockAvg = parseFloat(stock.average_cost) || 0;

  // Rows use always-positive magnitudes for Cost / Credits / Current Value.
  // Direction is conveyed by the signed qty next to the symbol. Net is signed.
  const rows = [];
  if (hasStock) {
    const isLong = stockQty > 0;
    rows.push({
      kind: 'stock',
      symbol: data.underlying,
      qty: stockQty,
      avgPrice: stockAvg,
      cost: isLong ? stockCost : 0,
      credits: !isLong ? stockCost : 0,
      currentValue: stockMarketValue,
      net: stockNet,
    });
  }
  for (const o of optionLegs) {
    const qty = parseFloat(o.quantity) || 0;
    const openPrice = parseFloat(o.open_price) || 0;
    const curPrice = parseFloat(o.current_price) || 0;
    const mult = 100;
    const absQty = Math.abs(qty);
    const costOrCredit = absQty * openPrice * mult;   // positive
    const marketValue = absQty * curPrice * mult;      // positive
    const isLong = qty > 0;
    rows.push({
      kind: 'option',
      option_type: o.option_type,
      underlying: o.underlying,
      strike: o.strike,
      expiration: o.expiration,
      symbol: o.symbol,
      qty,
      avgPrice: openPrice,
      cost: isLong ? costOrCredit : 0,
      credits: !isLong ? costOrCredit : 0,
      currentValue: marketValue,
      net: parseFloat(o.unrealized_pnl) || 0,
    });
  }

  const totals = rows.reduce((a, r) => ({
    cost: a.cost + r.cost,
    credits: a.credits + r.credits,
    currentValue: a.currentValue + r.currentValue,
    net: a.net + r.net,
  }), { cost: 0, credits: 0, currentValue: 0, net: 0 });

  const sign = (v) => (v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-500');
  const blank = <span className="text-gray-300">—</span>;

  return (
    <div className="bg-white border-b px-4 py-2">
      <div className="border border-gray-200 rounded-lg">
        <button
          onClick={onToggleCollapsed}
          className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 hover:bg-gray-100 text-left"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
          <span className="text-sm font-bold text-gray-900">Current Open Position</span>
          <span className="text-xs text-gray-500">
            {hasStock ? `${fmtQty(stockQty)} shares` : 'no shares'}
            {hasOptions ? ` · ${optionLegs.length} option${optionLegs.length === 1 ? '' : 's'}` : ''}
          </span>
          <span className="ml-auto text-xs text-gray-600">
            Unrealized: <span className={`font-semibold ${sign(totals.net)}`}>{fmtCurrency(totals.net)}</span>
          </span>
        </button>
        {!collapsed && (
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="text-left px-3 py-1.5">Position</th>
                <th className="text-right px-2 py-1.5 w-28">Cost</th>
                <th className="text-right px-2 py-1.5 w-28">Credits</th>
                <th className="text-right px-2 py-1.5 w-28">Current Value</th>
                <th className="text-right px-2 py-1.5 w-28">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-50 text-[11px] text-gray-700 bg-white">
                  <td className="px-3 py-1">
                    {r.kind === 'option' ? (
                      <span className="font-mono">
                        <span className={`mr-1.5 px-1 py-0.5 text-[10px] font-bold rounded ${r.option_type === 'call' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'}`}>
                          {r.option_type === 'call' ? 'C' : 'P'}
                        </span>
                        {fmtOptionSymbol({
                          asset_type: 'OPTION',
                          option_type: r.option_type,
                          underlying: r.underlying,
                          strike: r.strike,
                          expiration: r.expiration,
                          symbol: r.symbol,
                        })}
                      </span>
                    ) : (
                      <span className="font-mono">
                        <span className="mr-1.5 px-1 py-0.5 text-[10px] font-bold rounded bg-gray-300 text-gray-800">S</span>
                        {r.symbol}
                      </span>
                    )}
                    <span className={`ml-2 text-[10px] ${r.qty < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {r.qty > 0 ? '+' : ''}{fmtQty(r.qty)}
                    </span>
                    {r.avgPrice != null && (
                      <span className="ml-2 text-[10px] text-gray-500">
                        @ avg {fmtCurrency(r.avgPrice)}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 py-1 text-right ${r.cost > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                    {r.cost > 0 ? fmtCurrency(r.cost) : blank}
                  </td>
                  <td className={`px-2 py-1 text-right ${r.credits > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                    {r.credits > 0 ? fmtCurrency(r.credits) : blank}
                  </td>
                  <td className={`px-2 py-1 text-right text-gray-800`}>{fmtCurrency(r.currentValue)}</td>
                  <td className={`px-2 py-1 text-right font-semibold ${sign(r.net)}`}>{fmtCurrency(r.net)}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-xs">
                <td className="px-3 py-1.5 text-gray-900">Total</td>
                <td className="px-2 py-1.5 text-right text-gray-900">{totals.cost !== 0 ? fmtCurrency(totals.cost) : blank}</td>
                <td className="px-2 py-1.5 text-right text-gray-900">{totals.credits !== 0 ? fmtCurrency(totals.credits) : blank}</td>
                <td className="px-2 py-1.5 text-right text-gray-900">{totals.currentValue !== 0 ? fmtCurrency(totals.currentValue) : blank}</td>
                <td className={`px-2 py-1.5 text-right font-bold ${sign(totals.net)}`}>{fmtCurrency(totals.net)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const RollupStrip = ({
  transactions, annotations, linkGroupsMeta, groupLabels, indexByGroupId, livePriceBySymbol,
  visibleCount, hiddenCount, onEditGroup, collapsed, onToggleCollapsed,
  expandedGroups, onToggleExpandGroup,
}) => {
  // Bucket visible (non-hidden) transactions by link_group_id, with an
  // "Ungrouped" bucket for those without a group. Within each bucket, per
  // symbol, we track OPENING lots chronologically and apply FILO (most-recent
  // first) when CLOSING legs arrive — giving the exact remaining cost basis
  // for still-open positions even when the bucket has partial closes or
  // multi-price opens.
  const rollups = React.useMemo(() => {
    const buckets = new Map();
    // transactions come from the API chronologically ASC, so we can walk in order.
    for (const tx of transactions) {
      const ann = annotations[tx.schwab_transaction_id] || {};
      if (ann.hidden) continue;
      const key = ann.link_group_id || '__ungrouped__';
      if (!buckets.has(key)) {
        buckets.set(key, {
          cost: 0,          // sum of negative net_amount on all txs
          credits: 0,       // sum of positive net_amount on all txs
          legsBySymbol: new Map(),
          txCount: 0,
          txs: [],          // preserved for expanded-group detail view
        });
      }
      const b = buckets.get(key);
      b.txCount += 1;
      b.txs.push(tx);
      const amt = parseFloat(tx.net_amount) || 0;
      if (amt < 0) b.cost += amt;
      else b.credits += amt;

      for (const leg of (tx.legs || [])) {
        const sym = normalizeSymbol(leg.symbol);
        if (!sym) continue;
        const effect = (leg.position_effect || '').toUpperCase();
        const signedQty = parseFloat(leg.amount) || 0;
        const absQty = Math.abs(signedQty);
        const price = parseFloat(leg.price) || 0;
        if (absQty === 0) continue;

        const assetType = (leg.asset_type || '').toUpperCase();
        if (!b.legsBySymbol.has(sym)) {
          b.legsBySymbol.set(sym, {
            lots: [],             // chronological OPENING lots; each { qty, price, direction }
            display_symbol: leg.symbol,
            asset_type: assetType,
            option_type: leg.option_type,
            underlying: leg.underlying,
            strike: leg.strike,
            expiration: leg.expiration,
          });
        }
        const s = b.legsBySymbol.get(sym);

        if (effect === 'CLOSING') {
          // FILO: pull from the end
          let rem = absQty;
          while (rem > 0 && s.lots.length > 0) {
            const last = s.lots[s.lots.length - 1];
            if (last.qty <= rem + 1e-9) {
              rem -= last.qty;
              s.lots.pop();
            } else {
              last.qty -= rem;
              rem = 0;
            }
          }
          // Overflow (closing > opens in this bucket) silently dropped — that
          // just means the matching open wasn't included in this bucket.
        } else {
          // Treat OPENING (or unknown) as add-a-lot
          const direction = signedQty > 0 ? 1 : -1;  // +1 long, -1 short
          s.lots.push({ qty: absQty, price, direction });
        }
      }
    }

    const result = [];
    for (const [key, b] of buckets) {
      let marketValueTotal = 0;       // always-positive sum of |qty| × cur × mult
      // Signed cash you'd net by closing every still-open leg in the bucket:
      //   long  → +marketValue (you sell to close)
      //   short → -marketValue (you buy to close)
      let closeOutSigned = 0;
      const legs = [];

      for (const [sym, s] of b.legsBySymbol) {
        if (s.lots.length === 0) continue;
        const mult = s.asset_type === 'OPTION' ? 100 : 1;
        let absRemaining = 0;
        let weightedPriceNum = 0;
        for (const lot of s.lots) {
          absRemaining += lot.qty;
          weightedPriceNum += lot.qty * lot.price;
        }
        if (absRemaining < 1e-9) continue;
        const direction = s.lots[0].direction;  // +1 long, -1 short
        const signedQty = direction * absRemaining;
        const avgPrice = weightedPriceNum / absRemaining;
        const cur = livePriceBySymbol.get(sym);
        const costOrCredit = absRemaining * avgPrice * mult;  // positive magnitude
        const marketValue = cur != null ? absRemaining * cur * mult : null;  // positive
        // Per-leg standalone "if closed now" P&L (used in sub-rows only).
        const legUnrealized = marketValue != null
          ? direction * (marketValue - costOrCredit)
          : null;
        if (marketValue != null) {
          marketValueTotal += marketValue;
          closeOutSigned += direction * marketValue;
        }

        legs.push({
          symbol: s.display_symbol || sym,
          raw_symbol: sym,
          asset_type: s.asset_type,
          option_type: s.option_type,
          underlying: s.underlying,
          strike: s.strike,
          expiration: s.expiration,
          qty: signedQty,
          avg_price: avgPrice,
          cost: direction > 0 ? Math.round(costOrCredit * 100) / 100 : 0,
          credits: direction < 0 ? Math.round(costOrCredit * 100) / 100 : 0,
          current_price: cur,
          current_value: marketValue != null ? Math.round(marketValue * 100) / 100 : null,
          leg_net: legUnrealized != null ? Math.round(legUnrealized * 100) / 100 : null,
          still_live: cur != null,
        });
      }
      legs.sort((a, b) => {
        if (a.asset_type !== b.asset_type) return a.asset_type === 'STOCK' ? -1 : 1;
        return (a.expiration || '').localeCompare(b.expiration || '');
      });
      // Top-row totals:
      //   Cost    = magnitude of all debits in the bucket (closed + open mixed)
      //   Credits = magnitude of all credits in the bucket (closed + open mixed)
      //   Current Value = sum of still-open market values (magnitudes)
      //   Net = "if everything closed now" P&L
      //       = (credits − cost) + Σ(direction × marketValue of open legs)
      //   The first term is the bucket's net cash so far (signed).
      //   The second term is what you'd net by closing every open leg today.
      //   This avoids the double-count bug of subtracting per-leg cost/credit
      //   when those amounts are already inside Cost/Credits at the top row.
      const cost = Math.round(Math.abs(b.cost) * 100) / 100;        // positive magnitude
      const credits = Math.round(b.credits * 100) / 100;            // positive
      const cv = Math.round(marketValueTotal * 100) / 100;           // positive
      const net = Math.round((credits - cost + closeOutSigned) * 100) / 100;
      result.push({
        key,
        groupId: key === '__ungrouped__' ? null : key,
        label: key === '__ungrouped__'
          ? 'Ungrouped'
          : (linkGroupsMeta[key]?.name || groupLabels.get(key) || `Group ${key.slice(0, 4)}`),
        shortLabel: key === '__ungrouped__' ? null : groupLabels.get(key),
        cost,
        credits,
        currentValue: cv,
        net,
        txCount: b.txCount,
        legs,
        txs: b.txs,
      });
    }
    // Sort by G-index (creation order); Ungrouped pinned to the end
    result.sort((a, b) => {
      if (a.key === '__ungrouped__') return 1;
      if (b.key === '__ungrouped__') return -1;
      const ai = indexByGroupId.get(a.key);
      const bi = indexByGroupId.get(b.key);
      return (ai ?? 999) - (bi ?? 999);
    });
    return result;
  }, [transactions, annotations, linkGroupsMeta, groupLabels, indexByGroupId, livePriceBySymbol]);

  const totals = React.useMemo(() => {
    const t = { cost: 0, credits: 0, currentValue: 0, net: 0, txCount: 0 };
    for (const r of rollups) {
      t.cost += r.cost;
      t.credits += r.credits;
      t.currentValue += r.currentValue;
      t.net += r.net;
      t.txCount += r.txCount;
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    return { cost: r2(t.cost), credits: r2(t.credits), currentValue: r2(t.currentValue), net: r2(t.net), txCount: t.txCount };
  }, [rollups]);

  if (rollups.length === 0) return null;

  const sign = (v) => (v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-600');
  const blank = <span className="text-gray-300">—</span>;

  return (
    <div className="bg-white border-b px-4 py-2">
      <div className="border border-gray-200 rounded-lg">
        <button
          onClick={onToggleCollapsed}
          className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50 hover:bg-gray-100 text-left"
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
          <span className="text-sm font-bold text-gray-900">Group Rollups</span>
          <span className="text-xs text-gray-500">{visibleCount} visible · {hiddenCount} hidden</span>
          <span className="ml-auto text-xs text-gray-600">
            Total: <span className={`font-semibold ${sign(totals.net)}`}>{fmtCurrency(totals.net)}</span>
          </span>
        </button>
        {!collapsed && (
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="text-left px-0 py-1.5 w-2"></th>
              <th className="text-left px-2 py-1.5">Group</th>
              <th className="text-right px-2 py-1.5 w-12">Txs</th>
              <th className="text-right px-2 py-1.5 w-28">Cost</th>
              <th className="text-right px-2 py-1.5 w-28">Credits</th>
              <th className="text-right px-2 py-1.5 w-28">Current Value</th>
              <th className="text-right px-2 py-1.5 w-28">Net</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map(r => {
              const color = r.groupId ? colorForGroup(r.groupId, indexByGroupId) : null;
              // Per user request: drop the still-open sub-rows under all groups —
              // the expanded transaction list shows the relevant detail.
              const stillOpenLegs = [];
              const isExpanded = expandedGroups.has(r.key);
              return (
                <React.Fragment key={r.key}>
                  <tr className={`border-b border-gray-100 ${color ? color.bg : ''}`}>
                    <td className={`px-0 py-1.5 w-2 ${color ? color.bar : ''}`}></td>
                    <td className="px-2 py-1.5">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onToggleExpandGroup(r.key)}
                          className="text-gray-500 hover:text-gray-900"
                          title={isExpanded ? 'Collapse details' : 'Expand details'}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                        {r.groupId ? (
                          <button
                            onClick={() => onEditGroup(r.groupId)}
                            className="inline-flex items-center gap-1.5 hover:underline"
                            title="Edit group name/note"
                          >
                            <span className={`inline-block text-[10px] font-bold text-white px-1 py-0.5 rounded ${color.bar}`}>
                              {r.shortLabel}
                            </span>
                            <span className="font-semibold">{r.label}</span>
                          </button>
                        ) : (
                          <span className="text-gray-600 italic">Ungrouped</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{r.txCount}</td>
                    <td className={`px-2 py-1.5 text-right ${r.cost > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{r.cost !== 0 ? fmtCurrency(r.cost) : blank}</td>
                    <td className={`px-2 py-1.5 text-right ${r.credits > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{r.credits !== 0 ? fmtCurrency(r.credits) : blank}</td>
                    <td className={`px-2 py-1.5 text-right text-gray-800`}>
                      {r.currentValue > 0 ? fmtCurrency(r.currentValue) : blank}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-bold ${sign(r.net)}`}>{fmtCurrency(r.net)}</td>
                  </tr>
                  {/* Sub-row per still-open leg, FILO-matched cost basis in this bucket. */}
                  {stillOpenLegs.map((leg, idx) => (
                    <tr key={`${r.key}-leg-${idx}`} className="border-b border-gray-50 text-[11px] text-gray-600 bg-white">
                      <td className={`px-0 py-1 w-2 ${color ? color.bar : ''} opacity-40`}></td>
                      <td className="px-2 py-1 pl-8">
                        {leg.asset_type === 'OPTION' ? (
                          <span className="font-mono">
                            <span className={`mr-1.5 px-1 py-0.5 text-[10px] font-bold rounded ${leg.option_type === 'call' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'}`}>
                              {leg.option_type === 'call' ? 'C' : 'P'}
                            </span>
                            {fmtOptionSymbol({
                              asset_type: 'OPTION',
                              option_type: leg.option_type,
                              underlying: leg.underlying,
                              strike: leg.strike,
                              expiration: leg.expiration,
                              symbol: leg.symbol,
                            })}
                          </span>
                        ) : (
                          <span className="font-mono">
                            <span className="mr-1.5 px-1 py-0.5 text-[10px] font-bold rounded bg-gray-300 text-gray-800">S</span>
                            {leg.symbol}
                          </span>
                        )}
                        <span className={`ml-2 text-[10px] ${leg.qty < 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {leg.qty > 0 ? '+' : ''}{fmtQty(leg.qty)}
                        </span>
                        {leg.avg_price != null && (
                          <span className="ml-2 text-[10px] text-gray-500">
                            @ avg {fmtCurrency(leg.avg_price)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1"></td>
                      <td className={`px-2 py-1 text-right ${leg.cost > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {leg.cost > 0 ? fmtCurrency(leg.cost) : blank}
                      </td>
                      <td className={`px-2 py-1 text-right ${leg.credits > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {leg.credits > 0 ? fmtCurrency(leg.credits) : blank}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-800">
                        {leg.current_value != null ? fmtCurrency(leg.current_value) : blank}
                      </td>
                      <td className={`px-2 py-1 text-right font-semibold ${sign(leg.leg_net)}`}>
                        {leg.leg_net != null ? fmtCurrency(leg.leg_net) : blank}
                      </td>
                    </tr>
                  ))}
                  {/* Expanded: full transaction list for this bucket (opens + closes). */}
                  {isExpanded && r.txs.length > 0 && (
                    <tr className={color ? color.bg : ''}>
                      <td className={`px-0 py-0 w-2 ${color ? color.bar : ''} opacity-40`}></td>
                      <td colSpan={6} className="px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                          All transactions in this group ({r.txs.length})
                        </div>
                        <table className="w-full text-[11px]">
                          <thead className="text-gray-500">
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-0.5 w-20">Date</th>
                              <th className="text-left py-0.5 w-24">Type</th>
                              <th className="text-left py-0.5">Legs</th>
                              <th className="text-right py-0.5 w-14">Qty</th>
                              <th className="text-right py-0.5 w-20">Price</th>
                              <th className="text-right py-0.5 w-24">Net Cash</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.txs.map(tx => {
                              const net = parseFloat(tx.net_amount) || 0;
                              const disp = (annotations[tx.schwab_transaction_id] || {}).disposition;
                              return (
                                <tr key={tx.schwab_transaction_id} className="border-b border-gray-100 last:border-0">
                                  <td className="py-0.5 text-gray-700">{fmtDate(tx.date)}</td>
                                  <td className="py-0.5 text-gray-700">
                                    <div className="flex items-center gap-1.5">
                                      <span>{tx.type}</span>
                                      {disp && <DispositionBadge value={disp} />}
                                    </div>
                                  </td>
                                  <td className="py-0.5">
                                    {tx.legs.map((leg, i) => {
                                      const isOpt = (leg.asset_type || '').toUpperCase() === 'OPTION';
                                      return (
                                        <div key={i} className="flex items-center gap-1.5">
                                          {isOpt ? (
                                            <span className={`px-1 py-0.5 text-[9px] font-bold rounded ${leg.option_type === 'call' ? 'bg-blue-600 text-white' : 'bg-purple-600 text-white'}`}>
                                              {leg.option_type === 'call' ? 'C' : 'P'}
                                            </span>
                                          ) : (
                                            <span className="px-1 py-0.5 text-[9px] font-bold rounded bg-gray-300 text-gray-800">S</span>
                                          )}
                                          <span className="font-mono text-gray-900">{isOpt ? fmtOptionSymbol(leg) : (leg.symbol || '')}</span>
                                          {leg.position_effect && (
                                            <span className="text-[9px] text-gray-500">{leg.position_effect}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </td>
                                  <td className="py-0.5 text-right">
                                    {tx.legs.map((l, i) => (
                                      <div key={i} className={l.amount < 0 ? 'text-red-600' : 'text-green-700'}>
                                        {l.amount != null ? (l.amount > 0 ? `+${fmtQty(l.amount)}` : fmtQty(l.amount)) : '-'}
                                      </div>
                                    ))}
                                  </td>
                                  <td className="py-0.5 text-right text-gray-700">
                                    {tx.legs.map((l, i) => (
                                      <div key={i}>{l.price != null ? fmtCurrency(l.price) : '-'}</div>
                                    ))}
                                  </td>
                                  <td className={`py-0.5 text-right font-semibold ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                                    {fmtCurrency(net)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {/* Total row replaces the removed transaction-totals panel */}
            <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
              <td className="px-0 py-1.5 w-2"></td>
              <td className="px-2 py-1.5 text-gray-900">Total</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{totals.txCount}</td>
              <td className="px-2 py-1.5 text-right text-gray-900">{totals.cost !== 0 ? fmtCurrency(totals.cost) : blank}</td>
              <td className="px-2 py-1.5 text-right text-gray-900">{totals.credits !== 0 ? fmtCurrency(totals.credits) : blank}</td>
              <td className="px-2 py-1.5 text-right text-gray-900">{totals.currentValue !== 0 ? fmtCurrency(totals.currentValue) : blank}</td>
              <td className={`px-2 py-1.5 text-right font-bold ${sign(totals.net)}`}>{fmtCurrency(totals.net)}</td>
            </tr>
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
};


const GroupEditorModal = ({ groupId, label, meta, indexByGroupId, onClose, onSave }) => {
  const [name, setName] = useState(meta.name || '');
  const [note, setNote] = useState(meta.note || '');
  const color = colorForGroup(groupId, indexByGroupId);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-md p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-block w-3 h-3 rounded ${color.bar}`} />
          <h2 className="text-sm font-bold text-gray-900">Edit group {label}</h2>
          <button className="ml-auto text-gray-500 hover:text-gray-900" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-xs text-gray-600 mb-1">Name</label>
        <input
          className="w-full border rounded px-2 py-1 text-sm mb-3"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. MSFT P370 roll"
          autoFocus
        />
        <label className="block text-xs text-gray-600 mb-1">Note</label>
        <textarea
          className="w-full border rounded px-2 py-1 text-sm mb-3"
          rows={4}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What is this roll / cycle about?"
        />
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => onSave({ name, note })}
          >
            Save
          </button>
        </div>
        <div className="mt-3 text-[10px] text-gray-400 flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Group ID: {groupId}
        </div>
      </div>
    </div>
  );
};

const DispositionBadge = ({ value }) => {
  if (!value) return null;
  const palette = {
    closed:   'bg-gray-200 text-gray-800',
    rolled:   'bg-amber-100 text-amber-800',
    expired:  'bg-blue-100 text-blue-800',
    assigned: 'bg-purple-100 text-purple-800',
  };
  const cls = palette[value] || 'bg-gray-200 text-gray-800';
  return (
    <span className={`inline-block px-1.5 py-0 rounded text-[9px] font-semibold uppercase ${cls}`}>
      {value}
    </span>
  );
};

const SummaryCell = ({ label, value, tone, raw, bold }) => {
  let color = 'text-gray-900';
  if (tone !== undefined && !raw) {
    if (tone > 0) color = 'text-green-700';
    else if (tone < 0) color = 'text-red-700';
  }
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`${bold ? 'text-lg font-bold' : 'text-sm font-semibold'} ${color}`}>
        {value}
      </div>
    </div>
  );
};

export default TransactionsView;
