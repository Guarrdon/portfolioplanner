/**
 * Per-position metrics computed from a chain's txs + a live snapshot.
 *
 * Used in two places:
 *   - the By-Underlying preview (proposed chains, before commit)
 *   - the Classified / Grouped views (saved positions, after commit)
 *
 * Metrics:
 *   - qty            magnitude of the open position the chain holds
 *   - cost_basis     cash we paid in to be in the position (signed:
 *                    positive = paid, negative = credit / received)
 *   - market_value   live qty × current price (signed: positive = owned,
 *                    negative = owed)
 *   - unrealized_pnl market_value + sum(net_amount over chain)
 *   - realized_pnl   sum(net_amount) for closed chains
 *   - avg_cost       average per-share open price (stock only)
 *   - reconciliation { state, summary } where state is one of:
 *                      reconciled | pre_window | discrepancy | no_live_data
 *
 * `livePayload` is the per-underlying object: { stock: {…}, options: [...] }.
 */

const isOption = (leg) => (leg?.asset_type || '').toUpperCase() === 'OPTION';
const isStock = (leg) => {
  const at = (leg?.asset_type || '').toUpperCase();
  return at === 'EQUITY' || at === 'STOCK' || at === 'COLLECTIVE_INVESTMENT' || at === 'ETF' || at === 'MUTUAL_FUND';
};
const isSettlementTx = (tx) => (tx?.type || '').toUpperCase() === 'RECEIVE_AND_DELIVER';
const effectiveOptionEffect = (tx, leg) => {
  const explicit = (leg?.position_effect || '').toUpperCase();
  if (explicit) return explicit;
  if (isSettlementTx(tx)) return 'CLOSING';
  return '';
};

const optKeyOfLeg = (leg) =>
  `${(leg.option_type || '').toLowerCase()}|${leg.strike}|${(leg.expiration || '').slice(0, 10)}`;
const optKeyOfLive = (o) =>
  `${(o.option_type || '').toLowerCase()}|${o.strike}|${(o.expiration || '').slice(0, 10)}`;

// Today (UTC date string yyyy-mm-dd). Anything whose expiration is < today is
// definitively resolved (expired / assigned / exercised) — regardless of
// whether we have the settlement tx in our data window.
const todayKey = () => new Date().toISOString().slice(0, 10);

// Earliest leg expiration on a tx (yyyy-mm-dd), or null if none.
const minLegExpiration = (tx) => {
  let m = null;
  for (const leg of (tx?.legs || [])) {
    const exp = leg?.expiration;
    if (!exp) continue;
    const e = String(exp).slice(0, 10);
    if (!m || e < m) m = e;
  }
  return m;
};

/**
 * Sort comparator for transactions inside a position or group.
 *   primary:    tx.date desc (newest first)
 *   tiebreaker: min leg expiration desc (live near-term first; no expiration
 *               sinks to the bottom)
 */
export const compareTxsForDisplay = (a, b) => {
  const ad = a?.date || '';
  const bd = b?.date || '';
  if (ad !== bd) return bd.localeCompare(ad);
  const ae = minLegExpiration(a);
  const be = minLegExpiration(b);
  if (ae && be) return be.localeCompare(ae);
  if (ae && !be) return -1;
  if (!ae && be) return 1;
  return 0;
};

const dayDiff = (aIso, bIso) => {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
};

/**
 * If a chain is purely options and every option leg has an expiration date
 * strictly before today, the position is resolved no matter what our running
 * qty says. Returns true when the chain should be treated as closed even if
 * the chain assembly couldn't match a closing tx.
 */
export const allOptionsExpired = (chainTxs) => {
  if (!chainTxs || chainTxs.length === 0) return false;
  const today = todayKey();
  let sawOption = false;
  let sawNonOption = false;
  for (const tx of chainTxs) {
    for (const leg of (tx.legs || [])) {
      if (isOption(leg)) {
        sawOption = true;
        const exp = (leg.expiration || '').slice(0, 10);
        if (!exp) return false;       // unknown expiration → can't conclude
        if (exp >= today) return false; // any leg still alive → not all expired
      } else if (isStock(leg)) {
        sawNonOption = true;
      }
    }
  }
  return sawOption && !sawNonOption;
};

const liveOptionByKey = (live) => {
  const m = new Map();
  for (const o of (live?.options || [])) {
    m.set(optKeyOfLive(o), { qty: Number(o.quantity || 0), current_price: Number(o.current_price || 0) });
  }
  return m;
};

// Walk the chain's txs and compute the open qty per leg key:
//   - stock symbol → signed qty (positive long, negative short)
//   - option leg key → magnitude (always non-negative)
const chainOpenQtys = (chainTxs, fallbackUnderlying) => {
  const stockSigned = new Map();
  const optionMag = new Map();
  for (const tx of chainTxs) {
    for (const leg of (tx.legs || [])) {
      const amt = parseFloat(leg.amount) || 0;
      if (isStock(leg)) {
        const sym = (leg.symbol || leg.underlying || fallbackUnderlying || '').toUpperCase();
        stockSigned.set(sym, (stockSigned.get(sym) || 0) + amt);
      } else if (isOption(leg)) {
        const eff = effectiveOptionEffect(tx, leg);
        if (eff !== 'OPENING' && eff !== 'CLOSING') continue;
        const k = optKeyOfLeg(leg);
        optionMag.set(k, (optionMag.get(k) || 0) + (eff === 'CLOSING' ? -Math.abs(amt) : Math.abs(amt)));
      }
    }
  }
  return { stockSigned, optionMag };
};

