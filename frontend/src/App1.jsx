// src/App.jsx

import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Auth Components
import { UserProvider } from './contexts/UserContext';
import RequireAuth from './components/auth/RequireAuth';
import LoginForm from './components/auth/LoginForm';

// Layout Components
import Header from './components/common/Header';
import Navigation from './components/common/Navigation';

// Main Views
import PortfolioView from './components/portfolio/PortfolioView';
import CalendarView from './components/calendar/CalendarView';

// Strategy Views
import CoveredCallsView from './components/strategies/CoveredCallsView';
import PutSpreadsView from './components/strategies/PutSpreadsView';
import BigOptionsView from './components/strategies/BigOptionsView';
import DividendsView from './components/strategies/DividendsView';
import BOXSpreadsView from './components/strategies/BoxSpreadsView';
import MiscView from './components/strategies/MiscView';

// Analysis Views
import PortfolioAnalytics from './components/analysis/PortfolioAnalytics';
import SettingsView from './components/settings/SettingsView';

// Contexts
import { PortfolioProvider } from './contexts/PortfolioContext';
import { CalendarProvider } from './contexts/CalendarContext';
import { CommentsProvider } from './contexts/CommentsContext';
import { AccountsProvider } from './contexts/AccountsContext';
import { FriendsProvider } from './contexts/FriendsContext';

// Notification Components
import SyncNotification from './components/common/SyncNotification';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <Router>
          <Routes>
            {/* Public login route */}
            <Route path="/login" element={<LoginForm />} />

            {/* Protected routes */}
            <Route path="/*" element={
              <RequireAuth>
                <FriendsProvider>
                  <PortfolioProvider>
                    {/* 
                      The SyncNotification component will check for updates:
                      1. When it first mounts (after login)
                      2. Periodically while the user remains logged in
                      3. When the current user changes
                    */}
                    <SyncNotification />

                    <AccountsProvider>
                      <CommentsProvider>
                        <CalendarProvider>
                          <div className="flex h-screen">
                            <Navigation />
                            <div className="flex-1 flex flex-col">
                              <Header />
                              <main className="flex-1 overflow-auto bg-gray-50 p-6">
                                <Routes>
                                  {/* Main routes */}
                                  <Route path="/" element={<PortfolioView />} />
                                  <Route path="/calendar" element={<CalendarView />} />

                                  {/* Strategy routes */}
                                  <Route path="/strategies/covered-calls" element={<CoveredCallsView />} />
                                  <Route path="/strategies/put-spreads" element={<PutSpreadsView />} />
                                  <Route path="/strategies/big-options" element={<BigOptionsView />} />
                                  <Route path="/strategies/dividends" element={<DividendsView />} />
                                  <Route path="/strategies/box-spreads" element={<BOXSpreadsView />} />
                                  <Route path="/strategies/misc" element={<MiscView />} />

                                  {/* Analysis routes */}
                                  <Route path="/analysis/portfolio" element={<PortfolioAnalytics />} />

                                  {/* Settings route */}
                                  <Route path="/settings/*" element={<SettingsView />} />

                                  {/* Catch-all route for 404 */}
                                  <Route path="*" element={
                                    <div className="text-center py-10">
                                      <h2 className="text-2xl font-bold text-gray-900">Page Not Found</h2>
                                      <p className="text-gray-600 mt-2">The page you're looking for doesn't exist.</p>
                                    </div>
                                  } />
                                </Routes>
                              </main>
                            </div>
                          </div>
                        </CalendarProvider>
                      </CommentsProvider>
                    </AccountsProvider>
                  </PortfolioProvider>
                </FriendsProvider>
              </RequireAuth>
            } />
          </Routes>
        </Router>
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;