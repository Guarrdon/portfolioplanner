import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, LayoutDashboard, Calendar } from 'lucide-react';
import ProfileMenu from './ProfileMenu';

const Header = () => {
  const location = useLocation();

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/':
        return 'Portfolio Overview';
      case '/calendar':
        return 'Calendar View';
      case '/settings':
        return 'Settings';
      default:
        return 'Portfolio Planner';
    }
  };

  return (
    <header className="bg-white shadow-sm">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left section with logo and title */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-3">
              <LayoutDashboard className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-gray-900">Portfolio Planner</span>
            </Link>
          </div>

          {/* Center section with page title */}
          <div className="hidden md:block">
            <h1 className="text-lg font-semibold text-gray-700">
              {getPageTitle()}
            </h1>
          </div>

          {/* Right section with actions */}
          <div className="flex items-center space-x-4">
            {/* Mobile menu button */}
            <div className="md:hidden">
              <button
                type="button"
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                aria-controls="mobile-menu"
                aria-expanded="false"
              >
                <span className="sr-only">Open main menu</span>
                <Menu className="h-6 w-6" />
              </button>
            </div>

            {/* Desktop navigation */}
            <nav className="hidden md:flex items-center space-x-4">
              <Link
                to="/"
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  location.pathname === '/'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center space-x-1">
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Portfolio</span>
                </span>
              </Link>

              <Link
                to="/calendar"
                className={`px-3 py-2 rounded-md text-sm font-medium ${
                  location.pathname === '/calendar'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center space-x-1">
                  <Calendar className="h-4 w-4" />
                  <span>Calendar</span>
                </span>
              </Link>

              {/* Profile Menu */}
              <ProfileMenu />
            </nav>
          </div>
        </div>
      </div>

      {/* Mobile menu, show/hide based on menu state */}
      <div className="md:hidden" id="mobile-menu">
        <div className="px-2 pt-2 pb-3 space-y-1">
          <Link
            to="/"
            className={`block px-3 py-2 rounded-md text-base font-medium ${
              location.pathname === '/'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center space-x-2">
              <LayoutDashboard className="h-5 w-5" />
              <span>Portfolio</span>
            </span>
          </Link>

          <Link
            to="/calendar"
            className={`block px-3 py-2 rounded-md text-base font-medium ${
              location.pathname === '/calendar'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center space-x-2">
              <Calendar className="h-5 w-5" />
              <span>Calendar</span>
            </span>
          </Link>
        </div>
      </div>

    </header>
  );
};

export default Header;