/**
 * Live-anchored backward-walk classifier.
 *
 * Algorithm (per underlying):
 *   1. Read live current positions: one "anchor" per stock symbol or option
 *      leg key (type|strike|exp) with a non-zero quantity. Each anchor's
 *      target is its live signed quantity.
 *   2. Walk transactions newest → oldest. For every tx that touches a pending
 *      anchor key, include the tx in the anchor's chain and add its signed
 *      contribution to the running total for that key.
 *   3. Roll detection: if a tx OPENS one of our pending keys *and* CLOSES
 *      some other option key, the closed key is a roll predecessor — add it
 *      to pending with target = 0 and keep walking back until that earlier
 *      key's history is also reconciled.
 *   4. Stop when every pending key's running total matches its target. If we
 *      run out of in-window transactions first, the chain is annotated
 *      `pre_window` with the per-key gap.
 *   5. Merge open chains that share any tx id (multi-leg orders like
 *      verticals where the same opening tx fills several anchors).
 *   6. Forward-walk the leftover (un-anchored) transactions per leg key to
 *      emit closed round-trip chains, then merge multi-leg same-timestamp
 *      groups (box/condor/vertical-style).
 *   7. Classify each chain's shape (stock / sold_put / vertical / box /
 *      iron_condor / rolled_options / manual).
 *   8. Enrich with cost basis, market value, P&L, reconciliation via
 *      `computePositionMetrics`.
 */

import { computePositionMetrics } from './positionMetrics.js';

// ============================================================
// Public surface
// ============================================================

const _humanLabel = {
  stock: 'Stock',
  assigned_stock: 'Assigned Stock',
  sold_put: 'Sold Put',
  sold_call: 'Sold Call',
  bought_put: 'Bought Put',
  bought_call: 'Bought Call',
  sold_vertical_put: 'Sold Vertical Put',
  sold_vertical_call: 'Sold Vertical Call',
  bought_vertical_put: 'Bought Vertical Put',
  bought_vertical_call: 'Bought Vertical Call',
  rolled_options: 'Rolled Options',
  box_spread: 'Box Spread',
  iron_condor: 'Iron Condor',
  manual: 'Position',
};

export const positionTypeLabel = (t) => _humanLabel[t] || _humanLabel.manual;

// ============================================================
// Tx / leg helpers
// ============================================================

const isOption = (leg) => (leg?.asset_type || '').toUpperCase() === 'OPTION';
const isStock = (leg) => {
  const at = (leg?.asset_type || '').toUpperCase();
  return at === 'EQUITY' || at === 'STOCK' || at === 'COLLECTIVE_INVESTMENT' || at === 'ETF' || at === 'MUTUAL_FUND';
};

// Settlement events (assignment / exercise / expiration removal) come back as
// type=RECEIVE_AND_DELIVER and often have no explicit position_effect on the
// option leg — treat empty effect on a settlement tx as CLOSING.
const isSettlementTx = (tx) => (tx?.type || '').toUpperCase() === 'RECEIVE_AND_DELIVER';
const effectiveOptionEffect = (tx, leg) => {
  const explicit = (leg?.position_effect || '').toUpperCase();
  if (explicit) return explicit;
  if (isSettlementTx(tx)) return 'CLOSING';
  return '';
};

const optionLegKey = (leg) =>
  `OPT|${(leg.option_type || '').toLowerCase()}|${leg.strike}|${(leg.expiration || '').slice(0, 10)}`;
const stockLegKey = (leg, fallbackUnderlying) =>
  `STK|${(leg.symbol || leg.underlying || fallbackUnderlying || '').toUpperCase()}`;
const liveOptionKey = (o) =>
  `OPT|${(o.option_type || '').toLowerCase()}|${o.strike}|${(o.expiration || '').slice(0, 10)}`;

const txUnderlying = (tx) => {
  for (const leg of (tx?.legs || [])) {
    const at = (leg.asset_type || '').toUpperCase();
    if (at === 'CURRENCY' || at === 'CASH_EQUIVALENT') continue;
    const u = leg.underlying || leg.symbol;
    if (u) return String(u).toUpperCase();
  }
  return '';
};

