import React, { useEffect, useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Layers, AlertCircle, ArrowRight } from 'lucide-react';
import { fetchActualPositions } from '../../services/schwab';
import { fetchPositionFlags } from '../../services/positionFlags';
import { LAST_ACCOUNT_KEY } from './AccountPicker';

const formatCurrency = (n, fractionDigits = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(n) || 0);

const formatPercent = (n) =>
  `${(Number(n) || 0) >= 0 ? '+' : ''}${(Number(n) || 0).toFixed(2)}%`;

function pnlColor(n) {
  const v = Number(n) || 0;
  if (v > 0) return 'text-green-600';
  if (v < 0) return 'text-red-600';
  return 'text-gray-700';
}

function Kpi({ label, value, sub, valueClass }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valueClass || 'text-gray-900'}`}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${valueClass || 'text-gray-500'}`}>{sub}</div>}
    </div>
  );
}

function Shortcut({ icon: Icon, title, count, to, accent = 'indigo' }) {
  return (
    <Link
      to={to}
      className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:border-indigo-400 hover:shadow-sm transition"
    >
      <div className="flex items-center min-w-0">
        <Icon className={`h-6 w-6 text-${accent}-500 mr-3 flex-shrink-0`} />
        <div className="min-w-0">
          <div className="text-sm text-gray-500">{title}</div>
          <div className="text-xl font-semibold text-gray-900">{count}</div>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-400 ml-2 flex-shrink-0" />
    </Link>
  );
}

export default function AccountOverview() {
  const { accountHash } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schwab-account-overview'],
    queryFn: () => fetchActualPositions(),
  });

  const { data: flagsData } = useQuery({
    queryKey: ['position-flags'],
    queryFn: fetchPositionFlags,
  });

  const accounts = useMemo(() => data?.accounts || [], [data]);
  const positions = useMemo(() => data?.positions || [], [data]);
  const flags = useMemo(() => flagsData?.flags || flagsData || [], [flagsData]);

  // No accountHash in URL → fall through to landing logic on Schwab Positions.
  const account = accounts.find((a) => a.account_hash === accountHash);

  const accountPositions = useMemo(
    () => positions.filter((p) => p.account_id === accountHash),
    [positions, accountHash]
  );

  const summary = useMemo(() => {
    const cost = accountPositions.reduce((s, p) => s + (Number(p.cost_basis) || 0), 0);
    const value = accountPositions.reduce((s, p) => s + (Number(p.current_value) || 0), 0);
    const pnl = accountPositions.reduce((s, p) => s + (Number(p.unrealized_pnl) || 0), 0);
    const dayPnl = accountPositions.reduce((s, p) => s + (Number(p.current_day_pnl) || 0), 0);
    const costAbs = Math.abs(cost);
    const pnlPct = costAbs > 0 ? (pnl / costAbs) * 100 : 0;
    const dayPnlPct = value !== 0 ? (dayPnl / Math.abs(value - dayPnl)) * 100 : 0;
    return { cost, value, pnl, pnlPct, dayPnl, dayPnlPct };
  }, [accountPositions]);

  const flaggedCount = useMemo(() => {
    if (!Array.isArray(flags)) return 0;
    const flaggedSigs = new Set(
      flags
        .filter((f) => f && (f.is_flagged || f.flagged))
        .map((f) => f.position_signature)
        .filter(Boolean)
    );
    return accountPositions.filter(
      (p) => p.schwab_position_signature && flaggedSigs.has(p.schwab_position_signature)
    ).length;
  }, [flags, accountPositions]);

  // Remember selection for the landing page redirect.
  useEffect(() => {
    if (accountHash) localStorage.setItem(LAST_ACCOUNT_KEY, accountHash);
  }, [accountHash]);

  if (isLoading) return <div className="p-6 text-gray-500">Loading account…</div>;
  if (isError) {
    return (
      <div className="p-6 text-red-600">
        Failed to load account: {error?.message || 'unknown error'}
      </div>
    );
  }

  // No account hash in URL → redirect to last-selected if known, else to picker.
  if (!accountHash) {
    const remembered = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (remembered && accounts.some((a) => a.account_hash === remembered)) {
      return <Navigate to={`/schwab/account/${remembered}`} replace />;
    }
    if (accounts.length === 1) {
      return <Navigate to={`/schwab/account/${accounts[0].account_hash}`} replace />;
    }
    return <Navigate to="/schwab/positions" replace />;
  }

  if (!account) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold text-gray-900">Account not found</h2>
        <p className="text-gray-600 mt-2">
          This account isn&apos;t in your synced list. <Link className="text-indigo-600 hover:underline" to="/schwab/positions">Pick another account</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <Building2 className="h-7 w-7 text-indigo-500 mr-3" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Account {account.account_number}
            </h1>
            {account.account_type && (
              <div className="text-xs uppercase tracking-wide text-gray-500 mt-0.5">
                {account.account_type}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/schwab/positions')}
          className="text-sm text-indigo-600 hover:underline"
        >
          Switch account
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Liquidation value" value={formatCurrency(account.liquidation_value)} />
        <Kpi label="Buying power" value={formatCurrency(account.buying_power)} sub={account.buying_power_options != null && account.buying_power_options !== account.buying_power ? `Options: ${formatCurrency(account.buying_power_options)}` : null} />
        <Kpi
          label="Day P&L"
          value={formatCurrency(summary.dayPnl)}
          sub={formatPercent(summary.dayPnlPct)}
          valueClass={pnlColor(summary.dayPnl)}
        />
        <Kpi
          label="Unrealized P&L"
          value={formatCurrency(summary.pnl)}
          sub={formatPercent(summary.pnlPct)}
          valueClass={pnlColor(summary.pnl)}
        />
      </div>

      {/* Shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Shortcut
          icon={Layers}
          title="Positions"
          count={accountPositions.length}
          to={`/schwab/transactions/account/${accountHash}`}
          accent="indigo"
        />
        <Shortcut
          icon={AlertCircle}
          title="Flagged for attention"
          count={flaggedCount}
          to="/schwab/attention"
          accent="amber"
        />
        <Shortcut
          icon={Building2}
          title="Cash balance"
          count={formatCurrency(account.cash_balance)}
          to={`/schwab/transactions/account/${accountHash}`}
          accent="green"
        />
      </div>

      {/* Position breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-gray-900 mb-3">Position roll-up</div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Cost basis</dt>
            <dd className="text-gray-900 font-medium">{formatCurrency(Math.abs(summary.cost))}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Market value</dt>
            <dd className="text-gray-900 font-medium">{formatCurrency(summary.value)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Positions</dt>
            <dd className="text-gray-900 font-medium">{accountPositions.length}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Flagged</dt>
            <dd className="text-gray-900 font-medium">{flaggedCount}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
