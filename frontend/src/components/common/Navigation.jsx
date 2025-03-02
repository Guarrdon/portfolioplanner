import React, { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Briefcase,
  PhoneCall,
  PieChart,
  DollarSign,
  Currency,
  Package,
  BarChart2,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { addDays } from 'date-fns';
import SyncAllButton from './SyncAllButton';

const Navigation = () => {
  const location = useLocation();
  const { strategies = {} } = usePortfolio(); // Add default empty object

  // Calculate portfolio summary metrics
  const summaryMetrics = useMemo(() => {
    // Count active positions
    const activePositions = Object.values(strategies || {})
      .reduce((total, positions) => total + (positions?.length || 0), 0);

    // Count pending actions (positions with alerts/watch tags)
    const pendingActions = Object.values(strategies || {})
      .flat()
      .filter(position =>
        position?.tags?.some(tag =>
          tag.toLowerCase().includes('alert') ||
          tag.toLowerCase().includes('watch') ||
          tag.toLowerCase().includes('close')
        )
      ).length;

    // Count upcoming events (expirations in next 30 days)
    const thirtyDaysFromNow = addDays(new Date(), 30);
    const upcomingEvents = Object.values(strategies || {})
      .flat()
      .filter(position => {
        // Check for any leg with upcoming expiration
        if (position?.legs) {
          return position.legs.some(leg => {
            if (leg?.type === 'option' && leg?.expiration) {
              const expirationDate = new Date(leg.expiration);
              return expirationDate <= thirtyDaysFromNow;
            }
            return false;
          });
        }
        // For dividend positions, check next ex-date
        if (position?.nextExDate) {
          const nextExDate = new Date(position.nextExDate);
          return nextExDate <= thirtyDaysFromNow;
        }
        return false;
      }).length;

    return {
      activePositions,
      pendingActions,
      upcomingEvents
    };
  }, [strategies]);

  const navigationItems = [
    {
      group: 'Strategies',
      items: [
        {
          name: 'Covered Calls',
          path: '/strategies/covered-calls',
          icon: PhoneCall,
          description: 'View and manage covered call positions'
        },
        {
          name: 'Put Spreads',
          path: '/strategies/put-spreads',
          icon: BarChart2,
          description: 'Track put spread strategies'
        },
        {
          name: 'Big Options',
          path: '/strategies/big-options',
          icon: Package,
          description: 'Monitor significant option positions'
        },
        {
          name: 'Dividend Positions',
          path: '/strategies/dividends',
          icon: DollarSign,
          description: 'Track dividend-focused investments'
        },
        {
          name: 'Margin Spreads',
          path: '/strategies/box-spreads',
          icon: Currency,
          description: 'Track synthetic loan positions like BOX,...'
        },
        {
          name: 'Misc Positions',
          path: '/strategies/misc',
          icon: Briefcase,
          description: 'Other investment positions'
        }
      ]
    },
    {
      group: 'Analysis',
      items: [
        {
          name: 'Portfolio Analytics',
          path: '/analysis/portfolio',
          icon: PieChart,
          description: 'View portfolio statistics and analysis'
        },
        {
          name: 'Calendar Events',
          path: '/calendar',
          icon: Calendar,
          description: 'Track important dates and events'
        }
      ]
    }
  ];

  return (
    <nav className="bg-gray-50 w-64 min-h-screen px-3 py-4 border-r">
      <div className="space-y-8">
        {navigationItems.map((section) => (
          <div key={section.group}>
            <h3 className="px-3 text-sm font-semibold text-gray-500 uppercase tracking-wider">
              {section.group}
            </h3>
            <div className="mt-2 space-y-1">
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={`group flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium 
                      ${isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                      }`}
                  >
                    <div className="flex items-center min-w-0">
                      <Icon
                        className={`flex-shrink-0 h-5 w-5 mr-3
                          ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}
                        `}
                      />
                      <div className="truncate">
                        <span>{item.name}</span>
                        <p className="text-xs text-gray-500 truncate">{item.description}</p>
                      </div>
                    </div>
                    <ChevronRight
                      className={`flex-shrink-0 h-4 w-4 ml-2 
                        ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}
                      `}
                    />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Additional Actions */}
      <div className="mt-8">
        <h3 className="px-3 text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Additional Actions
        </h3>
        <div className="mt-4 px-3 space-y-3">
          <SyncAllButton />
          <button
            className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Download Report
          </button>
        </div>
      </div>

      {/* Summary Section */}
      <div className="mt-8 px-3">
        <div className="rounded-lg bg-blue-50 p-4">
          <h4 className="text-sm font-medium text-blue-800 mb-2">Portfolio Summary</h4>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-sm text-blue-600">Active Positions</dt>
              <dd className="text-sm font-medium text-blue-900">{summaryMetrics.activePositions}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-blue-600">Pending Actions</dt>
              <dd className="text-sm font-medium text-blue-900">{summaryMetrics.pendingActions}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-blue-600">Upcoming Events</dt>
              <dd className="text-sm font-medium text-blue-900">{summaryMetrics.upcomingEvents}</dd>
            </div>
          </dl>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;