const yearOf = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear();
};

// ============================================================
// 1. Live anchors
// ============================================================

const buildAnchors = (underlying, livePayload) => {
  const out = [];
  if (!livePayload) return out;
  const stockQ = Number(livePayload.stock?.quantity || 0);
  if (Math.abs(stockQ) > 1e-9) {
    out.push({ kind: 'stock', legKey: `STK|${underlying}`, target: stockQ, symbol: underlying });
  }
  for (const o of (livePayload.options || [])) {
    const q = Number(o.quantity || 0);
    if (Math.abs(q) > 1e-9) {
      out.push({
        kind: 'option',
        legKey: liveOptionKey(o),
        target: q,
        option_type: o.option_type,
        strike: o.strike,
        expiration: (o.expiration || '').slice(0, 10),
      });
    }
  }
  return out;
};

// ============================================================
// 2-4. Backward walk for one anchor
// ============================================================

// Returns { txIds: Set, reconciled, gaps }.
// txIds includes every transaction the walk pulled in (including roll
// predecessors). A tx may appear in multiple anchors' walks if the order
// covered multiple legs — we de-dupe at the merge step.
const backwardWalk = (anchor, sortedNewestFirst, fallbackUnderlying) => {
  const pending = new Map();  // legKey -> { target, cumulative }
  pending.set(anchor.legKey, { target: anchor.target, cumulative: 0 });
  const txIds = new Set();

  // Index: trade_date → list of txs at that timestamp. Used by roll
  // detection so an OPEN-of-pending in one tx can register CLOSE-of-other
  // legs in any sibling tx that shares the timestamp (Schwab routes rolls
  // as separate single-leg txs sharing a tradeDate).
  const sameTs = new Map();
  for (const tx of sortedNewestFirst) {
    const ts = tx.date || '';
    if (!sameTs.has(ts)) sameTs.set(ts, []);
    sameTs.get(ts).push(tx);
  }

  const reconciled = () => {
    for (const e of pending.values()) {
      if (Math.abs(e.cumulative - e.target) > 1e-9) return false;
    }
    return true;
  };

  // Adds a predecessor leg to pending and (if applicable) records the
  // closing contribution from sibling tx so the walk continues until the
  // predecessor's own opening is found.
  const registerPredecessorLeg = (sibTx, leg) => {
    if (!isOption(leg)) return false;
    const k = optionLegKey(leg);
    if (pending.has(k)) return false;
    if (effectiveOptionEffect(sibTx, leg) !== 'CLOSING') return false;
    pending.set(k, { target: 0, cumulative: parseFloat(leg.amount) || 0 });
    txIds.add(sibTx.schwab_transaction_id);
    return true;
  };

  for (const tx of sortedNewestFirst) {
    // Identify legs that match any currently-pending key.
    const matches = [];
    for (const leg of (tx.legs || [])) {
      let key = null;
      if (isOption(leg)) key = optionLegKey(leg);
      else if (isStock(leg)) key = stockLegKey(leg, fallbackUnderlying);
      else continue;
      if (pending.has(key)) matches.push({ leg, key });
    }
    if (matches.length === 0) continue;

    txIds.add(tx.schwab_transaction_id);
    for (const { leg, key } of matches) {
      pending.get(key).cumulative += parseFloat(leg.amount) || 0;
    }

    // Roll detection. If this tx OPENs any pending key, *any* CLOSING leg
    // of an option key not currently pending — whether in this tx or in a
    // same-timestamp sibling — is a predecessor (rolled-from). We add it
    // with target=0 and let the walk continue back to find its own open.
    const opensAPending = (tx.legs || []).some(l =>
      isOption(l) && pending.has(optionLegKey(l)) && effectiveOptionEffect(tx, l) === 'OPENING'
    );
    if (opensAPending) {
      // Same-tx legs first (multi-leg single-tx rolls).
      for (const leg of (tx.legs || [])) registerPredecessorLeg(tx, leg);
      // Then sibling txs at the same timestamp (Schwab-split rolls).
      const siblings = sameTs.get(tx.date || '') || [];
      for (const sib of siblings) {
        if (sib.schwab_transaction_id === tx.schwab_transaction_id) continue;
        for (const leg of (sib.legs || [])) registerPredecessorLeg(sib, leg);
      }
    }

    if (reconciled()) break;
  }

  const gaps = [];
  for (const [k, e] of pending) {
    const d = e.target - e.cumulative;
    if (Math.abs(d) > 1e-9) gaps.push({ key: k, target: e.target, actual: e.cumulative, gap: d });
  }
  return { txIds, reconciled: reconciled(), gaps };
};

