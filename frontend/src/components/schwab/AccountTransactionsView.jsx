/**
 * AccountTransactionsView — three view modes, two action flows.
 *
 *   View modes (segmented top control):
 *     Raw         flat table of every transaction
 *     Classified  flat table of currently-classified positions
 *     Grouped     flat table of tags + their members
 *
 *   Actions (buttons):
 *     Auto Classify  preview chain-detected positions, commit on confirm
 *     Auto Group     preview tag assignments by rule, commit on confirm
 *
 * Stragglers (transactions that don't classify and don't auto-group) remain
 * in the Raw view, untouched. They can be classified/tagged manually later.
 *
 * Route: /schwab/transactions/account/:accountHash
 */
import React, { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Sparkles, Check, X, Tag as TagIcon, Layers, List, ChevronDown, ChevronRight, Plus, Trash2, Search } from 'lucide-react';
import {
  fetchTransactionsByAccount,
  fetchOpenPositionsForUnderlying,
  fetchAllOpenPositions,
  classifyTransactions,
  unclassifyTransactions,
} from '../../services/transactions';
import { fetchTags, createTag, addTagMember, removeTagMember, deleteTag } from '../../services/tags';
import { buildClassifications, positionTypeLabel, txUnderlyingsIn } from '../../utils/autoClassify';
import { buildAutoGroupAssignments } from '../../utils/autoGroup';
import { computePositionMetrics, compareTxsForDisplay } from '../../utils/positionMetrics';

// ---------- formatters ----------

const fmtCurrency = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
};

const fmtDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' });
};

const summarizeLegs = (legs) => {
  if (!legs || legs.length === 0) return '';
  return legs
    .map(l => {
      const at = (l.asset_type || '').toUpperCase();
      if (at === 'CURRENCY') return null;
      if (at === 'OPTION') {
        const cp = (l.option_type || '?')[0].toUpperCase();
        const exp = l.expiration ? l.expiration.slice(2, 10) : '';
        return `${l.underlying || ''} ${exp} ${cp}${l.strike ?? ''} ${l.position_effect || ''} qty=${l.amount ?? ''}`;
      }
      return `${l.symbol || ''} qty=${l.amount ?? ''}`;
    })
    .filter(Boolean)
    .join(' | ');
};

// Action label per leg, derived from amount sign + position_effect.
//   option:  STO / BTO / STC / BTC
//   stock:   BUY / SELL
const legAction = (leg) => {
  const at = (leg?.asset_type || '').toUpperCase();
  const qty = parseFloat(leg?.amount) || 0;
  if (at === 'OPTION') {
    const eff = (leg?.position_effect || '').toUpperCase();
    if (eff === 'OPENING') return qty < 0 ? 'STO' : 'BTO';
    if (eff === 'CLOSING') return qty < 0 ? 'STC' : 'BTC';
    return qty < 0 ? 'SELL' : 'BUY';
  }
  return qty > 0 ? 'BUY' : qty < 0 ? 'SELL' : '—';
};

// One-line leg description for tx detail rows. Includes action, contract/symbol,
// signed qty, and per-leg price. Returns null for currency legs.
const describeLeg = (leg) => {
  const at = (leg?.asset_type || '').toUpperCase();
  if (at === 'CURRENCY') return null;
  const action = legAction(leg);
  const qty = leg?.amount;
  const qtyStr = qty == null ? '?' : (qty > 0 ? `+${qty}` : `${qty}`);
  const priceStr = leg?.price != null ? ` @ ${fmtCurrency(leg.price)}` : '';
  if (at === 'OPTION') {
    const cp = (leg.option_type || '?')[0].toUpperCase();
    const exp = leg.expiration ? leg.expiration.slice(2, 10) : '';
    return { action, body: `${leg.underlying || ''} ${exp} ${cp}${leg.strike ?? ''}  ${qtyStr}${priceStr}` };
  }
  return { action, body: `${leg.symbol || ''}  ${qtyStr}${priceStr}` };
};

const isStockPositionType = (pt) => pt === 'stock' || pt === 'assigned_stock';

const txUnderlying = (tx) => {
  for (const leg of (tx?.legs || [])) {
    const at = (leg.asset_type || '').toUpperCase();
    if (at === 'CURRENCY' || at === 'CASH_EQUIVALENT') continue;
    const u = leg.underlying || leg.symbol;
    if (u) return String(u).toUpperCase();
  }
  return '';
};

const sumNet = (txs) => txs.reduce((s, t) => s + (parseFloat(t.net_amount) || 0), 0);

// ---------- main ----------

