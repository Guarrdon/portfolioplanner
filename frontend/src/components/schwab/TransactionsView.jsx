/**
 * TransactionsView — per-underlying live transaction history from Schwab.
 *
 * Three layers of structure:
 *   1. Raw transactions (Schwab cache)
 *   2. Classified positions (chains of transactions classified into a
 *      position_type — sold_vertical_put, rolled_options, stock, etc.)
 *   3. Custom tags (open-ended user labels; many-to-many)
 *
 * One unified grid with two toggleable grouping levels (Tag → Position → Tx).
 * Portfolio summary always rolls up from raw transactions and positions —
 * never from tags, since tag membership overlaps and would double-count.
 *
 * Route: /schwab/transactions/:underlying?account=<account_hash>
 */
import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, RefreshCw, EyeOff, Eye, StickyNote, Pencil, X, Plus, Trash2,
  ChevronDown, ChevronRight, Search, Sparkles, Tag as TagIcon, Layers, Check,
} from 'lucide-react';
import {
  fetchTransactionsByUnderlying,
  fetchOpenPositionsForUnderlying,
  updateTransactionAnnotation,
  classifyTransactions,
  unclassifyTransactions,
  updateTransactionPosition,
} from '../../services/transactions';
import {
  fetchTags,
  createTag,
  updateTag,
  deleteTag,
  addTagMember,
} from '../../services/tags';
import { fetchActualPositions } from '../../services/schwab';
import { buildClassifications, positionTypeLabel } from '../../utils/autoClassify';
import { compareTxsForDisplay } from '../../utils/positionMetrics';

// ---------- formatters ----------

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
  const datePart = d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' });
  const hour = d.getHours();
  const min = d.getMinutes();
  if (hour === 0 && min === 0) return datePart;
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

const normalizeSymbol = (s) => (s || '').toUpperCase().replace(/\s+/g, '');

// Stable per-position color from a 12-color palette, keyed by index of first
// appearance in the rendered list.
const POSITION_COLORS = [
  { bar: 'bg-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-300' },
  { bar: 'bg-sky-500',     bg: 'bg-sky-50',     text: 'text-sky-800',     border: 'border-sky-300' },
  { bar: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
  { bar: 'bg-fuchsia-500', bg: 'bg-fuchsia-50', text: 'text-fuchsia-800', border: 'border-fuchsia-300' },
  { bar: 'bg-rose-500',    bg: 'bg-rose-50',    text: 'text-rose-800',    border: 'border-rose-300' },
  { bar: 'bg-indigo-500',  bg: 'bg-indigo-50',  text: 'text-indigo-800',  border: 'border-indigo-300' },
  { bar: 'bg-lime-600',    bg: 'bg-lime-50',    text: 'text-lime-800',    border: 'border-lime-300' },
  { bar: 'bg-cyan-600',    bg: 'bg-cyan-50',    text: 'text-cyan-800',    border: 'border-cyan-300' },
  { bar: 'bg-orange-500',  bg: 'bg-orange-50',  text: 'text-orange-800',  border: 'border-orange-300' },
  { bar: 'bg-teal-500',    bg: 'bg-teal-50',    text: 'text-teal-800',    border: 'border-teal-300' },
  { bar: 'bg-pink-500',    bg: 'bg-pink-50',    text: 'text-pink-800',    border: 'border-pink-300' },
  { bar: 'bg-violet-500',  bg: 'bg-violet-50',  text: 'text-violet-800',  border: 'border-violet-300' },
];

const colorForPosition = (positionId, indexByPosition) => {
  if (indexByPosition && indexByPosition.has(positionId)) {
    return POSITION_COLORS[indexByPosition.get(positionId) % POSITION_COLORS.length];
  }
  let h = 0;
  for (let i = 0; i < (positionId || '').length; i++) h = ((h << 5) - h + (positionId || '').charCodeAt(i)) | 0;
  return POSITION_COLORS[Math.abs(h) % POSITION_COLORS.length];
};

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
    visible_count: visible, hidden_count: hidden,
    stock_net_cash: r2(stock), options_net_cash: r2(opt),
    total_net_cash: r2(stock + opt),
  };
};