// ============================================================
// 5. Merge open chains that share txs (verticals, boxes, etc.)
// ============================================================

const mergeBySharedTxs = (chains) => {
  if (chains.length <= 1) return chains;
  const parent = chains.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const ai = chains[i].txIds, aj = chains[j].txIds;
      let overlaps = false;
      const small = ai.size <= aj.size ? ai : aj;
      const big = small === ai ? aj : ai;
      for (const id of small) { if (big.has(id)) { overlaps = true; break; } }
      if (overlaps) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < chains.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(chains[i]);
  }
  return Array.from(groups.values()).map(group => {
    const merged = new Set();
    const anchors = [];
    let reconciled = true;
    const gaps = [];
    for (const c of group) {
      for (const id of c.txIds) merged.add(id);
      anchors.push(c.anchor);
      if (!c.reconciled) reconciled = false;
      gaps.push(...c.gaps.map(g => ({ ...g, anchorKey: c.anchor.legKey })));
    }
    return { txIds: merged, anchors, reconciled, gaps };
  });
};

// Same-day multi-leg open detection: union open chains that overlap
// any "logical multi-leg order" (N legs on the same trading day, same
// underlying + expiration + effect, with unique (type, strike) combos).
// Bucketing on day (not timestamp) catches verticals that were opened as
// two separate orders minutes/hours apart, which Schwab does not collapse
// into a single transaction.
const mergeOpenChainsByMultiTxGroup = (openChains, allTxs) => {
  if (openChains.length <= 1) return openChains;
  const buckets = new Map();
  for (const tx of allTxs) {
    for (const leg of (tx.legs || [])) {
      if (!isOption(leg)) continue;
      const eff = effectiveOptionEffect(tx, leg);
      if (eff !== 'OPENING' && eff !== 'CLOSING') continue;
      const und = (leg.underlying || '').toUpperCase();
      if (!und) continue;
      const exp = (leg.expiration || '').slice(0, 10);
      const day = (tx.date || '').slice(0, 10);
      const key = `${day}|${und}|${exp}|${eff}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ tx, leg });
    }
  }
  const groupTxIds = [];
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    const combos = new Set(items.map(it => `${(it.leg.option_type || '').toLowerCase()}|${it.leg.strike}`));
    if (combos.size !== items.length) continue;
    groupTxIds.push(new Set(items.map(it => it.tx.schwab_transaction_id)));
  }
  if (groupTxIds.length === 0) return openChains;

  const parent = openChains.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (const g of groupTxIds) {
    let anchor = -1;
    for (let i = 0; i < openChains.length; i++) {
      let touches = false;
      for (const id of openChains[i].txIds) { if (g.has(id)) { touches = true; break; } }
      if (!touches) continue;
      if (anchor === -1) anchor = i; else union(anchor, i);
    }
  }
  const groups = new Map();
  for (let i = 0; i < openChains.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(openChains[i]);
  }
  return Array.from(groups.values()).map(group => {
    const merged = new Set();
    const anchors = [];
    let reconciled = true;
    const gaps = [];
    for (const c of group) {
      for (const id of c.txIds) merged.add(id);
      anchors.push(...(c.anchors || (c.anchor ? [c.anchor] : [])));
      if (!c.reconciled) reconciled = false;
      gaps.push(...(c.gaps || []));
    }
    return { txIds: merged, anchors, reconciled, gaps };
  });
};

// ============================================================
// 6. Closed chains via forward walk on leftover txs
// ============================================================

// Per-leg-key chain assembly on leftover txs (the txs not consumed by any
// open anchor). Mirrors the previous chain-based classifier but applied only
// to the closed history. Each chain is a round-trip whose qty returned to 0.
const buildClosedChains = (leftoverTxs, underlying) => {
  if (leftoverTxs.length === 0) return [];

  const sorted = [...leftoverTxs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Track active chain per leg key. When qty hits zero, emit and clear.
  const activeOption = new Map();   // optKey -> { txIds: Set, qty }
  const activeStock = new Map();    // stkKey -> { txIds: Set, qty }
  const completed = [];             // [{ txIds: Set }]

  const emit = (active, key, table) => {
    completed.push({ txIds: active.txIds });
    table.delete(key);
  };

  for (const tx of sorted) {
    const txId = tx.schwab_transaction_id;
    for (const leg of (tx.legs || [])) {
      if (isOption(leg)) {
        const eff = effectiveOptionEffect(tx, leg);
        if (eff !== 'OPENING' && eff !== 'CLOSING') continue;
        const key = optionLegKey(leg);
        let active = activeOption.get(key);
        if (!active) { active = { txIds: new Set(), qty: 0 }; activeOption.set(key, active); }
        active.txIds.add(txId);
        active.qty += parseFloat(leg.amount) || 0;
        if (Math.abs(active.qty) < 1e-9) emit(active, key, activeOption);
      } else if (isStock(leg)) {
        const key = stockLegKey(leg, underlying);
        const amt = parseFloat(leg.amount) || 0;
        let active = activeStock.get(key);
        // CLOSING-only stock (sells with no prior buy in window) get their
        // own closing-only chain to avoid absorbing later opens.
        const eff = (leg.position_effect || '').toUpperCase();
        if (!active) { active = { txIds: new Set(), qty: 0, openingSeen: eff === 'OPENING' }; activeStock.set(key, active); }
        active.txIds.add(txId);
        active.qty += amt;
        if (eff === 'OPENING') active.openingSeen = true;
        // Close the chain if qty drained to ≤ 0 *and* we never saw an opening
        // (means it was a pre-window close), or qty hit exactly zero.
        if (Math.abs(active.qty) < 1e-9 || (!active.openingSeen && active.qty <= 1e-9)) {
          emit(active, key, activeStock);
        }
      }
    }
  }
  // Anything still active at the end is a residual closed-but-not-flat chain.
  for (const [k, a] of activeOption) completed.push({ txIds: a.txIds });
  for (const [k, a] of activeStock) completed.push({ txIds: a.txIds });

  // Merge multi-tx leg groups so a vertical/box closed in one trade is one
  // chain, not 2-4 separate ones.
  return mergeMultiTxGroups(completed, sorted);
};

// Same-day legs with unique (type, strike) combos are one logical
// multi-leg order Schwab routed as separate single-leg txs. Group them.
// Day-grain (not timestamp) catches verticals opened as two orders
// minutes apart on the same trading day.
const mergeMultiTxGroups = (chains, txs) => {
  const buckets = new Map();
  for (const tx of txs) {
    for (const leg of (tx.legs || [])) {
      if (!isOption(leg)) continue;
      const eff = effectiveOptionEffect(tx, leg);
      if (eff !== 'OPENING' && eff !== 'CLOSING') continue;
      const und = (leg.underlying || '').toUpperCase();
      if (!und) continue;
      const exp = (leg.expiration || '').slice(0, 10);
      const day = (tx.date || '').slice(0, 10);
      const key = `${day}|${und}|${exp}|${eff}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ tx, leg });
    }
  }
  const groupTxIds = [];
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    const combos = new Set(items.map(it => `${(it.leg.option_type || '').toLowerCase()}|${it.leg.strike}`));
    if (combos.size !== items.length) continue;
    groupTxIds.push(new Set(items.map(it => it.tx.schwab_transaction_id)));
  }
  if (groupTxIds.length === 0) return chains;

  // Union chains that overlap with any same-order group.
  const parent = chains.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (const g of groupTxIds) {
    let anchor = -1;
    for (let i = 0; i < chains.length; i++) {
      let touches = false;
      for (const id of chains[i].txIds) { if (g.has(id)) { touches = true; break; } }
      if (!touches) continue;
      if (anchor === -1) anchor = i; else union(anchor, i);
    }
  }
  const groups = new Map();
  for (let i = 0; i < chains.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, new Set());
    for (const id of chains[i].txIds) groups.get(r).add(id);
  }
  return Array.from(groups.values()).map(txIds => ({ txIds }));
};

