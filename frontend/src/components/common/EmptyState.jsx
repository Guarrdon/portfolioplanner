// src/components/common/EmptyState.jsx
import React from 'react';
import { PlusCircle } from 'lucide-react';

const EmptyState = ({ 
  hasPositions, 
  onAddNew,
  title = 'No positions found',
  description,
  showAddButton = true
}) => {
  const defaultDescription = hasPositions 
    ? 'Try adjusting your search filters.'
    : 'Get started by adding a new position.';

  return (
    <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-gray-500">
        {description || defaultDescription}
      </p>
      {!hasPositions && showAddButton && (
        <button
          onClick={onAddNew}
          className="mt-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <PlusCircle className="h-5 w-5 mr-2" />
          Add Position
        </button>
      )}
    </div>
  );
};

export default EmptyState;