// ---------- main component ----------

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
  const [selectedPositions, setSelectedPositions] = useState(new Set());
  const [editingPositionId, setEditingPositionId] = useState(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [groupByTag, setGroupByTag] = useState(true);
  const [groupByPosition, setGroupByPosition] = useState(true);
  // Sets track which IDs are *collapsed* (default = expanded everywhere).
  const [collapsedPositions, setCollapsedPositions] = useState(new Set());
  const [collapsedTags, setCollapsedTags] = useState(new Set());
  const [positionStripCollapsed, setPositionStripCollapsed] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState('');
  // Multi-step background work (auto-classify, bulk tag): {active, current, total, message}
  const [progress, setProgress] = useState(null);

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

  const handleAccountChange = (e) => navigateTo(underlying, e.target.value || null);
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

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchTransactionsByUnderlying(underlying, { accountId, days }),
    enabled: !!underlying,
  });

  const { data: openPositionsData } = useQuery({
    queryKey: ['open-positions', underlying, accountId],
    queryFn: () => fetchOpenPositionsForUnderlying(underlying, { accountId }),
    enabled: !!underlying,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['all-tags'],
    queryFn: () => fetchTags(),
    staleTime: 60 * 1000,
  });

  // ---------- mutations ----------

  const annMutation = useMutation({
    mutationFn: ({ txId, patch }) => updateTransactionAnnotation(txId, patch),
    onMutate: async ({ txId, patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        annotations[txId] = { ...(annotations[txId] || { hidden: false }), ...patch };
        const summary = computeSummary(old.transactions || [], annotations);
        return { ...old, annotations, summary };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const classifyMutation = useMutation({
    mutationFn: ({ txIds, positionId, positionType, name }) =>
      classifyTransactions(txIds, { positionId, positionType, name }),
    onMutate: async ({ txIds, positionId }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      const tempId = positionId || `tmp-${Math.random().toString(36).slice(2, 10)}`;
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        const positions = { ...(old.positions || {}) };
        for (const id of txIds) {
          annotations[id] = { ...(annotations[id] || { hidden: false }), transaction_position_id: tempId };
        }
        if (!positions[tempId]) positions[tempId] = { id: tempId, name: null, note: null, position_type: null };
        return { ...old, annotations, positions };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unclassifyMutation = useMutation({
    mutationFn: ({ txIds }) => unclassifyTransactions(txIds),
    onMutate: async ({ txIds }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const annotations = { ...(old.annotations || {}) };
        for (const id of txIds) {
          if (annotations[id]) annotations[id] = { ...annotations[id], transaction_position_id: null };
        }
        return { ...old, annotations };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const positionMutation = useMutation({
    mutationFn: ({ positionId, patch }) => updateTransactionPosition(positionId, patch),
    onMutate: async ({ positionId, patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;
        const positions = { ...(old.positions || {}) };
        positions[positionId] = { ...(positions[positionId] || { id: positionId }), ...patch };
        return { ...old, positions };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const tagCreateMutation = useMutation({
    mutationFn: (payload) => createTag(payload),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['all-tags'] }),
  });
  const tagUpdateMutation = useMutation({
    mutationFn: ({ tagId, patch }) => updateTag(tagId, patch),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tags'] });
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const tagDeleteMutation = useMutation({
    mutationFn: (tagId) => deleteTag(tagId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tags'] });
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const tagAddMutation = useMutation({
    mutationFn: ({ tagId, memberType, memberId }) => addTagMember(tagId, { memberType, memberId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  // ---------- derived data ----------

  const transactions = useMemo(() => data?.transactions || [], [data]);
  const annotations = useMemo(() => data?.annotations || {}, [data]);
  const positionsMeta = useMemo(() => data?.positions || {}, [data]);
  const tagsMeta = useMemo(() => data?.tags || {}, [data]);
  const tagMemberships = useMemo(() => data?.tag_memberships || [], [data]);
  const summary = data?.summary || { visible_count: 0, hidden_count: 0, stock_net_cash: 0, options_net_cash: 0, total_net_cash: 0 };

  // Tag membership lookups
  const tagsByMember = useMemo(() => {
    const m = new Map(); // `${type}|${id}` → Set<tag_id>
    for (const tm of tagMemberships) {
      const k = `${tm.member_type}|${tm.member_id}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(tm.tag_id);
    }
    return m;
  }, [tagMemberships]);

  const membersByTag = useMemo(() => {
    const m = new Map();
    for (const tm of tagMemberships) {
      if (!m.has(tm.tag_id)) m.set(tm.tag_id, { transaction: new Set(), transaction_position: new Set() });
      m.get(tm.tag_id)[tm.member_type].add(tm.member_id);
    }
    return m;
  }, [tagMemberships]);

  const types = useMemo(() => {
    const s = new Set();
    transactions.forEach(t => t.type && s.add(t.type));
    return Array.from(s).sort();
  }, [transactions]);

  const visibleTxs = useMemo(() => {
    return transactions.filter(t => {
      const ann = annotations[t.schwab_transaction_id] || {};
      if (ann.hidden && !showHidden) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      return true;
    });
  }, [transactions, annotations, showHidden, typeFilter]);

  // Group visible transactions by their position_id (or null = unclassified)
  const txsByPosition = useMemo(() => {
    const m = new Map();
    for (const tx of visibleTxs) {
      const pid = annotations[tx.schwab_transaction_id]?.transaction_position_id || null;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid).push(tx);
    }
    return m;
  }, [visibleTxs, annotations]);

  // Position color index (creation order = first appearance order in the data)
  const indexByPosition = useMemo(() => {
    const idx = new Map();
    let i = 0;
    const seen = new Set();
    for (const tx of transactions) {
      const pid = annotations[tx.schwab_transaction_id]?.transaction_position_id;
      if (pid && !seen.has(pid)) {
        seen.add(pid);
        idx.set(pid, i++);
      }
    }
    return idx;
  }, [transactions, annotations]);

  // Bucket-level rollup metrics. A bucket = a position OR the loose-unclassified set.
  // Computed across all visible transactions in the bucket.
  const livePriceBySymbol = useMemo(() => {
    const map = new Map();
    (openPositionsData?.options || []).forEach(o => {
      if (o.symbol && o.current_price != null) {
        map.set(normalizeSymbol(o.symbol), parseFloat(o.current_price));
      }
    });
    if (openPositionsData?.stock && openPositionsData.stock.quantity !== 0) {
      const q = parseFloat(openPositionsData.stock.quantity) || 0;
      const v = parseFloat(openPositionsData.stock.current_value) || 0;
      if (q !== 0) map.set(normalizeSymbol(underlying), v / q);
    }
    return map;
  }, [openPositionsData, underlying]);

  const positionRollups = useMemo(() => {
    const result = new Map();
    for (const [pid, txs] of txsByPosition) {
      result.set(pid, computeBucketRollup(txs, livePriceBySymbol));
    }
    return result;
  }, [txsByPosition, livePriceBySymbol]);

  // Top-level summary: roll up positions + loose unclassified, never tags.
  const topSummary = useMemo(() => {
    let cost = 0, credits = 0, currentValue = 0, net = 0;
    for (const r of positionRollups.values()) {
      cost += r.cost;
      credits += r.credits;
      currentValue += r.currentValue;
      net += r.net;
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    return { cost: r2(cost), credits: r2(credits), currentValue: r2(currentValue), net: r2(net) };
  }, [positionRollups]);

  // ---------- selection helpers ----------

  const selectedTxIds = useMemo(() => Array.from(selected), [selected]);
  const selectedPositionIds = useMemo(() => Array.from(selectedPositions), [selectedPositions]);

  const toggleSelectTx = (txId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId); else next.add(txId);
      return next;
    });
  };
  const toggleSelectPosition = (pid) => {
    setSelectedPositions(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelectedPositions(new Set());
  };

  // ---------- handlers ----------

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

  const handleClassify = () => {
    if (selectedTxIds.length < 1) return;
    // If all selected txs already share a single position, we're "merging" — append-only.
    const existingPids = new Set(
      selectedTxIds.map(id => annotations[id]?.transaction_position_id).filter(Boolean)
    );
    const positionId = existingPids.size === 1 ? [...existingPids][0] : null;
    classifyMutation.mutate({ txIds: selectedTxIds, positionId, positionType: 'manual', name: null });
    clearSelection();
  };

  const handleUnclassify = () => {
    if (selectedTxIds.length === 0) return;
    unclassifyMutation.mutate({ txIds: selectedTxIds });
    clearSelection();
  };

  const handleAutoClassify = async () => {
    const debug = searchParams.get('debug') === 'autoclassify';
    const groups = buildClassifications(transactions, annotations, { underlying, debug });
    if (groups.length === 0) {
      window.alert('Auto-classify found no chains. Already-classified transactions are skipped.');
      return;
    }
    const totalTx = groups.reduce((n, g) => n + g.transactionIds.length, 0);
    const ok = window.confirm(
      `Auto-classify will create ${groups.length} position${groups.length === 1 ? '' : 's'} ` +
      `covering ${totalTx} transaction${totalTx === 1 ? '' : 's'}.\n\n` +
      `Already-classified transactions are skipped. Continue?`
    );
    if (!ok) return;
    setProgress({ active: true, current: 0, total: groups.length, message: 'Classifying' });
    try {
      let i = 0;
      for (const g of groups) {
        i += 1;
        setProgress({ active: true, current: i, total: groups.length, message: `Classifying ${g.name}` });
        await classifyTransactions(g.transactionIds, {
          positionType: g.position_type,
          name: g.name,
        });
      }
    } catch (err) {
      window.alert('Auto-classify failed: ' + (err?.response?.data?.detail || err?.message || 'unknown error'));
    } finally {
      setProgress(null);
      queryClient.invalidateQueries({ queryKey });
    }
  };

  const applyTagToSelection = async (tagId) => {
    const additions = [];
    for (const txId of selectedTxIds) additions.push({ tagId, memberType: 'transaction', memberId: txId });
    for (const pid of selectedPositionIds) additions.push({ tagId, memberType: 'transaction_position', memberId: pid });
    if (additions.length === 0) return;
    setProgress({ active: true, current: 0, total: additions.length, message: 'Applying tag' });
    try {
      let i = 0;
      for (const a of additions) {
        i += 1;
        setProgress({ active: true, current: i, total: additions.length, message: `Applying tag (${i}/${additions.length})` });
        try { await tagAddMutation.mutateAsync(a); } catch (_e) { /* ignore duplicates */ }
      }
    } finally {
      setProgress(null);
      queryClient.invalidateQueries({ queryKey });
    }
  };

  // ---------- bulk collapse/expand controls ----------
  // Levels:
  //   0 = everything expanded (default)
  //   1 = positions collapsed, tags expanded
  //   2 = positions + tags collapsed (tag headers only)
  // Each click steps one level. State is derived from the two Sets.
  const collapseLevel = (collapsedTags.size > 0)
    ? 2
    : (collapsedPositions.size > 0 ? 1 : 0);

  const allPositionIds = useMemo(() => Object.keys(positionsMeta), [positionsMeta]);
  const allTagIds = useMemo(() => Object.keys(tagsMeta), [tagsMeta]);

  const collapseLevelDown = () => {
    if (collapseLevel === 0) {
      setCollapsedPositions(new Set(allPositionIds));
      setCollapsedTags(new Set());
    } else if (collapseLevel === 1) {
      setCollapsedPositions(new Set(allPositionIds));
      setCollapsedTags(new Set(allTagIds));
    }
  };
  const collapseLevelUp = () => {
    if (collapseLevel === 2) {
      setCollapsedTags(new Set());
      setCollapsedPositions(new Set(allPositionIds));
    } else if (collapseLevel === 1) {
      setCollapsedPositions(new Set());
      setCollapsedTags(new Set());
    }
  };

  const hasOptionLeg = (tx) => (tx.legs || []).some(l => (l.asset_type || '').toUpperCase() === 'OPTION');
  const currentPriceForLeg = (leg) => {
    if (!leg?.symbol) return null;
    const p = livePriceBySymbol.get(normalizeSymbol(leg.symbol));
    return p == null ? null : p;
  };

  // ---------- view tree (Tag → Position → Tx) ----------

  const viewTree = useMemo(() => {
    return buildViewTree({
      visibleTxs,
      annotations,
      positionsMeta,
      tagsMeta,
      membersByTag,
      tagsByMember,
      groupByTag,
      groupByPosition,
    });
  }, [visibleTxs, annotations, positionsMeta, tagsMeta, membersByTag, tagsByMember, groupByTag, groupByPosition]);

  // ---------- render ----------

  const sign = (v) => (v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-600');

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
            <option key={a.account_hash} value={a.account_hash}>Account: {a.account_number}</option>
          ))}
        </select>
        {accountId && (
          <Link
            to={`/schwab/transactions/account/${encodeURIComponent(accountId)}`}
            className="text-xs text-sky-700 hover:underline whitespace-nowrap"
            title="View every transaction for this account"
          >
            view account →
          </Link>
        )}

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
          <button
            onClick={handleAutoClassify}
            disabled={!!progress?.active || isLoading || isFetching}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            title="Auto-classify chains into positions (skips already-classified)"
          >
            <Sparkles className={`w-3 h-3 ${progress?.active ? 'animate-pulse' : ''}`} />
            Auto Classify
          </button>
          <button
            onClick={() => setTagManagerOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
            title="Manage custom group tags"
          >
            <TagIcon className="w-3 h-3" /> Tags
          </button>
          <button
            onClick={async () => {
              await fetchTransactionsByUnderlying(underlying, { accountId, days, refresh: true });
              queryClient.invalidateQueries({ queryKey });
            }}
            disabled={isFetching}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
            title="Refresh from Schwab (bypasses cache)"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Current open position strip (live, separate concept) */}
      <CurrentPositionStrip
        data={openPositionsData}
        realized={summary.total_net_cash}
        collapsed={positionStripCollapsed}
        onToggleCollapsed={() => setPositionStripCollapsed(v => !v)}
      />

      {/* Top summary bar — rolled up from positions + loose txs only (never tags). */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-6 text-xs">
        <span className="text-gray-500">Portfolio rollup</span>
        <span><span className="text-gray-500">Cost </span><span className="font-semibold text-gray-900">{fmtCurrency(topSummary.cost)}</span></span>
        <span><span className="text-gray-500">Credits </span><span className="font-semibold text-gray-900">{fmtCurrency(topSummary.credits)}</span></span>
        <span title="Cash flow if you close all open legs now at current marks"><span className="text-gray-500">If Closed </span><span className="font-semibold text-gray-900">{fmtCurrency(topSummary.currentValue)}</span></span>
        <span><span className="text-gray-500">Net </span><span className={`font-bold ${sign(topSummary.net)}`}>{fmtCurrency(topSummary.net)}</span></span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{summary.visible_count} visible · {summary.hidden_count} hidden · {Object.keys(positionsMeta).length} position{Object.keys(positionsMeta).length === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="inline-flex items-center gap-1 border border-gray-300 rounded">
            <button
              type="button"
              onClick={() => collapseLevelDown()}
              className="px-1.5 py-0.5 hover:bg-gray-100 text-gray-700 disabled:opacity-30"
              title="Collapse one level (positions, then tags)"
            >−</button>
            <button
              type="button"
              onClick={() => collapseLevelUp()}
              className="px-1.5 py-0.5 hover:bg-gray-100 text-gray-700 disabled:opacity-30 border-l border-gray-300"
              title="Expand one level (tags, then positions)"
            >+</button>
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input type="checkbox" checked={groupByPosition} onChange={e => setGroupByPosition(e.target.checked)} />
            <Layers className="w-3 h-3" /> Position
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input type="checkbox" checked={groupByTag} onChange={e => setGroupByTag(e.target.checked)} />
            <TagIcon className="w-3 h-3" /> Tag
          </label>
        </div>
      </div>

      {/* Progress banner for multi-call ops (auto-classify, bulk tagging) */}
      {progress?.active && (
        <div className="bg-purple-50 border-b border-purple-200 px-4 py-1.5 flex items-center gap-3 text-xs text-purple-900">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span className="font-medium">{progress.message}</span>
          <span className="text-purple-700">{progress.current} / {progress.total}</span>
          <div className="flex-1 h-1.5 bg-purple-100 rounded overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Selection bar */}
      {(selectedTxIds.length > 0 || selectedPositionIds.length > 0) && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-3 text-xs flex-wrap">
          <span className="font-medium text-blue-900">
            {selectedTxIds.length} tx{selectedTxIds.length === 1 ? '' : 's'}
            {selectedPositionIds.length > 0 ? `, ${selectedPositionIds.length} position${selectedPositionIds.length === 1 ? '' : 's'}` : ''} selected
          </span>
          <button
            onClick={handleClassify}
            disabled={selectedTxIds.length < 1}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="Classify selected transactions into a position"
          >
            <Layers className="w-3 h-3" /> Classify
          </button>
          <button
            onClick={handleUnclassify}
            disabled={selectedTxIds.length < 1}
            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50"
            title="Remove selected transactions from their position"
          >
            <X className="w-3 h-3" /> Unclassify
          </button>
          <span className="text-gray-300">|</span>
          <div className="relative">
            <button
              onClick={() => setTagPickerOpen(v => !v)}
              disabled={selectedTxIds.length === 0 && selectedPositionIds.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              title="Add to a custom tag"
            >
              <TagIcon className="w-3 h-3" /> Tag…
            </button>
            {tagPickerOpen && (
              <TagPicker
                allTags={allTags}
                onPick={async (tagId) => { await applyTagToSelection(tagId); setTagPickerOpen(false); }}
                onCreate={async (name) => {
                  const t = await tagCreateMutation.mutateAsync({ name });
                  if (t?.id) { await applyTagToSelection(t.id); }
                  setTagPickerOpen(false);
                }}
                onClose={() => setTagPickerOpen(false)}
              />
            )}
          </div>
          <button onClick={clearSelection} className="ml-auto text-blue-700 hover:underline">Clear selection</button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 m-4 rounded">
            {error?.response?.data?.detail || error.message}
          </div>
        ) : visibleTxs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No transactions in this window.
          </div>
        ) : (
          <UnifiedGrid
            tree={viewTree}
            annotations={annotations}
            tagsByMember={tagsByMember}
            tagsMeta={tagsMeta}
            positionsMeta={positionsMeta}
            positionRollups={positionRollups}
            indexByPosition={indexByPosition}
            selected={selected}
            selectedPositions={selectedPositions}
            collapsedPositions={collapsedPositions}
            collapsedTags={collapsedTags}
            onToggleExpandPosition={(pid) => setCollapsedPositions(prev => {
              const next = new Set(prev);
              if (next.has(pid)) next.delete(pid); else next.add(pid);
              return next;
            })}
            onToggleExpandTag={(tid) => setCollapsedTags(prev => {
              const next = new Set(prev);
              if (next.has(tid)) next.delete(tid); else next.add(tid);
              return next;
            })}
            onSelectTx={toggleSelectTx}
            onSelectPosition={toggleSelectPosition}
            onEditPosition={(pid) => setEditingPositionId(pid)}
            onToggleHidden={toggleHidden}
            onSetDisposition={setDisposition}
            noteEditingId={noteEditingId}
            noteDraft={noteDraft}
            setNoteEditingId={setNoteEditingId}
            setNoteDraft={setNoteDraft}
            saveNote={saveNote}
            currentPriceForLeg={currentPriceForLeg}
            hasOptionLeg={hasOptionLeg}
            groupByPosition={groupByPosition}
            groupByTag={groupByTag}
          />
        )}
      </div>

      {/* Position editor modal */}
      {editingPositionId && (
        <PositionEditorModal
          positionId={editingPositionId}
          meta={positionsMeta[editingPositionId] || {}}
          colorIdx={indexByPosition.get(editingPositionId)}
          onClose={() => setEditingPositionId(null)}
          onSave={(patch) => {
            positionMutation.mutate({ positionId: editingPositionId, patch });
            setEditingPositionId(null);
          }}
        />
      )}

      {/* Tag manager modal */}
      {tagManagerOpen && (
        <TagManagerModal
          tags={allTags}
          onClose={() => setTagManagerOpen(false)}
          onCreate={(name) => tagCreateMutation.mutate({ name })}
          onUpdate={(tagId, patch) => tagUpdateMutation.mutate({ tagId, patch })}
          onDelete={(tagId) => {
            if (window.confirm('Delete this tag and all its memberships?')) {
              tagDeleteMutation.mutate(tagId);
            }
          }}
        />
      )}
    </div>
  );
};

export default TransactionsView;

// =================================================================
// Bucket rollup math (per position or loose-unclassified set)
// =================================================================

function computeBucketRollup(txs, livePriceBySymbol) {
  // FILO open/close matching to derive remaining-open lots and their cost basis.
  // Identical semantics to the prior RollupStrip's per-bucket calc.
  const legsBySymbol = new Map();
  let cost = 0, credits = 0;
  for (const tx of txs) {
    const amt = parseFloat(tx.net_amount) || 0;
    if (amt < 0) cost += amt;
    else credits += amt;
    for (const leg of (tx.legs || [])) {
      const sym = normalizeSymbol(leg.symbol);
      if (!sym) continue;
      const effect = (leg.position_effect || '').toUpperCase();
      const signedQty = parseFloat(leg.amount) || 0;
      const absQty = Math.abs(signedQty);
      const price = parseFloat(leg.price) || 0;
      if (absQty === 0) continue;
      const assetType = (leg.asset_type || '').toUpperCase();
      if (!legsBySymbol.has(sym)) {
        legsBySymbol.set(sym, { lots: [], asset_type: assetType });
      }
      const s = legsBySymbol.get(sym);
      if (effect === 'CLOSING') {
        let rem = absQty;
        while (rem > 0 && s.lots.length > 0) {
          const last = s.lots[s.lots.length - 1];
          if (last.qty <= rem + 1e-9) { rem -= last.qty; s.lots.pop(); }
          else { last.qty -= rem; rem = 0; }
        }
      } else {
        const direction = signedQty > 0 ? 1 : -1;
        s.lots.push({ qty: absQty, price, direction });
      }
    }
  }

  let marketValueTotal = 0;
  let closeOutSigned = 0;
  for (const [sym, s] of legsBySymbol) {
    if (s.lots.length === 0) continue;
    const mult = s.asset_type === 'OPTION' ? 100 : 1;
    let absRemaining = 0;
    for (const lot of s.lots) absRemaining += lot.qty;
    if (absRemaining < 1e-9) continue;
    const direction = s.lots[0].direction;
    const cur = livePriceBySymbol.get(sym);
    if (cur != null) {
      const marketValue = absRemaining * cur * mult;
      marketValueTotal += marketValue;
      closeOutSigned += direction * marketValue;
    }
  }

  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    cost: r2(Math.abs(cost)),
    credits: r2(credits),
    currentValue: r2(marketValueTotal),
    net: r2(credits - Math.abs(cost) + closeOutSigned),
    txCount: txs.length,
  };
}

// =================================================================
// View tree builder (Tag → Position → Tx)
// =================================================================

// Pull the underlying ticker from a list of transactions (positions are
// always single-underlying; loose txs come with their own).
function underlyingOf(txs) {
  for (const tx of txs) {
    for (const leg of (tx.legs || [])) {
      const u = leg.underlying || leg.symbol;
      if (u) return String(u).toUpperCase();
    }
  }
  return '?';
}

function buildViewTree({
  visibleTxs, annotations, positionsMeta, tagsMeta, membersByTag, tagsByMember,
  groupByTag, groupByPosition, groupByUnderlying = false,
}) {
  // Step 1: bucket visible txs by position_id (or null = unclassified)
  const txsByPid = new Map();
  for (const tx of visibleTxs) {
    const pid = annotations[tx.schwab_transaction_id]?.transaction_position_id || null;
    if (!txsByPid.has(pid)) txsByPid.set(pid, []);
    txsByPid.get(pid).push(tx);
  }

  // Step 2: build position nodes (one per position with at least one visible tx)
  const positionNodes = []; // {kind:'position', positionId, meta, txs, tagIds}
  for (const [pid, txs] of txsByPid) {
    if (pid == null) continue;
    positionNodes.push({
      kind: 'position',
      positionId: pid,
      meta: positionsMeta[pid] || { id: pid },
      txs: [...txs].sort(compareTxsForDisplay),
      tagIds: tagsByMember.get(`transaction_position|${pid}`) || new Set(),
    });
  }
  // Sort positions by latest date (open at top, then most recent)
  positionNodes.sort((a, b) => {
    const ad = a.txs.reduce((mx, t) => (t.date && t.date > mx ? t.date : mx), '');
    const bd = b.txs.reduce((mx, t) => (t.date && t.date > mx ? t.date : mx), '');
    return bd.localeCompare(ad);
  });

  // Step 3: loose unclassified txs
  const looseTxNodes = (txsByPid.get(null) || []).slice().sort(compareTxsForDisplay).map(tx => ({ kind: 'tx', tx }));

  // Helper: take a flat list of (position nodes + loose tx nodes) and return
  // them — optionally grouped under {kind:'underlying', symbol, children}.
  const finalizeChildren = (positions, txNodes) => {
    let kids;
    if (groupByPosition) {
      kids = [...positions, ...txNodes];
    } else {
      kids = [
        ...positions.flatMap(p => p.txs.map(tx => ({ kind: 'tx', tx, positionId: p.positionId }))),
        ...txNodes,
      ];
    }
    if (!groupByUnderlying) return kids;
    // Bucket by underlying. Position underlying derived from its first tx; tx
    // underlying from the leg.
    const buckets = new Map();
    for (const k of kids) {
      let sym;
      if (k.kind === 'position') sym = underlyingOf(k.txs);
      else if (k.kind === 'tx') sym = underlyingOf([k.tx]);
      else sym = '?';
      if (!buckets.has(sym)) buckets.set(sym, []);
      buckets.get(sym).push(k);
    }
    const sortedSymbols = [...buckets.keys()].sort();
    return sortedSymbols.map(sym => ({ kind: 'underlying', symbol: sym, children: buckets.get(sym) }));
  };

  if (!groupByTag) {
    return [{ kind: 'section', label: null, children: finalizeChildren(positionNodes, looseTxNodes) }];
  }

  // groupByTag = true: build one section per tag, plus an "Untagged" section
  const tagBuckets = new Map(); // tag_id → {positions: [], txs: []}
  const sortedTagIds = Object.keys(tagsMeta).sort((a, b) =>
    (tagsMeta[a]?.name || '').localeCompare(tagsMeta[b]?.name || '')
  );
  for (const tid of sortedTagIds) tagBuckets.set(tid, { positions: [], txs: [] });

  // Place each position under any tag it's directly tagged with
  for (const p of positionNodes) {
    if (p.tagIds.size === 0) continue;
    for (const tid of p.tagIds) {
      if (!tagBuckets.has(tid)) tagBuckets.set(tid, { positions: [], txs: [] });
      tagBuckets.get(tid).positions.push(p);
    }
  }

  // Place each loose tx under any tag it's directly tagged with
  for (const node of looseTxNodes) {
    const tIds = tagsByMember.get(`transaction|${node.tx.schwab_transaction_id}`) || new Set();
    if (tIds.size === 0) continue;
    for (const tid of tIds) {
      if (!tagBuckets.has(tid)) tagBuckets.set(tid, { positions: [], txs: [] });
      tagBuckets.get(tid).txs.push(node);
    }
  }

  // Untagged bucket: positions with no tag, loose txs with no tag
  const untaggedBucket = { positions: [], txs: [] };
  for (const p of positionNodes) {
    if (p.tagIds.size === 0) untaggedBucket.positions.push(p);
  }
  for (const node of looseTxNodes) {
    const tIds = tagsByMember.get(`transaction|${node.tx.schwab_transaction_id}`) || new Set();
    if (tIds.size === 0) untaggedBucket.txs.push(node);
  }

  const sections = [];
  for (const [tid, bucket] of tagBuckets) {
    if (bucket.positions.length === 0 && bucket.txs.length === 0) continue;
    sections.push({
      kind: 'tag',
      tagId: tid,
      meta: tagsMeta[tid] || { id: tid, name: '?' },
      children: finalizeChildren(bucket.positions, bucket.txs),
    });
  }
  if (untaggedBucket.positions.length > 0 || untaggedBucket.txs.length > 0) {
    sections.push({
      kind: 'tag', tagId: null, meta: { name: 'Untagged' },
      children: finalizeChildren(untaggedBucket.positions, untaggedBucket.txs),
    });
  }
  return sections;
}

// =================================================================
// UnifiedGrid — renders the full Tag → Position → Tx hierarchy
// =================================================================

const UnifiedGrid = ({
  tree, annotations, tagsByMember, tagsMeta, positionsMeta, positionRollups,
  indexByPosition, selected, selectedPositions, collapsedPositions, collapsedTags,
  onToggleExpandPosition, onToggleExpandTag, onSelectTx, onSelectPosition,
  onEditPosition, onToggleHidden, onSetDisposition,
  noteEditingId, noteDraft, setNoteEditingId, setNoteDraft, saveNote,
  currentPriceForLeg, hasOptionLeg, groupByPosition, groupByTag,
}) => {
  return (
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
          <th className="text-right px-2 py-1.5 font-semibold w-20" title="Current mark per leg (live)">Mark</th>
          <th className="text-right px-2 py-1.5 font-semibold w-24" title="Cash flow if you close this leg now at the current mark (signed)">If Closed</th>
          <th className="text-right px-2 py-1.5 font-semibold w-24" title="Net cash from this transaction (signed: + collected, − paid)">Net Cash</th>
          <th className="text-left px-2 py-1.5 font-semibold w-28">Disposition</th>
          <th className="text-left px-2 py-1.5 font-semibold w-48">Note</th>
          <th className="text-center px-2 py-1.5 font-semibold w-12">Hide</th>
        </tr>
      </thead>
      <tbody className="bg-white">
        {tree.map((section, si) => (
          <SectionRows
            key={section.kind === 'tag' ? `tag-${section.tagId || 'untagged'}` : `sec-${si}`}
            section={section}
            depth={section.kind === 'tag' ? 0 : 0}
            annotations={annotations}
            tagsByMember={tagsByMember}
            tagsMeta={tagsMeta}
            positionsMeta={positionsMeta}
            positionRollups={positionRollups}
            indexByPosition={indexByPosition}
            selected={selected}
            selectedPositions={selectedPositions}
            collapsedPositions={collapsedPositions}
            collapsedTags={collapsedTags}
            onToggleExpandPosition={onToggleExpandPosition}
            onToggleExpandTag={onToggleExpandTag}
            onSelectTx={onSelectTx}
            onSelectPosition={onSelectPosition}
            onEditPosition={onEditPosition}
            onToggleHidden={onToggleHidden}
            onSetDisposition={onSetDisposition}
            noteEditingId={noteEditingId}
            noteDraft={noteDraft}
            setNoteEditingId={setNoteEditingId}
            setNoteDraft={setNoteDraft}
            saveNote={saveNote}
            currentPriceForLeg={currentPriceForLeg}
            hasOptionLeg={hasOptionLeg}
            groupByPosition={groupByPosition}
            groupByTag={groupByTag}
          />
        ))}
      </tbody>
    </table>
  );
};

const SectionRows = (props) => {
  const { section, collapsedTags, onToggleExpandTag, groupByTag } = props;
  if (section.kind === 'tag') {
    const tagId = section.tagId;
    const expanded = tagId == null ? true : !collapsedTags.has(tagId);
    const isUntagged = tagId == null;
    return (
      <>
        {groupByTag && (
          <tr className={`border-b border-gray-200 ${isUntagged ? 'bg-gray-50' : 'bg-emerald-50'}`}>
            <td colSpan={14} className="px-3 py-1.5">
              <button
                className="inline-flex items-center gap-1.5 text-left hover:underline"
                onClick={() => tagId != null && onToggleExpandTag(tagId)}
                title={tagId != null ? (expanded ? 'Collapse tag' : 'Expand tag') : ''}
              >
                {tagId != null && (expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />)}
                <TagIcon className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-sm font-bold text-gray-900">{section.meta?.name || 'Untagged'}</span>
                {section.meta?.note && <span className="text-xs text-gray-500">— {section.meta.note}</span>}
                <span className="text-xs text-gray-500">({section.children.length} item{section.children.length === 1 ? '' : 's'})</span>
              </button>
            </td>
          </tr>
        )}
        {expanded && section.children.map((child, i) => (
          <ChildRow key={i} child={child} {...props} />
        ))}
      </>
    );
  }
  // Top-level section without tag grouping (kind:'section')
  return (
    <>
      {section.children.map((child, i) => (
        <ChildRow key={i} child={child} {...props} />
      ))}
    </>
  );
};

const ChildRow = (props) => {
  const { child } = props;
  if (child.kind === 'position') return <PositionRow {...props} node={child} />;
  if (child.kind === 'tx') return <TxRow {...props} tx={child.tx} positionId={child.positionId} />;
  if (child.kind === 'underlying') return <UnderlyingSection {...props} section={child} />;
  return null;
};

const UnderlyingSection = (props) => {
  const { section, collapsedUnderlyings, onToggleExpandUnderlying, drillToUnderlying } = props;
  const sym = section.symbol;
  const collapsed = collapsedUnderlyings && collapsedUnderlyings.has(sym);
  const expanded = !collapsed;
  return (
    <>
      <tr className="border-b border-gray-200 bg-sky-50">
        <td colSpan={14} className="px-3 py-1">
          <button
            className="inline-flex items-center gap-1.5 text-left hover:underline"
            onClick={() => onToggleExpandUnderlying && onToggleExpandUnderlying(sym)}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
            <span className="font-mono text-xs font-bold text-gray-900 bg-white border border-sky-300 px-1.5 py-0.5 rounded">
              {sym}
            </span>
            <span className="text-xs text-gray-500">({section.children.length})</span>
            {drillToUnderlying && (
              <button
                className="ml-2 text-[10px] text-sky-700 hover:underline"
                onClick={(e) => { e.stopPropagation(); drillToUnderlying(sym); }}
                title={`Open ${sym} per-underlying view`}
              >
                drill in →
              </button>
            )}
          </button>
        </td>
      </tr>
      {expanded && section.children.map((child, i) => (
        <ChildRow key={i} child={child} {...props} />
      ))}
    </>
  );
};

const PositionRow = ({
  node, annotations, tagsByMember, tagsMeta, positionRollups, indexByPosition,
  selectedPositions, collapsedPositions, onToggleExpandPosition, onSelectPosition,
  onEditPosition, onToggleHidden, onSetDisposition, onSelectTx, selected,
  noteEditingId, noteDraft, setNoteEditingId, setNoteDraft, saveNote,
  currentPriceForLeg, hasOptionLeg, groupByPosition,
}) => {
  if (!groupByPosition) {
    return (
      <>
        {node.txs.map(tx => (
          <TxRow
            key={tx.schwab_transaction_id}
            {...{
              tx, annotations, selected, onSelectTx, onToggleHidden, onSetDisposition,
              noteEditingId, noteDraft, setNoteEditingId, setNoteDraft, saveNote,
              currentPriceForLeg, hasOptionLeg, indexByPosition, positionId: node.positionId,
            }}
          />
        ))}
      </>
    );
  }

  const pid = node.positionId;
  const meta = node.meta;
  const rollup = positionRollups.get(pid) || { cost: 0, credits: 0, currentValue: 0, net: 0, txCount: node.txs.length };
  const expanded = !collapsedPositions.has(pid);
  const isSelected = selectedPositions.has(pid);
  const color = colorForPosition(pid, indexByPosition);
  const tagIds = node.tagIds;
  // Underlying derived from the position's transactions (positions don't store
  // it directly — every leg of every tx does, and a position is single-underlying).
  const underlyingForPosition = (() => {
    for (const tx of node.txs) {
      for (const leg of (tx.legs || [])) {
        const u = leg.underlying || leg.symbol;
        if (u) return String(u).toUpperCase();
      }
    }
    return '';
  })();
  const sign = (v) => (v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-600');
  const blank = <span className="text-gray-300">—</span>;

  return (
    <>
      <tr className={`border-b border-gray-200 ${color.bg} ${isSelected ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
        <td className="px-1 py-1.5 text-center">
          <input type="checkbox" checked={isSelected} onChange={() => onSelectPosition(pid)} title="Select position (for tag/edit)" />
        </td>
        <td className={`px-0 py-0 w-2 ${color.bar}`}></td>
        <td colSpan={4} className="px-2 py-1.5">
          <div className="inline-flex items-center gap-2">
            <button onClick={() => onToggleExpandPosition(pid)} className="text-gray-500 hover:text-gray-900">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${color.bar}`}>
              {positionTypeLabel(meta?.position_type)}
            </span>
            {underlyingForPosition && (
              <span className="font-mono text-xs font-bold text-gray-900 bg-white border border-gray-300 px-1.5 py-0.5 rounded">
                {underlyingForPosition}
              </span>
            )}
            <button onClick={() => onEditPosition(pid)} className="font-semibold text-gray-900 hover:underline">
              {meta?.name || `Position ${pid.slice(0, 6)}`}
            </button>
            <span className="text-xs text-gray-500">{rollup.txCount} tx{rollup.txCount === 1 ? '' : 's'}</span>
            {tagIds.size > 0 && (
              <span className="inline-flex gap-1">
                {[...tagIds].map(tid => {
                  const t = tagsMeta[tid];
                  return (
                    <span key={tid} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-gray-300" style={{ color: t?.color }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: t?.color }} />
                      {t?.name || '?'}
                    </span>
                  );
                })}
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right text-gray-500"></td>
        <td className="px-2 py-1.5 text-right text-gray-700"></td>
        <td className="px-2 py-1.5 text-right text-gray-700"></td>
        <td className={`px-2 py-1.5 text-right ${rollup.cost > 0 ? 'text-gray-800' : 'text-gray-300'}`} title="Position cost (debits)">
          {rollup.cost > 0 ? fmtCurrency(rollup.cost) : blank}
        </td>
        <td colSpan={3} className="px-2 py-1.5 text-right text-gray-700">
          <span className="text-gray-500 mr-2" title="Credits = cash collected. If Closed = cash flow if you flatten the open legs at current marks. Net = net P&L right now.">Credits {rollup.credits > 0 ? fmtCurrency(rollup.credits) : '—'} · If Closed {rollup.currentValue > 0 ? fmtCurrency(rollup.currentValue) : '—'}</span>
          <span className={`font-bold ${sign(rollup.net)}`}>{fmtCurrency(rollup.net)}</span>
        </td>
      </tr>
      {expanded && node.txs.map(tx => (
        <TxRow
          key={tx.schwab_transaction_id}
          tx={tx}
          positionId={pid}
          annotations={annotations}
          selected={selected}
          onSelectTx={onSelectTx}
          onToggleHidden={onToggleHidden}
          onSetDisposition={onSetDisposition}
          noteEditingId={noteEditingId}
          noteDraft={noteDraft}
          setNoteEditingId={setNoteEditingId}
          setNoteDraft={setNoteDraft}
          saveNote={saveNote}
          currentPriceForLeg={currentPriceForLeg}
          hasOptionLeg={hasOptionLeg}
          indexByPosition={indexByPosition}
        />
      ))}
    </>
  );
};

const TxRow = ({
  tx, annotations, selected, onSelectTx, onToggleHidden, onSetDisposition,
  noteEditingId, noteDraft, setNoteEditingId, setNoteDraft, saveNote,
  currentPriceForLeg, hasOptionLeg, indexByPosition, positionId,
}) => {
  const ann = annotations[tx.schwab_transaction_id] || {};
  const editing = noteEditingId === tx.schwab_transaction_id;
  const showDisposition = hasOptionLeg(tx);
  const net = parseFloat(tx.net_amount || 0);
  const isSelected = selected.has(tx.schwab_transaction_id);
  const pid = positionId || ann.transaction_position_id;
  const color = pid ? colorForPosition(pid, indexByPosition) : null;
  return (
    <tr
      className={`border-b border-gray-100 hover:bg-blue-50 ${ann.hidden ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-inset ring-blue-300' : ''}`}
    >
      <td className="px-1 py-1.5 text-center">
        <input type="checkbox" checked={isSelected} onChange={() => onSelectTx(tx.schwab_transaction_id)} />
      </td>
      <td className={`px-0 py-0 w-2 ${color ? color.bar : ''}`}></td>
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
                {leg.position_effect && <span className="text-[10px] text-gray-500">{leg.position_effect}</span>}
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
        {tx.legs.map((l, i) => (<div key={i}>{l.price != null ? fmtCurrency(l.price) : '-'}</div>))}
      </td>
      <td className="px-2 py-1.5 text-right text-gray-700">
        {tx.legs.map((l, i) => {
          const isClosing = (l.position_effect || '').toUpperCase() === 'CLOSING';
          const cur = isClosing ? null : currentPriceForLeg(l);
          return (<div key={i} className={cur != null ? '' : 'text-gray-300'}>{cur != null ? fmtCurrency(cur) : '—'}</div>);
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
          if (cur != null && traded != null && amt != null) reverse = (cur - traded) * amt * mult;
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
            onChange={e => onSetDisposition(tx, e.target.value)}
            className="text-xs border rounded px-1 py-0.5"
          >
            <option value="">—</option>
            <option value="closed">Closed</option>
            <option value="rolled">Rolled</option>
            <option value="expired">Expired</option>
            <option value="assigned">Assigned</option>
          </select>
        ) : <span className="text-gray-300 text-xs">—</span>}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <div className="flex gap-1">
            <input
              autoFocus
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveNote(tx);
                if (e.key === 'Escape') { setNoteEditingId(null); setNoteDraft(''); }
              }}
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
        <button onClick={() => onToggleHidden(tx)} className="text-gray-500 hover:text-gray-900" title={ann.hidden ? 'Show' : 'Hide'}>
          {ann.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </td>
    </tr>
  );
};

// =================================================================
// CurrentPositionStrip — preserved from prior implementation
// =================================================================

const CurrentPositionStrip = ({ data, realized, collapsed, onToggleCollapsed }) => {
  if (!data) {
    return <div className="bg-white border-b px-4 py-2 text-xs text-gray-500 italic">Loading current position…</div>;
  }
  const stock = data.stock || { quantity: 0, average_cost: 0, cost_basis: 0, current_value: 0, unrealized_pnl: 0 };
  const optionLegs = (data.options || []).map(o => ({
    ...o, premium: o.open_price, asset_type: 'option', pnl: o.unrealized_pnl,
  }));
  const hasStock = Math.abs(parseFloat(stock.quantity) || 0) > 0;
  const hasOptions = optionLegs.length > 0;
  if (!hasStock && !hasOptions) {
    return <div className="bg-white border-b px-4 py-2 text-xs text-gray-500 italic">No open position for this underlying.</div>;
  }

  const stockQty = parseFloat(stock.quantity) || 0;
  const stockCost = Math.abs(parseFloat(stock.cost_basis) || 0);
  const stockMarketValue = Math.abs(parseFloat(stock.current_value) || 0);
  const stockNet = parseFloat(stock.unrealized_pnl) || 0;
  const stockAvg = parseFloat(stock.average_cost) || 0;

  const rows = [];
  if (hasStock) {
    const isLong = stockQty > 0;
    rows.push({
      kind: 'stock', symbol: data.underlying, qty: stockQty, avgPrice: stockAvg,
      cost: isLong ? stockCost : 0, credits: !isLong ? stockCost : 0,
      currentValue: stockMarketValue, net: stockNet,
    });
  }
  for (const o of optionLegs) {
    const qty = parseFloat(o.quantity) || 0;
    const openPrice = parseFloat(o.open_price) || 0;
    const curPrice = parseFloat(o.current_price) || 0;
    const mult = 100;
    const absQty = Math.abs(qty);
    const costOrCredit = absQty * openPrice * mult;
    const marketValue = absQty * curPrice * mult;
    const isLong = qty > 0;
    rows.push({
      kind: 'option', option_type: o.option_type, underlying: o.underlying,
      strike: o.strike, expiration: o.expiration, symbol: o.symbol, qty, avgPrice: openPrice,
      cost: isLong ? costOrCredit : 0, credits: !isLong ? costOrCredit : 0,
      currentValue: marketValue, net: parseFloat(o.unrealized_pnl) || 0,
    });
  }
  const totals = rows.reduce((a, r) => ({
    cost: a.cost + r.cost, credits: a.credits + r.credits,
    currentValue: a.currentValue + r.currentValue, net: a.net + r.net,
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
          {data.underlying_price != null && (
            <span
              className="text-xs text-gray-700 font-mono bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded"
              title={data.underlying_quote_at ? `Quoted ${new Date(data.underlying_quote_at).toLocaleTimeString()}` : 'Underlying spot'}
            >
              {data.underlying} {fmtCurrency(data.underlying_price)}
            </span>
          )}
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
                          asset_type: 'OPTION', option_type: r.option_type,
                          underlying: r.underlying, strike: r.strike, expiration: r.expiration, symbol: r.symbol,
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
                      <span className="ml-2 text-[10px] text-gray-500">@ avg {fmtCurrency(r.avgPrice)}</span>
                    )}
                  </td>
                  <td className={`px-2 py-1 text-right ${r.cost > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                    {r.cost > 0 ? fmtCurrency(r.cost) : blank}
                  </td>
                  <td className={`px-2 py-1 text-right ${r.credits > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                    {r.credits > 0 ? fmtCurrency(r.credits) : blank}
                  </td>
                  <td className="px-2 py-1 text-right text-gray-800">{fmtCurrency(r.currentValue)}</td>
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

// =================================================================
// PositionEditorModal — edit a classified position
// =================================================================

const POSITION_TYPE_OPTIONS = [
  'manual',
  'stock', 'assigned_stock',
  'sold_put', 'sold_call', 'bought_put', 'bought_call',
  'sold_vertical_put', 'sold_vertical_call',
  'bought_vertical_put', 'bought_vertical_call',
  'rolled_options',
  'box_spread', 'iron_condor',
];

const PositionEditorModal = ({ positionId, meta, colorIdx, onClose, onSave }) => {
  const [name, setName] = useState(meta.name || '');
  const [note, setNote] = useState(meta.note || '');
  const [positionType, setPositionType] = useState(meta.position_type || 'manual');
  const color = colorForPosition(positionId, new Map([[positionId, colorIdx ?? 0]]));
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-block w-3 h-3 rounded ${color.bar}`} />
          <h2 className="text-sm font-bold text-gray-900">Edit position</h2>
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
        <label className="block text-xs text-gray-600 mb-1">Position type</label>
        <select
          className="w-full border rounded px-2 py-1 text-sm mb-3"
          value={positionType}
          onChange={e => setPositionType(e.target.value)}
        >
          {POSITION_TYPE_OPTIONS.map(t => (
            <option key={t} value={t}>{positionTypeLabel(t)}</option>
          ))}
        </select>
        <label className="block text-xs text-gray-600 mb-1">Note</label>
        <textarea
          className="w-full border rounded px-2 py-1 text-sm mb-3"
          rows={4}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Context, reasoning, etc."
        />
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => onSave({ name, note, position_type: positionType })}
          >Save</button>
        </div>
        <div className="mt-3 text-[10px] text-gray-400 flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Position ID: {positionId}
        </div>
      </div>
    </div>
  );
};

// =================================================================
// TagManagerModal — list/create/rename/delete tags
// =================================================================

const TagManagerModal = ({ tags, onClose, onCreate, onUpdate, onDelete }) => {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const submitCreate = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    onCreate(newName.trim());
    setNewName('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <TagIcon className="w-4 h-4 text-emerald-700" />
          <h2 className="text-sm font-bold text-gray-900">Manage Tags</h2>
          <button className="ml-auto text-gray-500 hover:text-gray-900" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submitCreate} className="flex gap-2 mb-3">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="New tag name…"
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button type="submit" className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">
            <Plus className="w-3 h-3" /> Add
          </button>
        </form>
        <div className="max-h-80 overflow-auto border rounded">
          {tags.length === 0 ? (
            <div className="p-3 text-xs text-gray-500 italic">No tags yet.</div>
          ) : tags.map(t => {
            const editing = editingId === t.id;
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-b last:border-0 text-sm">
                <span className="inline-block w-3 h-3 rounded" style={{ background: t.color }} />
                {editing ? (
                  <>
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1 border rounded px-1 py-0.5 text-sm" />
                    <input value={editColor} onChange={e => setEditColor(e.target.value)} className="w-20 border rounded px-1 py-0.5 text-xs font-mono" placeholder="#hex" />
                    <button
                      onClick={() => { onUpdate(t.id, { name: editName, color: editColor || null }); setEditingId(null); }}
                      className="text-xs text-blue-600"
                      title="Save"
                    ><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1">{t.name}</span>
                    <button
                      onClick={() => { setEditingId(t.id); setEditName(t.name); setEditColor(t.color || ''); }}
                      className="text-gray-500 hover:text-gray-900"
                      title="Rename / recolor"
                    ><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onDelete(t.id)} className="text-red-600 hover:text-red-800" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// =================================================================
// TagPicker — popover used by the selection bar's "Tag…" button
// =================================================================

// eslint-disable-next-line react/display-name
const TagPicker = ({ allTags, onPick, onCreate, onClose }) => {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() =>
    allTags.filter(t => t.name.toLowerCase().includes(filter.toLowerCase())),
    [allTags, filter]
  );
  const exact = filtered.find(t => t.name.toLowerCase() === filter.trim().toLowerCase());
  const canCreate = filter.trim() && !exact;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute z-40 mt-1 bg-white border rounded shadow-lg w-64 p-2">
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canCreate) onCreate(filter.trim());
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Filter or create…"
          className="w-full border rounded px-2 py-1 text-sm mb-2"
        />
        <div className="max-h-56 overflow-auto">
          {filtered.length === 0 && !canCreate && (
            <div className="px-2 py-1 text-xs text-gray-500 italic">No tags.</div>
          )}
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className="w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-100 rounded text-left"
            >
              <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: t.color }} />
              <span>{t.name}</span>
            </button>
          ))}
          {canCreate && (
            <button
              onClick={() => onCreate(filter.trim())}
              className="w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-emerald-50 rounded text-left text-emerald-700 font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Create "{filter.trim()}"
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export {
  fmtCurrency, fmtQty, fmtDate, fmtExpiry, fmtOptionSymbol, normalizeSymbol,
  POSITION_COLORS, colorForPosition, computeSummary,
  UnifiedGrid, buildViewTree, computeBucketRollup,
  PositionEditorModal, TagManagerModal, TagPicker,
};
