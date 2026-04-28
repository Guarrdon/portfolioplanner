/**
 * Auto-group rules: assign a custom-group TAG to each classified position and
 * to each loose unclassified transaction. Each item gets one *primary* tag
 * (first match wins, decoupled from open/closed status), plus *additional*
 * tags layered on top.
 *
 * Primary tag (first match wins):
 *   1. Cash Mgmt     — underlying ∈ {SGOV, JAAA, FLOT, PULS}
 *   2. Futures       — any leg looks like a future / future option
 *   3. Box Spreads   — position_type = box_spread
 *   4. Big Options   — position_type = bought_*
 *   5. Vertical Strat — position_type = sold_vertical_*
 *   6. Single Strat  — position_type = sold_put / sold_call / rolled_options
 *   7. Covered Stock — position_type = stock / assigned_stock
 *   — (no primary tag; leaves item untagged for manual review)
 *
 * Additional tags (always layered on the primary):
 *   • `closed` — item is fully flat (no open option/stock qty)
 *
 * Year-based grouping is handled by a dedicated date-year filter in the UI;
 * we no longer emit `<year>` tags from auto-group.
 *
 * The user can re-tag any item manually after auto-group commits.
 */

export const TAG_NAMES = {
  cash: 'Cash Mgmt',
  futures: 'Futures',
  box: 'Box Spreads',
  bigOptions: 'Big Options',
  vertical: 'Vertical Strat',
  single: 'Single Strat',
  covered: 'Covered Stock',
  closed: 'closed',
};

const CASH_MGMT_TICKERS = new Set(['SGOV', 'JAAA', 'FLOT', 'PULS']);

const isFuturesLeg = (leg) => {
  const at = (leg?.asset_type || '').toUpperCase();
  if (at === 'FUTURE' || at === 'FUTURE_OPTION') return true;
  const sym = (leg?.symbol || '');
  // CME / CBOT / NYMEX-style future or future-option symbols start with '.' or
  // include exchange suffixes Schwab uses for futures venues.
  if (sym.startsWith('.')) return true;
  if (/:XCME|:XCBT|:XNYM|:XCFE|:XCEC/.test(sym)) return true;
  return false;
};

const txHasFutures = (tx) => (tx?.legs || []).some(isFuturesLeg);

const txUnderlying = (tx) => {
  for (const leg of (tx?.legs || [])) {
    const at = (leg.asset_type || '').toUpperCase();
    if (at === 'CURRENCY' || at === 'CASH_EQUIVALENT') continue;
    const u = leg.underlying || leg.symbol;
    if (u) return String(u).toUpperCase();
  }
  return '';
};

/**
 * Decide the primary tag for a "group item" (either a classified position or a
 * single loose transaction). Returns the tag name string, or null to leave
 * untagged. Open/closed status is no longer part of primary-tag selection —
 * `closed` and the year tag are emitted separately as additional tags.
 */
export const tagForItem = (item) => {
  const { underlying, position_type, txs = [] } = item;

  if (CASH_MGMT_TICKERS.has((underlying || '').toUpperCase())) return TAG_NAMES.cash;
  if (txs.some(txHasFutures)) return TAG_NAMES.futures;
  if (position_type === 'box_spread') return TAG_NAMES.box;

  switch (position_type) {
    case 'bought_put':
    case 'bought_call':
    case 'bought_vertical_put':
    case 'bought_vertical_call':
      return TAG_NAMES.bigOptions;
    case 'sold_vertical_put':
    case 'sold_vertical_call':
      return TAG_NAMES.vertical;
    case 'sold_put':
    case 'sold_call':
    case 'rolled_options':
      return TAG_NAMES.single;
    case 'stock':
    case 'assigned_stock':
      return TAG_NAMES.covered;
    default:
      return null;
  }
};


/**
 * Build the full set of auto-group assignments for an account.
 *
 * Inputs:
 *   - positionsMeta: { [positionId]: { id, name, position_type, ... } }
 *   - txsByPosition: Map<positionId, tx[]>  (computed by caller; null key = loose)
 *   - annotations:   { [txId]: { transaction_position_id, ... } }
 *   - existingMemberships: array of { tag_id, member_type, member_id }
 *   - tagsByName:    Map<lowercase name, tag>  (for de-duping)
 *
 * Returns: array of proposed assignments:
 *   { targetType: 'transaction_position'|'transaction', targetId, tagName, reason: { underlying, position_type, isOpen, lastDate } }
 *
 * Items already tagged with the proposed tag are skipped.
 */