// ============================================================
// 7. Chain shape → position_type
// ============================================================

const isBoxUnderlying = (u) => {
  const up = (u || '').toUpperCase();
  return up === 'SPX' || up === 'SPXW';
};

const classifyShape = (chainTxs, annotations, underlying) => {
  const optLegs = [];
  const stockLegs = [];
  for (const tx of chainTxs) {
    for (const leg of (tx.legs || [])) {
      if (isOption(leg)) optLegs.push({ leg, tx });
      else if (isStock(leg)) stockLegs.push({ leg, tx });
    }
  }

  if (optLegs.length === 0 && stockLegs.length > 0) {
    const anyAssigned = chainTxs.some(tx => {
      const ann = annotations?.[tx.schwab_transaction_id];
      if (ann?.disposition === 'assigned') return true;
      const desc = (tx.description || '').toLowerCase();
      return desc.includes('assign');
    });
    return anyAssigned ? 'assigned_stock' : 'stock';
  }

  if (optLegs.length === 0) return 'manual';

  // Collect opening txs and their legs (using effective effect for settlements).
  const openingTxs = chainTxs.filter(tx =>
    (tx.legs || []).some(l => isOption(l) && effectiveOptionEffect(tx, l) === 'OPENING')
  );
  const openingLegs = [];
  for (const tx of openingTxs) {
    for (const leg of (tx.legs || [])) {
      if (isOption(leg) && effectiveOptionEffect(tx, leg) === 'OPENING') openingLegs.push(leg);
    }
  }

  // Multiple distinct opening dates → roll
  const openingDates = new Set(openingTxs.map(t => (t.date || '').slice(0, 10)));
  if (openingDates.size > 1) return 'rolled_options';

  if (openingLegs.length === 0) return 'manual';

  // Single-tx open shapes
  if (openingLegs.length === 1) {
    const ot = (openingLegs[0].option_type || '').toLowerCase();
    if (ot !== 'put' && ot !== 'call') return 'manual';
    const totalNet = openingTxs.reduce((s, t) => s + (parseFloat(t.net_amount) || 0), 0);
    const sold = totalNet > 0;
    return sold ? `sold_${ot}` : `bought_${ot}`;
  }

  if (openingLegs.length === 2) {
    const [a, b] = openingLegs;
    const sameExp = a.expiration && a.expiration === b.expiration;
    const sameType = (a.option_type || '').toLowerCase() === (b.option_type || '').toLowerCase();
    if (sameExp && sameType) {
      const ot = (a.option_type || '').toLowerCase();
      const totalNet = openingTxs.reduce((s, t) => s + (parseFloat(t.net_amount) || 0), 0);
      const sold = totalNet > 0;
      if (ot === 'put') return sold ? 'sold_vertical_put' : 'bought_vertical_put';
      if (ot === 'call') return sold ? 'sold_vertical_call' : 'bought_vertical_call';
    }
    return 'manual';
  }

  if (openingLegs.length === 4) {
    const strikes = new Set(openingLegs.map(l => String(l.strike)));
    if (strikes.size === 2) return isBoxUnderlying(underlying) ? 'box_spread' : 'iron_condor';
    if (strikes.size === 4) return 'iron_condor';
    return 'manual';
  }

  return 'manual';
};