/**
 * Compute metrics for one position chain.
 *
 * @param chainTxs   array of normalized tx records belonging to this chain
 * @param underlying ticker symbol (best guess if a leg lacks underlying)
 * @param live       live snapshot for this underlying, or null
 * @param isOpen     boolean — is the chain currently open?
 *
 * @returns object with:
 *   net, cost_basis, market_value, unrealized_pnl, realized_pnl, avg_cost,
 *   open_qty, reconciliation
 */
export const computePositionMetrics = (chainTxs, underlying, live, isOpen) => {
  const net = chainTxs.reduce((s, t) => s + (parseFloat(t.net_amount) || 0), 0);

  let first_date = null;
  let last_date = null;
  for (const t of chainTxs) {
    if (!t?.date) continue;
    if (!first_date || t.date < first_date) first_date = t.date;
    if (!last_date || t.date > last_date) last_date = t.date;
  }

  // Force-close: an options-only chain whose every leg has expired is resolved
  // even if our running qty says otherwise (the settlement tx is outside the
  // data window). Caller may pass isOpen=true; we override.
  if (isOpen && allOptionsExpired(chainTxs)) {
    isOpen = false;
  }

  if (!isOpen) {
    return {
      net,
      cost_basis: null,
      market_value: null,
      unrealized_pnl: null,
      realized_pnl: net,
      avg_cost: null,
      open_qty: null,
      reconciliation: null,
      first_date,
      last_date,
      days_held: dayDiff(first_date, last_date),
    };
  }

  const { stockSigned, optionMag } = chainOpenQtys(chainTxs, underlying);
  const liveOpts = live ? liveOptionByKey(live) : new Map();
  const liveStock = live?.stock;

  let market_value = 0;
  let open_qty = 0;
  let avg_cost = null;
  let matched = false;
  let anyOver = false;
  let anyUnder = false;
  const detail = [];

  // Stock side
  for (const [sym, chainQ] of stockSigned) {
    if (Math.abs(chainQ) < 1e-9) continue;
    open_qty += Math.abs(chainQ);
    if (live === null || live === undefined) {
      detail.push(`stock ${sym}: ${chainQ} classified, live unavailable`);
      continue;
    }
    // The account-wide live payload aggregates stock by underlying with
    // current_value already computed (qty * current_price summed across
    // accounts). We use that directly — current_price isn't sent at the
    // bucket level.
    const lq = Number(liveStock?.quantity || 0);
    market_value += Number(liveStock?.current_value || 0);
    matched = true;
    if (liveStock?.average_cost) avg_cost = Number(liveStock.average_cost);
    if (Math.abs(lq - chainQ) < 1e-9) {
      // matched
    } else if (Math.abs(lq) > Math.abs(chainQ)) {
      anyUnder = true;
      const gap = lq - chainQ;
      detail.push(`stock ${sym}: ${chainQ} classified, ${lq} live (gap ${gap > 0 ? '+' : ''}${gap})`);
    } else {
      anyOver = true;
      detail.push(`stock ${sym}: ${chainQ} classified > ${lq} live`);
    }
  }

  // Option side
  for (const [k, chainMag] of optionMag) {
    if (Math.abs(chainMag) < 1e-9) continue;
    open_qty += chainMag;
    const ll = liveOpts.get(k);
    if (!ll) {
      detail.push(`opt ${k}: ${chainMag} classified, live (none)`);
      anyOver = true;
      continue;
    }
    market_value += ll.qty * ll.current_price * 100;  // signed
    matched = true;
    const liveMag = Math.abs(ll.qty);
    const diff = liveMag - chainMag;
    if (Math.abs(diff) < 1e-9) {
      // matched
    } else if (diff > 0) {
      anyUnder = true;
      detail.push(`opt ${k}: ${chainMag} classified, ${liveMag} live (gap +${diff})`);
    } else {
      anyOver = true;
      detail.push(`opt ${k}: ${chainMag} classified > ${liveMag} live`);
    }
  }

  const cost_basis = -net;
  const unrealized_pnl = market_value + net;

  let reconciliation;
  if (live === null || live === undefined) {
    reconciliation = { state: 'no_live_data', summary: 'no live snapshot for this underlying' };
  } else if (!matched) {
    reconciliation = { state: 'no_live_data', summary: 'no live leg matched this chain' };
  } else if (!anyOver && !anyUnder) {
    reconciliation = { state: 'reconciled', summary: 'matches live account' };
  } else if (anyOver) {
    reconciliation = { state: 'discrepancy', summary: detail.join('; ') };
  } else {
    reconciliation = { state: 'pre_window', summary: detail.join('; ') };
  }

  return {
    net,
    cost_basis,
    market_value,
    unrealized_pnl,
    realized_pnl: null,
    avg_cost,
    open_qty,
    reconciliation,
    first_date,
    last_date,
    days_held: dayDiff(first_date, todayKey()),
  };
};
