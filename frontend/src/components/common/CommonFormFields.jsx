import React from 'react';
import AccountSelect from './AccountSelect';
import { Tag as TagIcon, X } from 'lucide-react';

export const CommonFormFields = ({ 
  formData, 
  setFormData, 
  newTag, 
  setNewTag, 
  handleAddTag, 
  handleRemoveTag, 
  handleKeyPress 
}) => {
  return (
    <>
      {/* Account Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700">
          Account
          <span className="text-red-500">*</span>
        </label>
        <div className="mt-1">
          <AccountSelect
            value={formData.account}
            onChange={(account) => setFormData(prev => ({ ...prev, account }))}
            className="w-full"
          />
        </div>
      </div>

      {/* Tags Section */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <TagIcon className="w-4 h-4" />
          Tags
        </label>
        <div className="relative">
          <div className="min-h-[2.5rem] p-2 border border-gray-300 rounded-md bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <div className="flex flex-wrap gap-2">
              {formData.tags.map(tag => (
                <span 
                  key={tag}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 animate-fadeIn"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-blue-400 hover:bg-blue-200 hover:text-blue-600 focus:outline-none"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyPress={handleKeyPress}
                onBlur={() => newTag.trim() && handleAddTag()}
                className="flex-1 inline-flex min-w-[120px] border-0 p-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 bg-transparent"
                placeholder={formData.tags.length === 0 ? "Enter tags (press Enter or comma to add)" : "Add another tag..."}
              />
            </div>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Press Enter or comma to add tags
          </div>
        </div>
      </div>
    </>
  );
};

export default CommonFormFields;