export const buildAutoGroupAssignments = ({
  positionsMeta,
  txsByPosition,
  existingMemberships = [],
  currentYear = new Date().getFullYear(),
}) => {
  const proposals = [];

  // Lookup: which (member_type, member_id) → set of tag names already attached.
  // (Caller resolves tag_id → name; we ignore that and just dedupe by member.)
  const memberHasTagName = new Map(); // `${type}|${id}` → Set<lowercase tag name>
  for (const m of existingMemberships) {
    const k = `${m.member_type}|${m.member_id}`;
    if (!memberHasTagName.has(k)) memberHasTagName.set(k, new Set());
    if (m._tag_name) memberHasTagName.get(k).add(m._tag_name.toLowerCase());
  }
  const alreadyTagged = (type, id, name) =>
    memberHasTagName.get(`${type}|${id}`)?.has(name.toLowerCase());

  // Classified positions
  for (const [pid, meta] of Object.entries(positionsMeta || {})) {
    const txs = txsByPosition.get(pid) || [];
    if (txs.length === 0) continue;
    const underlying = txs.map(txUnderlying).find(Boolean) || '';
    // Derive open/closed and lastDate from the txs.
    const lastDate = txs.reduce((mx, t) => (t.date && t.date > mx ? t.date : mx), '');
    // Heuristic for isOpen: walk option/stock qty across the chain.
    const isOpen = inferIsOpen(txs);
    const item = {
      underlying,
      position_type: meta.position_type || 'manual',
      isOpen,
      lastDate,
      txs,
    };
    const reason = { underlying, position_type: item.position_type, isOpen, lastDate };
    const tag = tagForItem(item);
    if (tag && !alreadyTagged('transaction_position', pid, tag)) {
      proposals.push({ targetType: 'transaction_position', targetId: pid, tagName: tag, reason });
    }
    if (isOpen === false && !alreadyTagged('transaction_position', pid, TAG_NAMES.closed)) {
      // Universal closed marker so the hide-closed filter has a single source.
      proposals.push({ targetType: 'transaction_position', targetId: pid, tagName: TAG_NAMES.closed, reason });
    }
  }

  // Loose unclassified transactions
  const looseTxs = txsByPosition.get(null) || [];
  for (const tx of looseTxs) {
    const underlying = txUnderlying(tx);
    const lastDate = tx.date || '';
    // For a single tx we can't reliably know open/closed without chain context.
    // We only auto-tag the underlying-based rules (Cash Mgmt, Futures) +
    // a closed-by-position-effect heuristic.
    let isOpen = null;
    const optLegs = (tx.legs || []).filter(l => (l.asset_type || '').toUpperCase() === 'OPTION');
    if (optLegs.length > 0) {
      const allOpening = optLegs.every(l => (l.position_effect || '').toUpperCase() === 'OPENING');
      const allClosing = optLegs.every(l => (l.position_effect || '').toUpperCase() === 'CLOSING');
      if (allOpening) isOpen = true;
      else if (allClosing) isOpen = false;
    }
    const item = {
      underlying,
      position_type: 'manual',  // singleton loose tx — don't pretend it's a typed strategy
      isOpen,
      lastDate,
      txs: [tx],
    };
    const reason = { underlying, position_type: item.position_type, isOpen, lastDate };
    const tag = tagForItem(item);
    if (tag && !alreadyTagged('transaction', tx.schwab_transaction_id, tag)) {
      proposals.push({ targetType: 'transaction', targetId: tx.schwab_transaction_id, tagName: tag, reason });
    }
    if (isOpen === false && !alreadyTagged('transaction', tx.schwab_transaction_id, TAG_NAMES.closed)) {
      proposals.push({ targetType: 'transaction', targetId: tx.schwab_transaction_id, tagName: TAG_NAMES.closed, reason });
    }
  }

  return proposals;
};

// Walk the chain's legs to decide whether the position is still open. Mirrors
// the bookkeeping the classifier already does, but standalone so we can use it
// without re-running buildClassifications.
function inferIsOpen(txs) {
  // First check the definitive close signal: an options-only chain whose
  // legs have all expired is resolved no matter what running qty says.
  if (allOptionsExpired(txs)) return false;

  // Sum signed quantities per option leg key and per stock symbol. If any
  // running tally is non-zero, the position has an open component.
  const optionQty = new Map();
  const stockQty = new Map();
  for (const tx of txs) {
    for (const leg of (tx.legs || [])) {
      const at = (leg.asset_type || '').toUpperCase();
      const amt = parseFloat(leg.amount) || 0;
      if (at === 'OPTION') {
        // Empty position_effect on a settlement (RECEIVE_AND_DELIVER) tx
        // means assignment / exercise / expiration — treat as CLOSING.
        const explicit = (leg.position_effect || '').toUpperCase();
        const isSettlement = (tx?.type || '').toUpperCase() === 'RECEIVE_AND_DELIVER';
        const eff = explicit || (isSettlement ? 'CLOSING' : '');
        if (eff !== 'CLOSING' && eff !== 'OPENING') continue;
        const k = `${(leg.option_type || '').toLowerCase()}|${leg.strike}|${leg.expiration}`;
        const delta = eff === 'CLOSING' ? -Math.abs(amt) : Math.abs(amt);
        optionQty.set(k, (optionQty.get(k) || 0) + delta);
      } else if (at === 'EQUITY' || at === 'STOCK' || at === 'COLLECTIVE_INVESTMENT' || at === 'ETF' || at === 'MUTUAL_FUND') {
        const sym = (leg.symbol || '').toUpperCase();
        stockQty.set(sym, (stockQty.get(sym) || 0) + amt);
      }
    }
  }
  for (const v of optionQty.values()) if (Math.abs(v) > 1e-9) return true;
  for (const v of stockQty.values()) if (Math.abs(v) > 1e-9) return true;
  return false;
}

// All options expired (UTC date < today). Mirrors positionMetrics.allOptionsExpired
// — kept inline so autoGroup has no extra cross-module dependency.
function allOptionsExpired(txs) {
  if (!txs || txs.length === 0) return false;
  const today = new Date().toISOString().slice(0, 10);
  let sawOption = false;
  let sawNonOption = false;
  for (const tx of txs) {
    for (const leg of (tx.legs || [])) {
      const at = (leg.asset_type || '').toUpperCase();
      if (at === 'OPTION') {
        sawOption = true;
        const exp = (leg.expiration || '').slice(0, 10);
        if (!exp) return false;
        if (exp >= today) return false;
      } else if (at === 'EQUITY' || at === 'STOCK' || at === 'COLLECTIVE_INVESTMENT' || at === 'ETF' || at === 'MUTUAL_FUND') {
        sawNonOption = true;
      }
    }
  }
  return sawOption && !sawNonOption;
}
