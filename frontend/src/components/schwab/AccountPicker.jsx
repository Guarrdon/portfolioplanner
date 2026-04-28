import React, { useEffect, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight } from 'lucide-react';
import { fetchActualPositions } from '../../services/schwab';

export const LAST_ACCOUNT_KEY = 'schwab.lastSelectedAccountHash';

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);

/**
 * Reusable picker for Schwab accounts. Used for both the Account menu landing
 * (lists accounts → drill into AccountOverview) and Schwab Positions
 * (auto-jump to last-selected → AccountTransactionsView).
 *
 * Props:
 *   title, description       — header copy
 *   buildTargetPath(hash)    — where to navigate when an account is picked
 *   autoRedirectIfRemembered — if true, mounting redirects to last-selected
 */
export default function AccountPicker({
  title = 'Select an account',
  description = 'Pick a Schwab account to drill in.',
  buildTargetPath,
  autoRedirectIfRemembered = false,
}) {
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schwab-accounts-landing'],
    queryFn: () => fetchActualPositions(),
  });

  const accounts = useMemo(() => data?.accounts || [], [data]);
  const positions = useMemo(() => data?.positions || [], [data]);

  const positionCountByAccount = useMemo(
    () =>
      accounts.reduce((acc, a) => {
        acc[a.account_hash] = positions.filter((p) => p.account_id === a.account_hash).length;
        return acc;
      }, {}),
    [accounts, positions]
  );

  useEffect(() => {
    if (!autoRedirectIfRemembered) return;
    if (!accounts.length) return;
    const remembered = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (remembered && accounts.some((a) => a.account_hash === remembered)) {
      navigate(buildTargetPath(remembered), { replace: true });
    }
  }, [autoRedirectIfRemembered, accounts, navigate, buildTargetPath]);

  if (isLoading) return <div className="p-6 text-gray-500">Loading accounts…</div>;

  if (isError) {
    return (
      <div className="p-6 text-red-600">
        Failed to load accounts: {error?.message || 'unknown error'}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold text-gray-900">No Schwab accounts</h2>
        <p className="text-gray-600 mt-2">
          No accounts are linked yet. Run a sync from the sidebar once Schwab credentials are
          configured.
        </p>
      </div>
    );
  }

  if (accounts.length === 1) {
    const hash = accounts[0].account_hash;
    localStorage.setItem(LAST_ACCOUNT_KEY, hash);
    return <Navigate to={buildTargetPath(hash)} replace />;
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-600 mb-6">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        {accounts.map((acc) => {
          const count = positionCountByAccount[acc.account_hash] || 0;
          return (
            <button
              key={acc.account_hash}
              type="button"
              onClick={() => {
                localStorage.setItem(LAST_ACCOUNT_KEY, acc.account_hash);
                navigate(buildTargetPath(acc.account_hash));
              }}
              className="text-left bg-white border border-gray-200 rounded-lg p-5 hover:border-indigo-400 hover:shadow-sm transition flex items-start justify-between"
            >
              <div className="flex items-start min-w-0">
                <Building2 className="h-6 w-6 text-indigo-500 mt-0.5 mr-3 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-base font-semibold text-gray-900 truncate">
                    Account {acc.account_number}
                  </div>
                  {acc.account_type && (
                    <div className="text-xs text-gray-500 uppercase tracking-wide mt-0.5">
                      {acc.account_type}
                    </div>
                  )}
                  <dl className="mt-3 space-y-0.5 text-sm">
                    <div className="flex justify-between gap-6">
                      <dt className="text-gray-500">Liquidation value</dt>
                      <dd className="text-gray-900 font-medium">
                        {formatCurrency(acc.liquidation_value)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt className="text-gray-500">Buying power</dt>
                      <dd className="text-gray-900">{formatCurrency(acc.buying_power)}</dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt className="text-gray-500">Positions</dt>
                      <dd className="text-gray-900">{count}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400 ml-3 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
