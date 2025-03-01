import React from 'react';
import { useAccounts } from '../../contexts/AccountsContext';

const AccountSelect = ({ value, onChange, className = '' }) => {
  const { accounts } = useAccounts();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 ${className}`}
      required
    >
      <option value="">Select account...</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </select>
  );
};

export default AccountSelect;