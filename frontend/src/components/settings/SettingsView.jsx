// src/components/settings/SettingsView.jsx

import React, { useState } from 'react';
import AccountManagement from './AccountManagement';
import ProfileSettings from './ProfileSettings';
import FriendManagement from './FriendManagement';
import { Settings, Users, Wallet, UserPlus } from 'lucide-react';

const SettingsView = () => {
  const [activeSection, setActiveSection] = useState('profile');

  const sections = [
    {
      id: 'profile',
      label: 'Profile Settings',
      icon: Users,
      component: <ProfileSettings />
    },
    {
      id: 'accounts',
      label: 'Account Management',
      icon: Wallet,
      component: <AccountManagement />
    },
    {
      id: 'friends',
      label: 'Friends',
      icon: UserPlus,
      component: <FriendManagement />
    }
  ];

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Navigation Sidebar */}
        <nav className="lg:w-64 flex-shrink-0 bg-white shadow rounded-lg overflow-hidden h-fit">
          <div className="p-4">
            <h2 className="flex items-center text-lg font-medium text-gray-900">
              <Settings className="h-5 w-5 mr-2" />
              Settings
            </h2>
          </div>
          <div className="border-t border-gray-200">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center px-4 py-3 text-sm font-medium ${
                    activeSection === section.id
                      ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-5 w-5 mr-3" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Main Content Area */}
        <div className="flex-1">
          {sections.find(section => section.id === activeSection)?.component}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;