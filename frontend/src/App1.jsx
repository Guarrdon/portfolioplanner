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

// Stub placeholder (used for routes pending rebuild on the new spine)
import ComingSoon from './components/common/ComingSoon';

// Settings
import SettingsView from './components/settings/SettingsView';

// Schwab Views
import SchwabPositionsLanding from './components/schwab/SchwabPositionsLanding';
import TransactionsView from './components/schwab/TransactionsView';
import AccountTransactionsView from './components/schwab/AccountTransactionsView';
import AccountAttentionView from './components/schwab/AccountAttentionView';
import AccountOverview from './components/schwab/AccountOverview';

// Collaboration Views
import CollaborationDashboard from './components/collaboration/CollaborationDashboard';

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

                                  {/* Schwab routes */}
                                  <Route path="/schwab/account" element={<AccountOverview />} />
                                  <Route path="/schwab/account/:accountHash" element={<AccountOverview />} />
                                  <Route path="/schwab/positions" element={<SchwabPositionsLanding />} />
                                  <Route path="/schwab/transactions/account/:accountHash" element={<AccountTransactionsView />} />
                                  <Route path="/schwab/transactions/:underlying" element={<TransactionsView />} />
                                  <Route path="/schwab/attention" element={<AccountAttentionView />} />

                                  {/* Collaboration routes */}
                                  <Route path="/collaboration" element={<CollaborationDashboard />} />

                                  {/* Group drill-ins — to be rebuilt as tag/group browsers on the classification spine */}
                                  <Route path="/strategies/*" element={
                                    <ComingSoon
                                      title="Group Drill-ins"
                                      description="This area will be rebuilt as group/tag browsers on the new classification spine — for risk audits and planning per group."
                                    />
                                  } />

                                  {/* Analysis — pending rebuild */}
                                  <Route path="/analysis/portfolio" element={
                                    <ComingSoon
                                      title="Portfolio Analytics"
                                      description="Group-level P&L, exposure, BP usage, realized vs unrealized — to be rebuilt on the new spine."
                                    />
                                  } />
                                  <Route path="/calendar" element={
                                    <ComingSoon
                                      title="Calendar"
                                      description="Time-axis view of Account Attention — flagged positions and expirations laid out on a calendar. Pending rebuild."
                                    />
                                  } />

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