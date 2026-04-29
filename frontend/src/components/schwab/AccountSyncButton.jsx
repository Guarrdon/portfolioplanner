/**
 * AccountSyncButton — per-account "Sync now" with live progress + last-synced.
 *
 * Orchestrates the two real Schwab calls a sync needs:
 *   1. POST /positions/sync (account_ids=[hash]) — positions + balances + greeks/IV
 *   2. GET  /transactions/by-account/:hash?refresh=true — incremental tx pull
 *      (already smart: from last_fetched_at − 2 days → now; backfills 730d on
 *       first run; dedup'd via schwab_transaction_id upsert)
 *
 * Progress comes from `fetchCacheProgress(hash)` while the transactions phase
 * runs (chunks_done / chunks_total). The positions phase is one fast Schwab
 * round-trip, so we just show "Syncing positions…".
 */
import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { syncSchwabPositions } from '../../services/schwab';
import { fetchTransactionsByAccount, fetchCacheProgress } from '../../services/transactions';

const PROGRESS_POLL_MS = 1000;

const formatAgo = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const formatExact = (iso) => {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const AccountSyncButton = ({ accountHash, lastSynced, onSynced }) => {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState('idle'); // idle | positions | transactions | done | error
  const [progress, setProgress] = useState(null); // { chunks_done, chunks_total, txs_loaded, message }
  const [errorMsg, setErrorMsg] = useState(null);
  const [, setTick] = useState(0);
  const pollTimerRef = useRef(null);
  const tickTimerRef = useRef(null);

  // Re-render every minute so "5m ago" updates without a network call.
  useEffect(() => {
    tickTimerRef.current = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(tickTimerRef.current);
  }, []);

  // Clean up polling on unmount.
  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  const startProgressPolling = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const p = await fetchCacheProgress(accountHash);
        setProgress(p);
      } catch {
        // Progress endpoint failures are non-fatal — the main fetch still
        // resolves on its own; we just won't show a chunk count.
      }
    }, PROGRESS_POLL_MS);
  };

  const stopProgressPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const handleClick = async () => {
    if (phase === 'positions' || phase === 'transactions') return;
    setErrorMsg(null);
    setProgress(null);

    try {
      // Phase 1: positions + balances + greeks/IV. Synchronous on the
      // backend — one Schwab call per account, plus the option-quote batch.
      setPhase('positions');
      await syncSchwabPositions([accountHash]);

      // Phase 2: transactions (incremental). Kick off the fetch; in
      // parallel poll the progress endpoint so we can show chunk counts.
      setPhase('transactions');
      startProgressPolling();
      await fetchTransactionsByAccount(accountHash, { refresh: true });
      stopProgressPolling();

      setPhase('done');
      // Refresh anything the new snapshot could have changed. Crucially
      // includes `schwab-accounts-landing` — the global Header reads
      // `account.last_synced` off that query, and without invalidating
      // it the "Sync · 4d ago" label keeps showing 4d after a fresh sync.
      queryClient.invalidateQueries({ queryKey: ['schwab-accounts-landing'] });
      queryClient.invalidateQueries({ queryKey: ['schwab-account-overview'] });
      queryClient.invalidateQueries({ queryKey: ['position-flags'] });
      queryClient.invalidateQueries({ queryKey: ['long-stock-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['covered-calls-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['verticals-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['single-leg-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['big-options-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['transactions', 'by-account', accountHash] });

      if (onSynced) onSynced();

      // Drop back to idle after a moment so the checkmark doesn't linger.
      setTimeout(() => setPhase('idle'), 2500);
    } catch (e) {
      stopProgressPolling();
      setErrorMsg(e?.message || 'Sync failed');
      setPhase('error');
      setTimeout(() => setPhase('idle'), 5000);
    }
  };

  const busy = phase === 'positions' || phase === 'transactions';

  let label;
  let chunkHint = null;
  if (phase === 'positions') {
    label = 'Syncing positions…';
  } else if (phase === 'transactions') {
    label = 'Syncing transactions…';
    if (progress && progress.chunks_total) {
      chunkHint = `${progress.chunks_done || 0}/${progress.chunks_total}`;
    }
  } else if (phase === 'done') {
    label = 'Synced';
  } else if (phase === 'error') {
    label = 'Sync failed';
  } else {
    label = 'Sync now';
  }

  let buttonClass =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition border';
  if (phase === 'done') {
    buttonClass += ' bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (phase === 'error') {
    buttonClass += ' bg-red-50 text-red-700 border-red-200';
  } else if (busy) {
    buttonClass += ' bg-indigo-50 text-indigo-700 border-indigo-200 cursor-wait';
  } else {
    buttonClass +=
      ' bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400';
  }

  let Icon;
  if (phase === 'done') Icon = CheckCircle2;
  else if (phase === 'error') Icon = AlertTriangle;
  else Icon = RefreshCw;

  const ago = formatAgo(lastSynced);
  // When idle and we have a timestamp, fold the staleness into the button
  // itself so the whole control fits on one line in the global header.
  const idleLabel = ago ? `Sync · ${ago}` : 'Sync now';
  const displayLabel = phase === 'idle' ? idleLabel : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={buttonClass}
      title={
        phase === 'error'
          ? `${displayLabel}: ${errorMsg || 'unknown error'}`
          : `Last synced: ${formatExact(lastSynced)}`
      }
    >
      <Icon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {displayLabel}
      {chunkHint && (
        <span className="text-xs opacity-75 tabular-nums">({chunkHint})</span>
      )}
    </button>
  );
};

export default AccountSyncButton;
