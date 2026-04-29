import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Building2 } from 'lucide-react';
import ProfileMenu from './ProfileMenu';
import AccountSyncButton from '../schwab/AccountSyncButton';
import { fetchActualPositions } from '../../services/schwab';
import { LAST_ACCOUNT_KEY } from '../schwab/AccountPicker';

// Both children read the same React Query data via the same key, so this
// is one network call shared across the badge, the sync button, and any
// page that also asks for `schwab-accounts-landing`.
function useSelectedAccount() {
  const remembered =
    typeof window !== 'undefined' ? localStorage.getItem(LAST_ACCOUNT_KEY) : null;
  const { data } = useQuery({
    queryKey: ['schwab-accounts-landing'],
    queryFn: () => fetchActualPositions(),
  });
  const accounts = data?.accounts || [];
  const selected = remembered ? accounts.find((a) => a.account_hash === remembered) : null;
  return selected;
}

function SelectedAccountBadge() {
  const selected = useSelectedAccount();
  return (
    <Link
      to="/schwab/account"
      className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm border border-gray-200 text-gray-700 hover:border-indigo-400 hover:text-gray-900"
      title="Switch account"
    >
      <Building2 className="h-4 w-4 text-indigo-500" />
      <span className="font-medium">
        {selected ? `Account ${selected.account_number}` : 'All Accounts'}
      </span>
    </Link>
  );
}

function HeaderSyncButton() {
  const selected = useSelectedAccount();
  // Render nothing when no account is remembered — there's nothing to
  // sync until the user picks an account.
  if (!selected?.account_hash) return null;
  return (
    <AccountSyncButton
      accountHash={selected.account_hash}
      lastSynced={selected.last_synced}
    />
  );
}

const Header = () => {
  const location = useLocation();

  const getPageTitle = () => {
    if (location.pathname === '/') return 'Dashboard';
    if (location.pathname.startsWith('/schwab/account')) return 'Account';
    if (location.pathname.startsWith('/schwab/positions')) return 'Schwab Positions';
    if (location.pathname.startsWith('/schwab/transactions')) return 'Schwab Positions';
    if (location.pathname.startsWith('/schwab/attention')) return 'Account Attention';
    if (location.pathname.startsWith('/collaboration')) return 'Collaboration Hub';
    if (location.pathname.startsWith('/strategies')) return 'Group Drill-ins';
    if (location.pathname.startsWith('/analysis')) return 'Portfolio Analytics';
    if (location.pathname.startsWith('/calendar')) return 'Calendar';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    return 'Portfolio Planner';
  };

  return (
    <header className="bg-white shadow-sm">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: logo + product name */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-3">
              <LayoutDashboard className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">Portfolio Planner</span>
            </Link>
          </div>

          {/* Center: page title */}
          <div className="hidden md:block">
            <h1 className="text-lg font-semibold text-gray-700">{getPageTitle()}</h1>
          </div>

          {/* Right: sync · account badge · profile */}
          <div className="flex items-center space-x-4">
            <HeaderSyncButton />
            <SelectedAccountBadge />
            <ProfileMenu />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