const AccountTransactionsView = () => {
  const { accountHash } = useParams();
  const [days, setDays] = useState(365);
  const [view, setView] = useState('raw');  // 'raw' | 'classified' | 'grouped'
  const [classifyPreview, setClassifyPreview] = useState(null);  // proposed chains from Auto Classify
  const [classifying, setClassifying] = useState(false);  // live fetch + classify in flight
  const [groupPreview, setGroupPreview] = useState(null);
  const [committing, setCommitting] = useState(null);  // {current, total, label}
  const [expandedTags, setExpandedTags] = useState(new Set());
  const [expandedPositions, setExpandedPositions] = useState(new Set());
  const [tagPickerForPosition, setTagPickerForPosition] = useState(null);
  const [underlyingFilter, setUnderlyingFilter] = useState('');
  const [hideClosed, setHideClosed] = useState(true);
  const [selectedTxIds, setSelectedTxIds] = useState(() => new Set());
  const [selectedPositionIds, setSelectedPositionIds] = useState(() => new Set());
  const [bulkTagPickerOpen, setBulkTagPickerOpen] = useState(false);
  const queryClient = useQueryClient();

  const switchView = (v) => {
    setView(v);
    setSelectedTxIds(new Set());
    setSelectedPositionIds(new Set());
    setBulkTagPickerOpen(false);
  };

  const toggleTxSelected = (id) => setSelectedTxIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePositionSelected = (id) => setSelectedPositionIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelections = () => {
    setSelectedTxIds(new Set());
    setSelectedPositionIds(new Set());
    setBulkTagPickerOpen(false);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions-account', accountHash, days] });
    queryClient.invalidateQueries({ queryKey: ['all-tags'] });
  };

  const toggleTagExpanded = (tagId) => setExpandedTags(prev => {
    const next = new Set(prev);
    if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
    return next;
  });
  const togglePositionExpanded = (pid) => setExpandedPositions(prev => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ['transactions-account', accountHash, days],
    queryFn: () => fetchTransactionsByAccount(accountHash, { days }),
    enabled: !!accountHash,
    retry: false,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['all-tags'],
    queryFn: () => fetchTags(),
    staleTime: 60 * 1000,
  });

  // Live open-positions snapshot for the whole account. Fetched once on
  // mount and on explicit Refresh; we never auto-refetch in the background.
  // The user controls when "now" is — that's the snapshot we use.
  const { data: livePositions = { positions_by_underlying: {} }, refetch: refetchLive, isFetching: isFetchingLive } = useQuery({
    queryKey: ['live-positions', accountHash],
    queryFn: () => fetchAllOpenPositions({ accountId: accountHash }),
    enabled: !!accountHash,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });
  const livePositionsByUnderlying = livePositions?.positions_by_underlying || {};

  const txs = useMemo(() => data?.transactions || [], [data]);
  const annotations = useMemo(() => data?.annotations || {}, [data]);
  const positionsMeta = useMemo(() => data?.positions || {}, [data]);
  const tagsMeta = useMemo(() => data?.tags || {}, [data]);
  const tagMemberships = useMemo(() => data?.tag_memberships || [], [data]);
  const summary = data?.summary || {};

  const txById = useMemo(() => {
    const m = new Map();
    for (const t of txs) m.set(t.schwab_transaction_id, t);
    return m;
  }, [txs]);

  const txsByPosition = useMemo(() => {
    const m = new Map();
    for (const tx of txs) {
      const pid = annotations[tx.schwab_transaction_id]?.transaction_position_id || null;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid).push(tx);
    }
    return m;
  }, [txs, annotations]);

  // Per-position metrics keyed by position id. Recomputes when txs or live
  // snapshot change. Each entry includes:
  //   { underlying, isOpen, net, cost_basis, market_value, unrealized_pnl,
  //     realized_pnl, avg_cost, open_qty, reconciliation }
  const metricsByPosition = useMemo(() => {
    const m = new Map();
    for (const [pid, list] of txsByPosition) {
      if (pid === null) continue;
      const underlying = list.map(txUnderlying).find(Boolean) || '';
      // A position is "open" if it carries any non-zero option/stock qty.
      const live = livePositionsByUnderlying[underlying] || null;
      // Determine isOpen by walking the chain's txs and checking if any qty
      // remains. computePositionMetrics handles the rest.
      const probe = computePositionMetrics(list, underlying, live, true);
      const isOpen = (probe.open_qty || 0) > 0;
      const metrics = isOpen ? probe : computePositionMetrics(list, underlying, live, false);
      const underlyingPrice = live?.underlying_price ?? null;
      m.set(pid, { underlying, isOpen, underlyingPrice, ...metrics });
    }
    return m;
  }, [txsByPosition, livePositionsByUnderlying]);

  // Tag membership lookup keyed by member.
  const tagsByMember = useMemo(() => {
    const m = new Map();
    for (const tm of tagMemberships) {
      const k = `${tm.member_type}|${tm.member_id}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(tm.tag_id);
    }
    return m;
  }, [tagMemberships]);

  // Members per tag (used in Grouped view).
  const membersByTag = useMemo(() => {
    const m = new Map();
    for (const tm of tagMemberships) {
      if (!m.has(tm.tag_id)) m.set(tm.tag_id, []);
      m.get(tm.tag_id).push(tm);
    }
    return m;
  }, [tagMemberships]);

  // ---------- underlying filter + closed filter ----------
  //
  // Matching syntax (space and `_` are interchangeable as anchor markers):
  //   aa     → contains "aa"          (substring, default)
  //   aa_    → ends with "aa"
  //   _aa    → starts with "aa"
  //   _aa_   → exact match "aa"
  //
  // Internal whitespace inside the needle isn't allowed (tickers don't have it),
  // so leading/trailing whitespace is unambiguously an anchor signal.

  const parsedFilter = useMemo(() => {
    const raw = (underlyingFilter || '').toLowerCase();
    if (!raw.trim()) return null;
    let s = raw;
    let startsWith = false;
    let endsWith = false;
    while (s.length && (s[0] === ' ' || s[0] === '_')) { startsWith = true; s = s.slice(1); }
    while (s.length && (s[s.length - 1] === ' ' || s[s.length - 1] === '_')) { endsWith = true; s = s.slice(0, -1); }
    s = s.trim();
    if (!s) return null;
    return { needle: s, startsWith, endsWith };
  }, [underlyingFilter]);

  const filterActive = !!parsedFilter;
  const passesFilter = (target) => {
    if (!parsedFilter) return true;
    const t = (target || '').toLowerCase();
    const { needle, startsWith, endsWith } = parsedFilter;
    if (startsWith && endsWith) return t === needle;
    if (startsWith) return t.startsWith(needle);
    if (endsWith) return t.endsWith(needle);
    return t.includes(needle);
  };

  const underlyingByPosition = useMemo(() => {
    const m = new Map();
    for (const [pid, list] of txsByPosition) {
      if (pid === null) continue;
      m.set(pid, list.map(txUnderlying).find(Boolean) || '');
    }
    return m;
  }, [txsByPosition]);

  // The "closed" meta-tag — case-insensitive name match. Anything tagged with
  // this tag is treated as closed and can be filtered out via Hide closed.
  const closedTagId = useMemo(() => {
    for (const [tid, meta] of Object.entries(tagsMeta || {})) {
      if ((meta?.name || '').trim().toLowerCase() === 'closed') return tid;
    }
    return null;
  }, [tagsMeta]);

  const closedPositionIds = useMemo(() => {
    const s = new Set();
    if (!closedTagId) return s;
    for (const [key, tagIds] of tagsByMember) {
      if (key.startsWith('transaction_position|') && tagIds.includes(closedTagId)) {
        s.add(key.slice('transaction_position|'.length));
      }
    }
    return s;
  }, [tagsByMember, closedTagId]);

  const closedTxIds = useMemo(() => {
    const s = new Set();
    if (!closedTagId) return s;
    for (const [key, tagIds] of tagsByMember) {
      if (key.startsWith('transaction|') && tagIds.includes(closedTagId)) {
        s.add(key.slice('transaction|'.length));
      }
    }
    return s;
  }, [tagsByMember, closedTagId]);

  const isClosedTx = (tx) => {
    const pid = annotations[tx.schwab_transaction_id]?.transaction_position_id;
    if (pid && closedPositionIds.has(pid)) return true;
    return closedTxIds.has(tx.schwab_transaction_id);
  };

  const filteredTxs = useMemo(() => {
    let out = txs;
    if (filterActive) out = out.filter(t => passesFilter(txUnderlying(t)));
    if (hideClosed && closedTagId) out = out.filter(t => !isClosedTx(t));
    return out;
  }, [txs, filterActive, parsedFilter, hideClosed, closedTagId, closedPositionIds, closedTxIds, annotations]);  // eslint-disable-line react-hooks/exhaustive-deps

  // null when no filter is active (means "all"); otherwise the set of allowed ids.
  const filteredPositionIds = useMemo(() => {
    const closedActive = hideClosed && closedTagId && closedPositionIds.size > 0;
    if (!filterActive && !closedActive) return null;
    const set = new Set();
    for (const [pid, u] of underlyingByPosition) {
      if (filterActive && !passesFilter(u)) continue;
      if (closedActive && closedPositionIds.has(pid)) continue;
      set.add(pid);
    }
    return set;
  }, [underlyingByPosition, filterActive, parsedFilter, hideClosed, closedTagId, closedPositionIds]);  // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTagIds = useMemo(() => {
    const closedActive = hideClosed && closedTagId;
    if (!filterActive && !closedActive) return null;
    const set = new Set();
    for (const tagId of Object.keys(tagsMeta || {})) {
      if (closedActive && tagId === closedTagId) continue;
      if (!filterActive) { set.add(tagId); continue; }
      const members = membersByTag.get(tagId) || [];
      for (const m of members) {
        let u = '';
        if (m.member_type === 'transaction_position') u = underlyingByPosition.get(m.member_id) || '';
        else if (m.member_type === 'transaction') u = txUnderlying(txById.get(m.member_id));
        if (passesFilter(u)) { set.add(tagId); break; }
      }
    }
    return set;
  }, [tagsMeta, membersByTag, underlyingByPosition, txById, filterActive, parsedFilter, hideClosed, closedTagId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- actions ----------

  // Auto Classify is the only classifier. It anchors at live current
  // positions and walks transactions backward to identify the txs that make
  // up each open position. Leftover txs are emitted as closed round-trips.
  const runClassifyPreview = async () => {
    const loose = txs.filter(t => !annotations[t.schwab_transaction_id]?.transaction_position_id);
    if (loose.length === 0) {
      setClassifyPreview([]);
      setGroupPreview(null);
      return;
    }
    setClassifyPreview([]);
    setGroupPreview(null);
    setClassifying(true);
    try {
      // Live snapshot for every underlying we're about to classify. The
      // top-level live-positions query already covers the whole account, but
      // we re-fetch on-demand to guarantee freshness at classification time.
      const unds = txUnderlyingsIn(loose);
      const liveByUnd = {};
      await Promise.all(
        Array.from(unds).map(async (und) => {
          try {
            liveByUnd[und] = await fetchOpenPositionsForUnderlying(und, { accountId: accountHash });
          } catch (_e) {
            liveByUnd[und] = null;
          }
        })
      );
      const chains = buildClassifications(loose, annotations, liveByUnd);
      setClassifyPreview(chains);
    } finally {
      setClassifying(false);
    }
  };

  const commitClassifyPreview = async () => {
    if (!classifyPreview || classifyPreview.length === 0) return;
    setCommitting({ current: 0, total: classifyPreview.length, label: 'Classifying' });
    try {
      let i = 0;
      for (const c of classifyPreview) {
        i += 1;
        setCommitting({ current: i, total: classifyPreview.length, label: 'Classifying' });
        await classifyTransactions(c.transactionIds, { positionType: c.position_type, name: c.name });
      }
      setClassifyPreview(null);
      queryClient.invalidateQueries({ queryKey: ['transactions-account', accountHash, days] });
    } catch (e) {
      window.alert('Classify commit failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    } finally {
      setCommitting(null);
    }
  };

  const runGroupPreview = () => {
    // Annotate existing memberships with their tag name so the rule engine
    // can dedupe items already tagged with the proposed tag.
    const memberships = tagMemberships.map(m => ({
      ...m,
      _tag_name: tagsMeta[m.tag_id]?.name,
    }));
    const proposals = buildAutoGroupAssignments({
      positionsMeta,
      txsByPosition,
      existingMemberships: memberships,
    });
    proposals.sort((a, b) => a.tagName.localeCompare(b.tagName));
    setGroupPreview(proposals);
    setClassifyPreview(null);
  };

  // Single-row mutations — persist immediately.
  const unclassifyPosition = async (pid) => {
    const txs = txsByPosition.get(pid) || [];
    if (txs.length === 0) return;
    if (!window.confirm(`Unclassify ${txs.length} transaction(s) from this position?`)) return;
    try {
      await unclassifyTransactions(txs.map(t => t.schwab_transaction_id));
      invalidate();
    } catch (e) {
      window.alert('Unclassify failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const addTagToTarget = async (tagName, memberType, memberId) => {
    try {
      let tag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!tag) tag = await createTag({ name: tagName });
      try {
        await addTagMember(tag.id, { memberType, memberId });
      } catch (_e) { /* duplicate ok */ }
      invalidate();
    } catch (e) {
      window.alert('Tag failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const classifySelectedTogether = async () => {
    const ids = Array.from(selectedTxIds);
    if (ids.length === 0) return;
    const name = window.prompt(
      `Classify ${ids.length} transaction(s) together as a single position. Optional name:`,
      ''
    );
    if (name === null) return; // cancelled
    try {
      await classifyTransactions(ids, { positionType: 'manual', name: name.trim() || null });
      clearSelections();
      invalidate();
    } catch (e) {
      window.alert('Classify failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const unclassifySelectedPositions = async () => {
    const pids = Array.from(selectedPositionIds);
    if (pids.length === 0) return;
    if (!window.confirm(`Unclassify ${pids.length} position(s)? Their transactions return to the unclassified pool.`)) return;
    const allTxIds = [];
    for (const pid of pids) {
      for (const t of (txsByPosition.get(pid) || [])) allTxIds.push(t.schwab_transaction_id);
    }
    if (allTxIds.length === 0) return;
    try {
      await unclassifyTransactions(allTxIds);
      clearSelections();
      invalidate();
    } catch (e) {
      window.alert('Unclassify failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const combineSelectedPositions = async () => {
    const pids = Array.from(selectedPositionIds);
    if (pids.length < 2) {
      window.alert('Select at least 2 positions to combine.');
      return;
    }
    const allTxIds = [];
    const underlyings = new Set();
    for (const pid of pids) {
      for (const t of (txsByPosition.get(pid) || [])) {
        allTxIds.push(t.schwab_transaction_id);
        const u = txUnderlying(t);
        if (u) underlyings.add(u);
      }
    }
    if (allTxIds.length === 0) return;
    const defaultName = underlyings.size === 1 ? Array.from(underlyings)[0] : 'Combined Position';
    const name = window.prompt(
      `Combine ${allTxIds.length} transaction(s) from ${pids.length} position(s) into one. Name:`,
      defaultName
    );
    if (name === null) return;
    try {
      // Unclassify the source positions, then re-classify the union into one
      // fresh position. The old position records become orphan (no members)
      // and stop appearing in the UI.
      await unclassifyTransactions(allTxIds);
      await classifyTransactions(allTxIds, { positionType: 'manual', name: name.trim() || defaultName });
      clearSelections();
      invalidate();
    } catch (e) {
      window.alert('Combine failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const closeOutSelectedPositions = async () => {
    const pids = Array.from(selectedPositionIds);
    if (pids.length === 0) return;
    if (!window.confirm(`Mark ${pids.length} position(s) as closed?`)) return;
    try {
      // Find or create the `closed` tag (lowercase).
      let tag = allTags.find(t => (t.name || '').trim().toLowerCase() === 'closed');
      if (!tag) tag = await createTag({ name: 'closed' });
      for (const pid of pids) {
        try {
          await addTagMember(tag.id, { memberType: 'transaction_position', memberId: pid });
        } catch (_e) { /* duplicate ok */ }
      }
      clearSelections();
      invalidate();
    } catch (e) {
      window.alert('Close-out failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const groupSelectedIntoTag = async (tagName) => {
    const pids = Array.from(selectedPositionIds);
    if (pids.length === 0 || !tagName) return;
    try {
      let tag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!tag) tag = await createTag({ name: tagName });
      for (const pid of pids) {
        try {
          await addTagMember(tag.id, { memberType: 'transaction_position', memberId: pid });
        } catch (_e) { /* duplicate ok */ }
      }
      clearSelections();
      invalidate();
    } catch (e) {
      window.alert('Group failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const removeTagFromTarget = async (tagId, memberType, memberId) => {
    try {
      await removeTagMember(tagId, { memberType, memberId });
      invalidate();
    } catch (e) {
      window.alert('Untag failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const deleteGroup = async (tagId, tagName, memberCount) => {
    if (!window.confirm(
      `Delete group "${tagName}"? This removes ${memberCount} membership${memberCount === 1 ? '' : 's'} and the tag itself. Member positions/transactions are not affected.`
    )) return;
    try {
      await deleteTag(tagId);
      invalidate();
    } catch (e) {
      window.alert('Delete group failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    }
  };

  const commitGroupPreview = async () => {
    if (!groupPreview || groupPreview.length === 0) return;
    setCommitting({ current: 0, total: groupPreview.length, label: 'Tagging' });
    try {
      // Cache tag-name → tag_id, creating tags lazily.
      const tagIdByName = new Map();
      for (const t of allTags) tagIdByName.set(t.name, t.id);

      let i = 0;
      for (const p of groupPreview) {
        i += 1;
        setCommitting({ current: i, total: groupPreview.length, label: `Tagging (${p.tagName})` });
        let tagId = tagIdByName.get(p.tagName);
        if (!tagId) {
          const created = await createTag({ name: p.tagName });
          tagId = created.id;
          tagIdByName.set(p.tagName, tagId);
        }
        try {
          await addTagMember(tagId, { memberType: p.targetType, memberId: p.targetId });
        } catch (_e) { /* duplicates are fine */ }
      }
      setGroupPreview(null);
      queryClient.invalidateQueries({ queryKey: ['transactions-account', accountHash, days] });
      queryClient.invalidateQueries({ queryKey: ['all-tags'] });
    } catch (e) {
      window.alert('Group commit failed: ' + (e?.response?.data?.detail || e?.message || String(e)));
    } finally {
      setCommitting(null);
    }
  };

  // ---------- render ----------

  const previewActive = !!(classifyPreview || groupPreview);
  const numUnclassified = (txsByPosition.get(null) || []).length;
  const numUntagged = txs.filter(t => {
    const pid = annotations[t.schwab_transaction_id]?.transaction_position_id;
    if (pid) return !tagsByMember.has(`transaction_position|${pid}`);
    return !tagsByMember.has(`transaction|${t.schwab_transaction_id}`);
  }).length;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm px-4 py-2 flex items-center gap-3">
        <Link to="/schwab/positions" className="text-gray-500 hover:text-gray-800" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-bold text-gray-900">
          Account {data?.account_number || `…${(accountHash || '').slice(-4)}`}
        </h1>

        <select value={days} onChange={e => setDays(Number(e.target.value))} className="px-2 py-1 text-xs border rounded">
          <option value={30}>30d</option>
          <option value={90}>90d</option>
          <option value={180}>180d</option>
          <option value={365}>365d</option>
        </select>

        {/* View-mode segmented control */}
        <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs">
          <ViewBtn active={view === 'raw'} onClick={() => switchView('raw')} icon={<List className="w-3 h-3" />}>Raw</ViewBtn>
          <ViewBtn active={view === 'classified'} onClick={() => switchView('classified')} icon={<Layers className="w-3 h-3" />}>Classified</ViewBtn>
          <ViewBtn active={view === 'grouped'} onClick={() => switchView('grouped')} icon={<TagIcon className="w-3 h-3" />}>Grouped</ViewBtn>
        </div>

        {/* Live underlying filter */}
        <div className="relative">
          <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={underlyingFilter}
            onChange={e => setUnderlyingFilter(e.target.value)}
            placeholder="Filter underlying (aa_, _aa, _aa_)"
            title={'aa contains\n_aa starts with\naa_ ends with\n_aa_ exact (a leading or trailing space works the same as `_`)'}
            className="pl-6 pr-6 py-1 text-xs border border-gray-300 rounded w-52"
          />
          {underlyingFilter && (
            <button
              onClick={() => setUnderlyingFilter('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              title="Clear filter"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Hide closed toggle (positions/groups tagged "Closed") */}
        <label
          className="inline-flex items-center gap-1 text-xs text-gray-700 select-none cursor-pointer"
          title={closedTagId ? `${closedPositionIds.size} closed position(s) detected via the "closed" tag` : 'No "closed" tag found yet — create a tag named "closed" to use this filter.'}
        >
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={e => setHideClosed(e.target.checked)}
          />
          Hide closed
        </label>

        <button
          onClick={() => { refetch(); refetchLive(); }}
          disabled={isFetching || isFetchingLive}
          className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
          title="Re-fetch transactions and live open positions"
        >
          <RefreshCw className={`w-3 h-3 ${(isFetching || isFetchingLive) ? 'animate-spin' : ''}`} />
        </button>

        {/* Action buttons */}
        {!previewActive && (
          <>
            <button
              onClick={runClassifyPreview}
              disabled={isLoading || isFetching || numUnclassified === 0 || classifying}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              title={`Anchor at live current positions and walk back to classify ${numUnclassified} loose tx(s)`}
            >
              <Sparkles className={`w-3 h-3 ${classifying ? 'animate-spin' : ''}`} /> Auto Classify
            </button>
            <button
              onClick={runGroupPreview}
              disabled={isLoading || isFetching || txs.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              title="Run auto-group rules"
            >
              <TagIcon className="w-3 h-3" /> Auto Group
            </button>
          </>
        )}
        {classifyPreview && (
          <>
            <button
              onClick={commitClassifyPreview}
              disabled={!!committing || classifying || classifyPreview.length === 0}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              title={classifying ? 'Wait for classification to finish' : ''}
            >
              <Check className="w-3 h-3" />
              {committing ? `${committing.label} ${committing.current}/${committing.total}…` : `Commit Classifications (${classifyPreview.length})`}
            </button>
            <button
              onClick={() => setClassifyPreview(null)}
              disabled={!!committing}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              <X className="w-3 h-3" /> Discard
            </button>
          </>
        )}
        {groupPreview && (
          <>
            <button
              onClick={commitGroupPreview}
              disabled={!!committing}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {committing ? `${committing.label} ${committing.current}/${committing.total}…` : `Commit Groups (${groupPreview.length})`}
            </button>
            <button
              onClick={() => setGroupPreview(null)}
              disabled={!!committing}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              <X className="w-3 h-3" /> Discard
            </button>
          </>
        )}

        <div className="ml-auto text-xs text-gray-600">
          {isLoading ? 'loading…' : (
            <>
              {txs.length} txs · {Object.keys(positionsMeta).length} positions · {numUnclassified} unclassified · {numUntagged} untagged · net {fmtCurrency(summary.total_net_cash)}
            </>
          )}
        </div>
      </div>

      {/* Bulk action bar (visible when there are selections) */}
      {(selectedTxIds.size > 0 || selectedPositionIds.size > 0) && !previewActive && (
        <div className="bg-blue-50 border-b border-blue-200 px-3 py-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold text-blue-900">
            {selectedTxIds.size > 0 && `${selectedTxIds.size} transaction${selectedTxIds.size === 1 ? '' : 's'} selected`}
            {selectedPositionIds.size > 0 && `${selectedPositionIds.size} position${selectedPositionIds.size === 1 ? '' : 's'} selected`}
          </span>
          {selectedTxIds.size > 0 && (
            <button
              onClick={classifySelectedTogether}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-600 text-white hover:bg-purple-700"
            >
              <Layers className="w-3 h-3" /> Classify Together
            </button>
          )}
          {selectedPositionIds.size > 0 && (
            <>
              <div className="relative">
                <button
                  onClick={() => setBulkTagPickerOpen(v => !v)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <TagIcon className="w-3 h-3" /> Group Together…
                </button>
                {bulkTagPickerOpen && (
                  <TagPickerInline
                    allTags={allTags}
                    existingTagIds={new Set()}
                    onPick={async (name) => { setBulkTagPickerOpen(false); await groupSelectedIntoTag(name); }}
                    onClose={() => setBulkTagPickerOpen(false)}
                  />
                )}
              </div>
              {selectedPositionIds.size >= 2 && (
                <button
                  onClick={combineSelectedPositions}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                  title="Merge the selected positions' transactions into one new position"
                >
                  <Layers className="w-3 h-3" /> Combine
                </button>
              )}
              <button
                onClick={closeOutSelectedPositions}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 text-amber-800 bg-white hover:bg-amber-50"
                title="Apply the `closed` tag to the selected positions"
              >
                <Check className="w-3 h-3" /> Close Out
              </button>
              <button
                onClick={unclassifySelectedPositions}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-300 text-red-700 bg-white hover:bg-red-50"
              >
                <Trash2 className="w-3 h-3" /> Unclassify Selected
              </button>
            </>
          )}
          <button
            onClick={clearSelections}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-100"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 m-4 rounded">
            <div className="font-semibold mb-1">Error</div>
            <div className="font-mono whitespace-pre-wrap text-xs">
              {error?.response?.data?.detail || error?.message || String(error)}
            </div>
          </div>
        ) : txs.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No transactions in this window.</div>
        ) : classifyPreview ? (
          <ClassifyPreviewTable preview={classifyPreview} loading={classifying} />
        ) : groupPreview ? (
          <GroupPreviewTable preview={groupPreview} positionsMeta={positionsMeta} txById={txById} />
        ) : view === 'classified' ? (
          <ClassifiedView
            positionsMeta={positionsMeta}
            txsByPosition={txsByPosition}
            tagsMeta={tagsMeta}
            tagsByMember={tagsByMember}
            allTags={allTags}
            numUnclassified={numUnclassified}
            onUnclassify={unclassifyPosition}
            onAddTag={(pid, tagName) => addTagToTarget(tagName, 'transaction_position', pid)}
            onRemoveTag={(pid, tagId) => removeTagFromTarget(tagId, 'transaction_position', pid)}
            tagPickerForPosition={tagPickerForPosition}
            setTagPickerForPosition={setTagPickerForPosition}
            expandedPositions={expandedPositions}
            onTogglePosition={togglePositionExpanded}
            filteredPositionIds={filteredPositionIds}
            passesFilter={passesFilter}
            selectedPositionIds={selectedPositionIds}
            onTogglePositionSelected={togglePositionSelected}
            setSelectedPositionIds={setSelectedPositionIds}
            metricsByPosition={metricsByPosition}
          />
        ) : view === 'grouped' ? (
          <GroupedView
            tagsMeta={tagsMeta}
            membersByTag={membersByTag}
            positionsMeta={positionsMeta}
            txsByPosition={txsByPosition}
            txById={txById}
            annotations={annotations}
            tagsByMember={tagsByMember}
            numUntagged={numUntagged}
            expandedTags={expandedTags}
            expandedPositions={expandedPositions}
            onToggleTag={toggleTagExpanded}
            onTogglePosition={togglePositionExpanded}
            onRemoveMember={(tagId, memberType, memberId) => removeTagFromTarget(tagId, memberType, memberId)}
            onDeleteGroup={deleteGroup}
            filteredTagIds={filteredTagIds}
            filteredPositionIds={filteredPositionIds}
            passesFilter={passesFilter}
            selectedPositionIds={selectedPositionIds}
            selectedTxIds={selectedTxIds}
            onTogglePositionSelected={togglePositionSelected}
            onToggleTxSelected={toggleTxSelected}
            hideClosed={hideClosed && !!closedTagId}
            closedPositionIds={closedPositionIds}
            closedTxIds={closedTxIds}
            metricsByPosition={metricsByPosition}
          />
        ) : (
          <RawView
            txs={filteredTxs}
            selectedTxIds={selectedTxIds}
            onToggleTxSelected={toggleTxSelected}
            setSelectedTxIds={setSelectedTxIds}
          />
        )}
      </div>
    </div>
  );
};

const ViewBtn = ({ active, onClick, icon, children }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-1 px-2 py-1 ${active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
  >
    {icon} {children}
  </button>
);

// ---------- Raw ----------

const RawView = ({ txs, selectedTxIds, onToggleTxSelected, setSelectedTxIds }) => {
  const allSelected = txs.length > 0 && txs.every(t => selectedTxIds.has(t.schwab_transaction_id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedTxIds(prev => {
        const next = new Set(prev);
        for (const t of txs) next.delete(t.schwab_transaction_id);
        return next;
      });
    } else {
      setSelectedTxIds(prev => {
        const next = new Set(prev);
        for (const t of txs) next.add(t.schwab_transaction_id);
        return next;
      });
    }
  };
  return (
    <table className="w-full text-xs border-collapse">
      <thead className="bg-gray-100 sticky top-0 border-b">
        <tr>
          <th className="px-2 py-1 w-6">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              title={allSelected ? 'Deselect all visible' : 'Select all visible'}
            />
          </th>
          <th className="text-left px-2 py-1 w-20">Date</th>
          <th className="text-left px-2 py-1 w-24">Type</th>
          <th className="text-left px-2 py-1 w-16">Acct</th>
          <th className="text-left px-2 py-1 w-16">Cat</th>
          <th className="text-left px-2 py-1">Legs</th>
          <th className="text-right px-2 py-1 w-24">Net</th>
        </tr>
      </thead>
      <tbody className="bg-white">
        {txs.map(tx => {
          const net = parseFloat(tx.net_amount) || 0;
          const checked = selectedTxIds.has(tx.schwab_transaction_id);
          return (
            <tr
              key={tx.schwab_transaction_id}
              className={`border-b border-gray-100 ${checked ? 'bg-blue-50' : ''}`}
            >
              <td className="px-2 py-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleTxSelected(tx.schwab_transaction_id)}
                />
              </td>
              <td className="px-2 py-1 text-gray-700">{fmtDate(tx.date)}</td>
              <td className="px-2 py-1 text-gray-700">{tx.type}</td>
              <td className="px-2 py-1 text-gray-500">{tx.account_number}</td>
              <td className="px-2 py-1 text-gray-500">{tx.category}</td>
              <td className="px-2 py-1 font-mono text-gray-900">{summarizeLegs(tx.legs)}</td>
              <td className={`px-2 py-1 text-right font-semibold ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                {fmtCurrency(net)}
              </td>
            </tr>
          );
        })}
        {txs.length === 0 && (
          <tr><td colSpan={7} className="px-3 py-3 text-center text-gray-500 italic">No transactions match the filter.</td></tr>
        )}
      </tbody>
    </table>
  );
};