// ============================================================
// 8. Public entry point
// ============================================================

export const buildClassifications = (txs, annotations = {}, liveByUnderlying = {}) => {
  // Filter to candidates: don't classify already-classified txs.
  const candidates = txs.filter(t => !(annotations[t.schwab_transaction_id]?.transaction_position_id));
  if (candidates.length === 0) return [];

  // Group by underlying.
  const byUnd = new Map();
  for (const t of candidates) {
    const u = txUnderlying(t);
    if (!u) continue;
    if (!byUnd.has(u)) byUnd.set(u, []);
    byUnd.get(u).push(t);
  }

  const results = [];

  // Tx ordering for the backward walk: newest first, with OPENING txs ahead
  // of CLOSING txs when timestamps tie. Same-timestamp settlement events
  // often pair an OPEN of a new lot (e.g. assigned/exercised stock arriving)
  // with CLOSEs of the prior lot — processing the OPEN first lets the walk
  // reconcile and stop instead of grabbing unrelated older history.
  const txDirection = (tx) => {
    const opens = (tx.legs || []).some(l => {
      if (isOption(l)) return effectiveOptionEffect(tx, l) === 'OPENING';
      if (isStock(l)) return (l.position_effect || '').toUpperCase() === 'OPENING';
      return false;
    });
    return opens ? 0 : 1;  // 0 sorts before 1
  };

  for (const [und, list] of byUnd) {
    const txById = new Map(list.map(t => [t.schwab_transaction_id, t]));
    const sortedNewestFirst = [...list].sort((a, b) => {
      const ad = a.date || '', bd = b.date || '';
      if (ad !== bd) return bd.localeCompare(ad);
      return txDirection(a) - txDirection(b);
    });
    const live = liveByUnderlying[und] || null;
    const anchors = buildAnchors(und, live);

    // ---- Open chains ----
    const openChainsRaw = anchors.map(a => {
      const r = backwardWalk(a, sortedNewestFirst, und);
      return { anchor: a, ...r };
    });
    let openChains = mergeBySharedTxs(openChainsRaw);
    // Also union opens that were separate per-leg txs sharing one trade
    // timestamp — Schwab routes a 2-/3-/4-leg order as N single-leg txs.
    openChains = mergeOpenChainsByMultiTxGroup(openChains, list);

    // Mark consumed.
    const consumed = new Set();
    for (const c of openChains) for (const id of c.txIds) consumed.add(id);

    // ---- Closed chains from leftovers ----
    const leftover = list.filter(t => !consumed.has(t.schwab_transaction_id));
    const closedChains = buildClosedChains(leftover, und);

    // ---- Materialize ----
    const materialize = (chainTxIds, isOpen, anchorMeta) => {
      const ids = Array.from(chainTxIds);
      const chainTxs = ids.map(id => txById.get(id)).filter(Boolean);
      if (chainTxs.length === 0) return null;
      const lastDate = chainTxs.reduce((mx, t) => (t.date && t.date > mx ? t.date : mx), '');
      const yr = yearOf(lastDate) || '—';
      const positionType = classifyShape(chainTxs, annotations, und);
      const label = positionTypeLabel(positionType);
      const name = isOpen ? `${label} (${yr})` : `${label} ${yr}`.trim();
      const m = computePositionMetrics(chainTxs, und, live, isOpen);
      return {
        transactionIds: ids,
        name,
        isOpen,
        lastDate,
        position_type: positionType,
        underlying: und,
        ...m,
        anchorReconciled: anchorMeta?.reconciled ?? null,
        anchorGaps: anchorMeta?.gaps ?? null,
      };
    };

    for (const c of openChains) {
      const r = materialize(c.txIds, true, c);
      if (r) results.push(r);
    }
    for (const c of closedChains) {
      const r = materialize(c.txIds, false);
      if (r) results.push(r);
    }
  }

  // Sort: opens first, then by underlying, then by lastDate desc.
  results.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (a.underlying !== b.underlying) return a.underlying.localeCompare(b.underlying);
    return (b.lastDate || '').localeCompare(a.lastDate || '');
  });
  return results;
};

// Convenience: compute the unique underlyings present in a tx list. Used by
// the UI to know which live snapshots to fetch.
export const txUnderlyingsIn = (txs) => {
  const out = new Set();
  for (const t of txs) {
    const u = txUnderlying(t);
    if (u) out.add(u);
  }
  return out;
};

// Re-exported so the UI doesn't import the helper from anywhere else.
export { txUnderlying };