// ---------- Classified (current persisted state) ----------

const ClassifiedView = ({
  positionsMeta, txsByPosition, tagsMeta, tagsByMember, allTags,
  numUnclassified, onUnclassify, onAddTag, onRemoveTag,
  tagPickerForPosition, setTagPickerForPosition,
  expandedPositions, onTogglePosition,
  filteredPositionIds, passesFilter,
  selectedPositionIds, onTogglePositionSelected, setSelectedPositionIds,
  metricsByPosition,
}) => {
  const rows = useMemo(() => {
    const out = [];
    for (const [pid, meta] of Object.entries(positionsMeta || {})) {
      if (filteredPositionIds && !filteredPositionIds.has(pid)) continue;
      const txs = txsByPosition.get(pid) || [];
      const underlying = txs.map(txUnderlying).find(Boolean) || '';
      const lastDate = txs.reduce((mx, t) => (t.date && t.date > mx ? t.date : mx), '');
      const pm = metricsByPosition?.get(pid);
      out.push({
        id: pid, meta, underlying, lastDate,
        txCount: txs.length,
        pm,
        tagIds: tagsByMember.get(`transaction_position|${pid}`) || [],
      });
    }
    out.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    return out;
  }, [positionsMeta, txsByPosition, tagsByMember, filteredPositionIds, metricsByPosition]);

  const allSelected = rows.length > 0 && rows.every(r => selectedPositionIds.has(r.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedPositionIds(prev => {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedPositionIds(prev => {
        const next = new Set(prev);
        for (const r of rows) next.add(r.id);
        return next;
      });
    }
  };

  return (
    <>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-100 sticky top-0 border-b">
          <tr>
            <th className="px-2 py-1 w-6">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                title={allSelected ? 'Deselect all visible' : 'Select all visible'}
              />
            </th>
            <th className="text-left px-2 py-1 w-6"></th>
            <th className="text-left px-2 py-1 w-32">Position Type</th>
            <th className="text-left px-2 py-1 w-16">Symbol</th>
            <th className="text-left px-2 py-1 w-20">Last Date</th>
            <th className="text-right px-2 py-1 w-10">Txs</th>
            <th className="text-right px-2 py-1 w-12" title="Open contracts/shares">Qty</th>
            <th className="text-right px-2 py-1 w-24" title="Net cash so far: + collected, − paid">Net Cash</th>
            <th className="text-right px-2 py-1 w-24" title="Cash flow if you flatten the open legs at current marks">If Closed</th>
            <th className="text-right px-2 py-1 w-24" title="Open: P&L if you closed now. Closed: realized P&L.">P&amp;L</th>
            <th className="text-right px-2 py-1 w-12" title="Days from first tx to today (open) or last tx (closed)">Days</th>
            <th className="text-left px-2 py-1 w-28">Reconciliation</th>
            <th className="text-left px-2 py-1">Name</th>
            <th className="text-left px-2 py-1 w-64">Tags</th>
            <th className="text-left px-2 py-1 w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map(r => {
            const expanded = expandedPositions.has(r.id);
            const txs = txsByPosition.get(r.id) || [];
            const selected = selectedPositionIds.has(r.id);
            const pm = r.pm;
            const isOpen = !!pm?.isOpen;
            const pnl = isOpen ? pm?.unrealized_pnl : pm?.realized_pnl;
            return (
              <React.Fragment key={r.id}>
                <tr className={`border-b border-gray-100 ${selected ? 'bg-blue-50' : ''}`}>
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onTogglePositionSelected(r.id)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button onClick={() => onTogglePosition(r.id)} className="text-gray-500 hover:text-gray-900">
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                  <td className="px-2 py-1">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                      {positionTypeLabel(r.meta?.position_type)}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {r.underlying}
                    {pm?.underlyingPrice != null && (
                      <span className="ml-1 text-[10px] text-blue-700 font-normal" title="Underlying spot">
                        @{fmtCurrency(pm.underlyingPrice)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-gray-700">{fmtDate(r.lastDate)}</td>
                  <td className="px-2 py-1 text-right text-gray-700">{r.txCount}</td>
                  <td className="px-2 py-1 text-right font-mono text-[11px]">{isOpen ? (pm?.open_qty ?? '—') : '—'}</td>
                  <td className={`px-2 py-1 text-right font-mono text-[11px] ${pm ? signedCurrencyClass(pm.net || 0) : 'text-gray-400'}`} title={isStockPositionType(r.meta?.position_type) && pm?.cost_basis != null ? `Cost basis: ${fmtCurrency(pm.cost_basis)}` : undefined}>
                    {pm ? fmtCurrency(pm.net || 0) : '—'}
                    {isStockPositionType(r.meta?.position_type) && pm?.cost_basis != null && (
                      <div className="text-[9px] text-gray-500 font-normal">basis {fmtCurrency(pm.cost_basis)}</div>
                    )}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono text-[11px] ${isOpen ? signedCurrencyClass(pm?.market_value || 0) : 'text-gray-400'}`}>
                    {isOpen ? fmtCurrency(pm?.market_value || 0) : '—'}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono font-semibold text-[11px] ${pnl == null ? 'text-gray-400' : signedCurrencyClass(pnl)}`}>
                    {pnl == null ? '—' : fmtCurrency(pnl)}
                  </td>
                  <td className="px-2 py-1 text-right text-gray-600 text-[11px]">{pm?.days_held ?? '—'}</td>
                  <td className="px-2 py-1">{isOpen ? reconciliationBadge(pm?.reconciliation) : <span className="text-[10px] text-gray-400">—</span>}</td>
                  <td className="px-2 py-1 text-gray-600 truncate" style={{maxWidth: '14rem'}}>{r.meta?.name || ''}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.tagIds.map(tid => {
                        const t = tagsMeta[tid];
                        if (!t) return null;
                        return (
                          <span key={tid} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border" style={{ borderColor: t.color, color: t.color }}>
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                            {t.name}
                            <button
                              onClick={() => onRemoveTag(r.id, tid)}
                              className="ml-1 text-gray-400 hover:text-red-600"
                              title="Remove tag"
                            ><X className="w-2.5 h-2.5" /></button>
                          </span>
                        );
                      })}
                      <div className="relative">
                        <button
                          onClick={() => setTagPickerForPosition(tagPickerForPosition === r.id ? null : r.id)}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
                        >
                          <Plus className="w-2.5 h-2.5" /> Tag
                        </button>
                        {tagPickerForPosition === r.id && (
                          <TagPickerInline
                            allTags={allTags}
                            existingTagIds={new Set(r.tagIds)}
                            onPick={async (name) => { await onAddTag(r.id, name); setTagPickerForPosition(null); }}
                            onClose={() => setTagPickerForPosition(null)}
                          />
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1">
                    <button
                      onClick={() => onUnclassify(r.id)}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-red-700 border border-red-200 hover:bg-red-50"
                      title="Unclassify"
                    >
                      <Trash2 className="w-2.5 h-2.5" /> Unclassify
                    </button>
                  </td>
                </tr>
                {expanded && <PositionTxRows txs={txs} indent={1} totalCols={15} />}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={15} className="px-3 py-3 text-center text-gray-500 italic">{filteredPositionIds ? 'No positions match the filter.' : 'No classified positions yet. Click Auto Classify.'}</td></tr>
          )}
        </tbody>
      </table>
      <UnclassifiedSection
        looseTxs={(txsByPosition.get(null) || []).filter(t => passesFilter(txUnderlying(t)))}
        numUnclassified={numUnclassified}
      />
    </>
  );
};

// Tx detail rows shown when a position (or unclassified bucket) is expanded.
// totalCols must match the enclosing table's column count so the rows fill
// the row width without forcing a re-layout.
const PositionTxRows = ({ txs, indent = 1, totalCols = 10 }) => {
  const padLeft = `${indent * 1.5 + 0.5}rem`;
  const labelCols = Math.max(1, totalCols - 1);
  const sorted = useMemo(() => [...txs].sort(compareTxsForDisplay), [txs]);
  return (
    <>
      {sorted.map(tx => {
        const net = parseFloat(tx.net_amount) || 0;
        const sideLabel = net > 0.005 ? 'credit' : net < -0.005 ? 'cost' : '';
        const legDetails = (tx.legs || []).map(describeLeg).filter(Boolean);
        return (
          <tr key={`txdrill-${tx.schwab_transaction_id}`} className="border-b border-gray-50 bg-gray-50 text-[11px] align-top">
            <td colSpan={labelCols} className="py-1 text-gray-700" style={{ paddingLeft: padLeft }}>
              <div className="flex items-baseline gap-3">
                <span className="text-gray-400">↳</span>
                <span className="text-gray-500 whitespace-nowrap w-20">{fmtDate(tx.date)}</span>
                <span className="text-gray-500 whitespace-nowrap w-28 truncate" title={tx.type}>{tx.type}</span>
                <div className="flex flex-col gap-0.5 font-mono text-gray-800">
                  {legDetails.length === 0
                    ? <span className="text-gray-400 italic">—</span>
                    : legDetails.map((d, i) => (
                        <span key={i} className="whitespace-nowrap">
                          <span className={`inline-block w-10 text-[10px] font-bold ${d.action === 'STO' || d.action === 'STC' || d.action === 'SELL' ? 'text-rose-700' : 'text-emerald-700'}`}>{d.action}</span>
                          <span>{d.body}</span>
                        </span>
                      ))}
                </div>
              </div>
            </td>
            <td className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${signedCurrencyClass(net)}`}>
              {fmtCurrency(net)}
              {sideLabel && <span className="ml-1 text-[10px] font-normal text-gray-500">({sideLabel})</span>}
            </td>
          </tr>
        );
      })}
    </>
  );
};

// Inline expandable section for transactions not in any position (Classified view).
const UnclassifiedSection = ({ looseTxs, numUnclassified }) => {
  const [expanded, setExpanded] = useState(false);
  if (numUnclassified === 0) return null;
  return (
    <div className="border-t bg-amber-50">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1.5"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Unclassified ({numUnclassified} transaction{numUnclassified === 1 ? '' : 's'})
        <span className="ml-2 text-amber-700 font-normal italic">— not in any position. Run Auto Classify or classify manually.</span>
      </button>
      {expanded && (
        <table className="w-full text-xs border-collapse">
          <tbody className="bg-white">
            {looseTxs.map(tx => {
              const net = parseFloat(tx.net_amount) || 0;
              return (
                <tr key={`unc-${tx.schwab_transaction_id}`} className="border-b border-gray-100 text-[11px]">
                  <td className="px-2 py-1 pl-8 text-gray-700 w-32">{fmtDate(tx.date)}</td>
                  <td className="px-2 py-1 text-gray-700 w-24">{tx.type}</td>
                  <td className="px-2 py-1 font-mono text-gray-900">{summarizeLegs(tx.legs)}</td>
                  <td className={`px-2 py-1 text-right font-semibold w-28 ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                    {fmtCurrency(net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

const TagPickerInline = ({ allTags, existingTagIds, onPick, onClose }) => {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(
    () => allTags.filter(t => !existingTagIds.has(t.id) && t.name.toLowerCase().includes(filter.toLowerCase())),
    [allTags, existingTagIds, filter]
  );
  const exact = filtered.find(t => t.name.toLowerCase() === filter.trim().toLowerCase());
  const canCreate = filter.trim() && !exact;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute z-40 mt-1 bg-white border rounded shadow-lg w-56 p-2 left-0 top-full">
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canCreate) onPick(filter.trim());
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Filter or create…"
          className="w-full border rounded px-2 py-1 text-xs mb-1"
        />
        <div className="max-h-48 overflow-auto">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => onPick(t.name)}
              className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-100 rounded text-left"
            >
              <span className="inline-block w-2 h-2 rounded" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
          {canCreate && (
            <button
              onClick={() => onPick(filter.trim())}
              className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-emerald-50 rounded text-left text-emerald-700 font-semibold"
            >
              <Plus className="w-3 h-3" /> Create "{filter.trim()}"
            </button>
          )}
        </div>
      </div>
    </>
  );
};

// ---------- Grouped (current persisted state) ----------

const GroupedView = ({
  tagsMeta, membersByTag, positionsMeta, txsByPosition, txById,
  numUntagged, expandedTags, expandedPositions, onToggleTag, onTogglePosition, onRemoveMember,
  onDeleteGroup,
  // Re-derived inside this component:
  annotations,
  tagsByMember,
  filteredTagIds, filteredPositionIds, passesFilter,
  selectedPositionIds, selectedTxIds, onTogglePositionSelected, onToggleTxSelected,
  hideClosed, closedPositionIds, closedTxIds,
  metricsByPosition,
}) => {
  const memberHidden = (m) => {
    if (hideClosed) {
      if (m.member_type === 'transaction_position' && closedPositionIds?.has(m.member_id)) return true;
      if (m.member_type === 'transaction' && closedTxIds?.has(m.member_id)) return true;
    }
    // Underlying filter: drop members whose underlying doesn't match.
    if (m.member_type === 'transaction_position') {
      if (filteredPositionIds && !filteredPositionIds.has(m.member_id)) return true;
    } else if (m.member_type === 'transaction' && passesFilter) {
      const tx = txById.get(m.member_id);
      if (tx && !passesFilter(txUnderlying(tx))) return true;
    }
    return false;
  };

  const rows = useMemo(() => {
    const out = [];
    for (const [tagId, meta] of Object.entries(tagsMeta || {})) {
      if (filteredTagIds && !filteredTagIds.has(tagId)) continue;
      const allMembers = membersByTag.get(tagId) || [];
      const members = allMembers.filter(m => !memberHidden(m));
      if (members.length === 0) continue;
      let net = 0;
      let market_value = 0;
      let cost_basis = 0;
      let stock_cost_basis = 0;
      let unrealized_pnl = 0;
      let realized_pnl = 0;
      let hasOpen = false;
      for (const m of members) {
        if (m.member_type === 'transaction') {
          const t = txById.get(m.member_id);
          if (t) net += parseFloat(t.net_amount) || 0;
        } else if (m.member_type === 'transaction_position') {
          net += sumNet(txsByPosition.get(m.member_id) || []);
          const pm = metricsByPosition?.get(m.member_id);
          const memberMeta = positionsMeta[m.member_id];
          if (pm) {
            if (pm.isOpen) {
              hasOpen = true;
              market_value += pm.market_value || 0;
              cost_basis += pm.cost_basis || 0;
              unrealized_pnl += pm.unrealized_pnl || 0;
              if (isStockPositionType(memberMeta?.position_type) && pm.cost_basis) {
                stock_cost_basis += pm.cost_basis;
              }
            } else {
              realized_pnl += pm.realized_pnl || 0;
            }
          }
        }
      }
      out.push({ id: tagId, meta, members, net, market_value, cost_basis, stock_cost_basis, unrealized_pnl, realized_pnl, hasOpen });
    }
    out.sort((a, b) => (a.meta?.name || '').localeCompare(b.meta?.name || ''));
    return out;
  }, [tagsMeta, membersByTag, txById, txsByPosition, filteredTagIds, hideClosed, closedPositionIds, closedTxIds, filteredPositionIds, passesFilter, metricsByPosition]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-100 sticky top-0 border-b">
          <tr>
            <th className="text-left px-2 py-1 w-56">Tag / Position</th>
            <th className="text-right px-2 py-1 w-14" title="Open contracts/shares">Qty</th>
            <th className="text-right px-2 py-1 w-24" title="Net cash so far: + collected, − paid">Net Cash</th>
            <th className="text-right px-2 py-1 w-24" title="Cash flow if you flatten the open legs at current marks">If Closed</th>
            <th className="text-right px-2 py-1 w-24" title="Open: P&L if you closed now. Closed: realized P&L.">P&amp;L</th>
            <th className="text-right px-2 py-1 w-12" title="Days from first tx to today (open) or last tx (closed)">Days</th>
            <th className="text-left px-2 py-1 w-28">Reconciliation</th>
            <th className="text-right px-2 py-1 w-12">Tx</th>
            <th className="text-right px-2 py-1 w-8"></th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map(r => {
            const expanded = expandedTags.has(r.id);
            return (
              <React.Fragment key={r.id}>
                <tr className="border-b border-gray-100 bg-emerald-50">
                  <td className="px-2 py-1">
                    <button
                      onClick={() => onToggleTag(r.id)}
                      className="inline-flex items-center gap-1.5 hover:underline"
                      title={`${r.members.length} member${r.members.length === 1 ? '' : 's'}`}
                    >
                      {expanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-semibold border" style={{ borderColor: r.meta?.color, color: r.meta?.color }}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.meta?.color }} />
                        {r.meta?.name}
                      </span>
                      <span className="text-[10px] text-gray-500">({r.members.length})</span>
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right text-gray-400 text-[10px]">—</td>
                  <td className={`px-2 py-1 text-right font-mono text-[11px] ${r.hasOpen ? signedCurrencyClass(r.net) : 'text-gray-400'}`} title={r.stock_cost_basis ? `Stock cost basis (sum): ${fmtCurrency(r.stock_cost_basis)}` : undefined}>
                    {r.hasOpen ? fmtCurrency(r.net) : '—'}
                    {r.stock_cost_basis ? (
                      <div className="text-[9px] text-gray-500 font-normal">stock basis {fmtCurrency(r.stock_cost_basis)}</div>
                    ) : null}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono text-[11px] ${r.hasOpen ? signedCurrencyClass(r.market_value) : 'text-gray-400'}`}>
                    {r.hasOpen ? fmtCurrency(r.market_value) : '—'}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono font-semibold text-[11px] ${(r.hasOpen ? r.unrealized_pnl : r.realized_pnl) ? signedCurrencyClass(r.hasOpen ? r.unrealized_pnl : r.realized_pnl) : 'text-gray-400'}`}>
                    {r.hasOpen ? (r.unrealized_pnl ? fmtCurrency(r.unrealized_pnl) : '—') : (r.realized_pnl ? fmtCurrency(r.realized_pnl) : '—')}
                  </td>
                  <td className="px-2 py-1 text-right text-gray-400 text-[10px]">—</td>
                  <td className="px-2 py-1"></td>
                  <td className="px-2 py-1 text-right text-gray-400 text-[10px]">—</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      onClick={() => onDeleteGroup && onDeleteGroup(r.id, r.meta?.name || 'group', (membersByTag.get(r.id) || []).length)}
                      className="text-gray-400 hover:text-red-600"
                      title={`Delete group "${r.meta?.name}" (drops all ${(membersByTag.get(r.id) || []).length} membership${(membersByTag.get(r.id) || []).length === 1 ? '' : 's'} and the tag itself)`}
                    ><Trash2 className="w-3 h-3 inline" /></button>
                  </td>
                </tr>
                {expanded && r.members.map(m => {
                  if (m.member_type === 'transaction_position') {
                    const meta = positionsMeta[m.member_id];
                    const txs = txsByPosition.get(m.member_id) || [];
                    const sym = txs.map(txUnderlying).find(Boolean) || '';
                    const posExpanded = expandedPositions.has(m.member_id);
                    const posSelected = selectedPositionIds?.has(m.member_id);
                    const pm = metricsByPosition?.get(m.member_id);
                    const isPosOpen = pm?.isOpen;
                    return (
                      <React.Fragment key={`${r.id}-${m.member_type}-${m.member_id}`}>
                        <tr className={`border-b border-gray-50 text-[11px] text-gray-700 ${posSelected ? 'bg-blue-50' : 'bg-white'}`}>
                          <td className="py-1 pl-6">
                            <span className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={!!posSelected}
                                onChange={() => onTogglePositionSelected && onTogglePositionSelected(m.member_id)}
                                title="Select position"
                              />
                              <button
                                onClick={() => onTogglePosition(m.member_id)}
                                className="inline-flex items-center gap-1.5 hover:underline"
                              >
                                {posExpanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                                  {positionTypeLabel(meta?.position_type)}
                                </span>
                                <span className="font-mono">{sym}</span>
                                {pm?.underlyingPrice != null && (
                                  <span className="text-[10px] text-blue-700 font-normal" title="Underlying spot">@{fmtCurrency(pm.underlyingPrice)}</span>
                                )}
                                {meta?.name && <span className="text-gray-500 truncate" style={{maxWidth: '14rem'}}>· {meta.name}</span>}
                              </button>
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{isPosOpen ? (pm?.open_qty ?? '—') : '—'}</td>
                          <td className={`px-2 py-1 text-right font-mono ${pm ? signedCurrencyClass(pm.net || 0) : 'text-gray-400'}`} title={isStockPositionType(meta?.position_type) && pm?.cost_basis != null ? `Cost basis: ${fmtCurrency(pm.cost_basis)}` : undefined}>
                            {pm ? fmtCurrency(pm.net || 0) : '—'}
                            {isStockPositionType(meta?.position_type) && pm?.cost_basis != null && (
                              <div className="text-[9px] text-gray-500 font-normal">basis {fmtCurrency(pm.cost_basis)}</div>
                            )}
                          </td>
                          <td className={`px-2 py-1 text-right font-mono ${isPosOpen ? signedCurrencyClass(pm?.market_value || 0) : 'text-gray-400'}`}>
                            {isPosOpen ? fmtCurrency(pm?.market_value || 0) : '—'}
                          </td>
                          <td className={`px-2 py-1 text-right font-mono font-semibold ${(isPosOpen ? pm?.unrealized_pnl : pm?.realized_pnl) == null ? 'text-gray-400' : signedCurrencyClass(isPosOpen ? pm.unrealized_pnl : pm.realized_pnl)}`}>
                            {(isPosOpen ? pm?.unrealized_pnl : pm?.realized_pnl) == null ? '—' : fmtCurrency(isPosOpen ? pm.unrealized_pnl : pm.realized_pnl)}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-600 text-[11px]">{pm?.days_held ?? '—'}</td>
                          <td className="px-2 py-1">{isPosOpen ? reconciliationBadge(pm?.reconciliation) : <span className="text-[10px] text-gray-400">—</span>}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{txs.length}</td>
                          <td className="px-2 py-1 text-right">
                            <button
                              onClick={() => onRemoveMember(r.id, m.member_type, m.member_id)}
                              className="text-gray-400 hover:text-red-600"
                              title="Remove this position from group"
                            ><X className="w-3 h-3 inline" /></button>
                          </td>
                        </tr>
                        {posExpanded && <PositionTxRows txs={txs} indent={2} totalCols={9} />}
                      </React.Fragment>
                    );
                  }
                  // loose tx member
                  const tx = txById.get(m.member_id);
                  const subnet = parseFloat(tx?.net_amount) || 0;
                  const txSelected = selectedTxIds?.has(m.member_id);
                  const label = tx
                    ? `${fmtDate(tx.date)} · ${tx.type} · ${summarizeLegs(tx.legs).slice(0, 80)}`
                    : m.member_id;
                  return (
                    <tr key={`${r.id}-${m.member_type}-${m.member_id}`} className={`border-b border-gray-50 text-[11px] text-gray-700 ${txSelected ? 'bg-blue-50' : 'bg-white'}`}>
                      <td className="px-2 py-1 pl-8" colSpan={4}>
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!txSelected}
                            onChange={() => onToggleTxSelected && onToggleTxSelected(m.member_id)}
                            title="Select transaction"
                          />
                          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-gray-100 text-gray-700">tx</span>
                          <span>{label}</span>
                        </span>
                      </td>
                      <td className={`px-2 py-1 text-right font-mono font-semibold ${signedCurrencyClass(subnet)}`}>{fmtCurrency(subnet)}</td>
                      <td className="px-2 py-1"></td>
                      <td className="px-2 py-1"></td>
                      <td className="px-2 py-1"></td>
                      <td className="px-2 py-1 text-right">
                        <button
                          onClick={() => onRemoveMember(r.id, m.member_type, m.member_id)}
                          className="text-gray-400 hover:text-red-600"
                          title="Remove from this group"
                        ><X className="w-3 h-3 inline" /></button>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-3 text-center text-gray-500 italic">{filteredTagIds ? 'No tags match the filter.' : 'No tags yet. Click Auto Group.'}</td></tr>
          )}
        </tbody>
      </table>
      <UntaggedSection
        positionsMeta={positionsMeta}
        txsByPosition={txsByPosition}
        annotations={annotations}
        tagsByMember={tagsByMember}
        expandedPositions={expandedPositions}
        onTogglePosition={onTogglePosition}
        numUntagged={numUntagged}
        filteredPositionIds={filteredPositionIds}
        passesFilter={passesFilter}
        hideClosed={hideClosed}
        closedPositionIds={closedPositionIds}
        closedTxIds={closedTxIds}
      />
    </>
  );
};

// Untagged section (Grouped view): every position with no tag + every loose tx
// with no tag. Expandable, with position-level drill-down.
const UntaggedSection = ({
  positionsMeta, txsByPosition, annotations, tagsByMember,
  expandedPositions, onTogglePosition, numUntagged,
  filteredPositionIds, passesFilter,
  hideClosed, closedPositionIds, closedTxIds,
}) => {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => {
    const out = [];
    // Untagged positions
    for (const [pid, meta] of Object.entries(positionsMeta || {})) {
      if (tagsByMember.has(`transaction_position|${pid}`)) continue;
      if (filteredPositionIds && !filteredPositionIds.has(pid)) continue;
      if (hideClosed && closedPositionIds?.has(pid)) continue;
      const txs = txsByPosition.get(pid) || [];
      out.push({ kind: 'position', id: pid, meta, txs });
    }
    // Untagged loose txs
    for (const tx of (txsByPosition.get(null) || [])) {
      if (tagsByMember.has(`transaction|${tx.schwab_transaction_id}`)) continue;
      if (passesFilter && !passesFilter(txUnderlying(tx))) continue;
      if (hideClosed && closedTxIds?.has(tx.schwab_transaction_id)) continue;
      out.push({ kind: 'tx', id: tx.schwab_transaction_id, tx });
    }
    return out;
  }, [positionsMeta, txsByPosition, tagsByMember, filteredPositionIds, passesFilter, hideClosed, closedPositionIds, closedTxIds]);

  if (numUntagged === 0 && items.length === 0) return null;

  return (
    <div className="border-t bg-amber-50">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 inline-flex items-center gap-1.5"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Untagged ({items.length} item{items.length === 1 ? '' : 's'})
        <span className="ml-2 text-amber-700 font-normal italic">— positions and loose transactions not assigned to any group.</span>
      </button>
      {expanded && (
        <table className="w-full text-xs border-collapse">
          <tbody className="bg-white">
            {items.map(item => {
              if (item.kind === 'position') {
                const sym = item.txs.map(txUnderlying).find(Boolean) || '';
                const net = sumNet(item.txs);
                const posExpanded = expandedPositions.has(item.id);
                return (
                  <React.Fragment key={`untag-pos-${item.id}`}>
                    <tr className="border-b border-gray-100 text-[11px]">
                      <td className="py-1 pl-6" colSpan={4}>
                        <button
                          onClick={() => onTogglePosition(item.id)}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          {posExpanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                            {positionTypeLabel(item.meta?.position_type)}
                          </span>
                          <span className="font-mono">{sym}</span>
                          {item.meta?.name && <span className="text-gray-500">· {item.meta.name}</span>}
                          <span className="text-gray-400">({item.txs.length} tx)</span>
                        </button>
                      </td>
                      <td className={`px-2 py-1 text-right font-semibold ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                        {fmtCurrency(net)}
                      </td>
                    </tr>
                    {posExpanded && <PositionTxRows txs={item.txs} indent={2} totalCols={5} />}
                  </React.Fragment>
                );
              }
              const tx = item.tx;
              const net = parseFloat(tx.net_amount) || 0;
              return (
                <tr key={`untag-tx-${item.id}`} className="border-b border-gray-100 text-[11px]">
                  <td className="px-2 py-1 pl-8 w-32 text-gray-700">{fmtDate(tx.date)}</td>
                  <td className="px-2 py-1 w-24 text-gray-700">{tx.type}</td>
                  <td className="px-2 py-1 font-mono text-gray-900">{summarizeLegs(tx.legs)}</td>
                  <td className="px-2 py-1"></td>
                  <td className={`px-2 py-1 text-right font-semibold w-28 ${net > 0 ? 'text-green-700' : net < 0 ? 'text-red-700' : 'text-gray-600'}`}>
                    {fmtCurrency(net)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ---------- Preview tables ----------


const GroupPreviewTable = ({ preview, positionsMeta, txById }) => (
  <table className="w-full text-xs border-collapse">
    <thead className="bg-emerald-50 sticky top-0 border-b">
      <tr>
        <th className="text-left px-2 py-1 w-40">Proposed Tag</th>
        <th className="text-left px-2 py-1 w-32">Target Type</th>
        <th className="text-left px-2 py-1 w-16">Symbol</th>
        <th className="text-left px-2 py-1 w-32">Position Type / Name</th>
        <th className="text-left px-2 py-1 w-16">State</th>
        <th className="text-left px-2 py-1 w-20">Last Date</th>
      </tr>
    </thead>
    <tbody className="bg-white">
      {preview.map((p, i) => {
        let label = '';
        if (p.targetType === 'transaction_position') {
          const meta = positionsMeta[p.targetId];
          label = `${positionTypeLabel(meta?.position_type)}${meta?.name ? ` · ${meta.name}` : ''}`;
        } else {
          const tx = txById.get(p.targetId);
          label = tx ? `tx ${(tx.type || '')} ${summarizeLegs(tx.legs).slice(0, 60)}` : `tx ${p.targetId.slice(0, 10)}`;
        }
        const isOpenLabel = p.reason.isOpen === true ? 'OPEN' : p.reason.isOpen === false ? 'closed' : '?';
        return (
          <tr key={i} className="border-b border-gray-100">
            <td className="px-2 py-1">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">{p.tagName}</span>
            </td>
            <td className="px-2 py-1 text-gray-600">{p.targetType === 'transaction_position' ? 'position' : 'loose tx'}</td>
            <td className="px-2 py-1 font-mono">{p.reason.underlying}</td>
            <td className="px-2 py-1 text-gray-700">{label}</td>
            <td className="px-2 py-1"><span className={`text-[10px] font-semibold ${p.reason.isOpen ? 'text-emerald-700' : 'text-gray-500'}`}>{isOpenLabel}</span></td>
            <td className="px-2 py-1 text-gray-700">{fmtDate(p.reason.lastDate)}</td>
          </tr>
        );
      })}
      {preview.length === 0 && (
        <tr><td colSpan={6} className="px-3 py-3 text-center text-gray-500 italic">Nothing to tag (everything already matches an existing tag, or no rule matched).</td></tr>
      )}
    </tbody>
  </table>
);

const reconciliationBadge = (rec) => {
  if (!rec) return null;
  const map = {
    pending: { cls: 'bg-gray-100 text-gray-600 border-gray-300', label: '…' },
    reconciled: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: '✓ reconciled' },
    pre_window: { cls: 'bg-amber-100 text-amber-900 border-amber-300', label: '⚠ pre-window' },
    discrepancy: { cls: 'bg-red-100 text-red-800 border-red-300', label: '✗ discrepancy' },
    no_live_data: { cls: 'bg-gray-100 text-gray-600 border-gray-300', label: 'no live data' },
  };
  const m = map[rec.state] || map.pending;
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${m.cls}`}
      title={rec.summary}
    >
      {m.label}
    </span>
  );
};

const signedCurrencyClass = (v) => v > 0.005 ? 'text-green-700' : v < -0.005 ? 'text-red-700' : 'text-gray-500';

const ClassifyPreviewTable = ({ preview, loading }) => {
  if (loading && preview.length === 0) {
    return <div className="p-4 text-sm text-gray-500 italic">Fetching live open positions and classifying…</div>;
  }
  // Group rows by open vs closed for clarity.
  const opens = preview.filter(g => g.isOpen);
  const closeds = preview.filter(g => !g.isOpen);

  return (
    <div>
      {/* OPEN POSITIONS */}
      <table className="w-full text-xs border-collapse">
        <thead className="bg-indigo-50 sticky top-0 border-b">
          <tr>
            <th className="text-left px-2 py-1 w-32">Position Type</th>
            <th className="text-left px-2 py-1 w-16">Symbol</th>
            <th className="text-left px-2 py-1 w-20">Last Date</th>
            <th className="text-right px-2 py-1 w-10">Txs</th>
            <th className="text-right px-2 py-1 w-28" title="Net cash so far: + collected, − paid">Net Cash</th>
            <th className="text-right px-2 py-1 w-28" title="Cash flow if you flatten the open legs at current marks">If Closed</th>
            <th className="text-right px-2 py-1 w-28" title="P&L if you closed now">P&amp;L</th>
            <th className="text-left px-2 py-1 w-28">Reconciliation</th>
            <th className="text-left px-2 py-1">Auto Name / Detail</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {opens.length === 0 && (
            <tr><td colSpan={9} className="px-3 py-3 text-center text-gray-500 italic">No open positions inferred from the loose transactions.</td></tr>
          )}
          {opens.map((g, i) => {
            const rec = g.reconciliation;
            return (
              <tr key={`o-${i}`} className="border-b border-gray-100">
                <td className="px-2 py-1"><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">{positionTypeLabel(g.position_type)}</span></td>
                <td className="px-2 py-1 font-mono">{g.underlying}</td>
                <td className="px-2 py-1 text-gray-700">{fmtDate(g.lastDate)}</td>
                <td className="px-2 py-1 text-right text-gray-700">{g.transactionIds.length}</td>
                <td className={`px-2 py-1 text-right font-mono ${g.net == null ? 'text-gray-500' : signedCurrencyClass(g.net)}`}>
                  {g.net == null ? '—' : fmtCurrency(g.net)}
                </td>
                <td className={`px-2 py-1 text-right font-mono ${g.market_value == null ? 'text-gray-500' : signedCurrencyClass(g.market_value)}`}>
                  {g.market_value == null ? '—' : fmtCurrency(g.market_value)}
                </td>
                <td className={`px-2 py-1 text-right font-mono font-semibold ${g.unrealized_pnl == null ? 'text-gray-500' : signedCurrencyClass(g.unrealized_pnl)}`}>
                  {g.unrealized_pnl == null ? '—' : fmtCurrency(g.unrealized_pnl)}
                </td>
                <td className="px-2 py-1">{reconciliationBadge(rec)}</td>
                <td className="px-2 py-1 text-gray-600">
                  <span className="font-medium">{g.name}</span>
                  {rec && rec.state !== 'reconciled' && rec.state !== 'pending' && (
                    <span className="ml-2 text-gray-500 italic">{rec.summary}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* CLOSED POSITIONS */}
      <div className="mt-4 px-3 py-1 text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-y">
        Closed round-trips ({closeds.length})
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-2 py-1 w-32">Position Type</th>
            <th className="text-left px-2 py-1 w-16">Symbol</th>
            <th className="text-left px-2 py-1 w-20">Last Date</th>
            <th className="text-right px-2 py-1 w-10">Txs</th>
            <th className="text-right px-2 py-1 w-28">Realized P&amp;L</th>
            <th className="text-left px-2 py-1">Auto Name</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {closeds.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-3 text-center text-gray-500 italic">No closed round-trips in the loose transactions.</td></tr>
          )}
          {closeds.map((g, i) => (
            <tr key={`c-${i}`} className="border-b border-gray-100">
              <td className="px-2 py-1"><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">{positionTypeLabel(g.position_type)}</span></td>
              <td className="px-2 py-1 font-mono">{g.underlying}</td>
              <td className="px-2 py-1 text-gray-700">{fmtDate(g.lastDate)}</td>
              <td className="px-2 py-1 text-right text-gray-700">{g.transactionIds.length}</td>
              <td className={`px-2 py-1 text-right font-mono font-semibold ${signedCurrencyClass(g.realized_pnl || 0)}`}>{fmtCurrency(g.realized_pnl || 0)}</td>
              <td className="px-2 py-1 text-gray-600">{g.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AccountTransactionsView;
