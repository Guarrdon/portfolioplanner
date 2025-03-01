import React, { useState, useEffect } from 'react';
import { useUser } from '../../contexts/UserContext';
import CommonFormFields from '../common/CommonFormFields';
import { usePortfolio } from '../../contexts/PortfolioContext';

const BaseStrategyForm = ({
  strategy,
  initialData,
  onSubmit,
  onCancel,
  existingPosition = null,
  children,
  validate
}) => {
  const { currentUser } = useUser();
  const { addPosition, updatePosition, validatePosition, calculatePositionMetrics } = usePortfolio();
  const [error, setError] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [formData, setFormData] = useState({
    ...initialData,
    // Ensure userId is always set from current user
    userId: currentUser?.id
  });
  const [initialNote, setInitialNote] = useState('');

  // When initialData changes (e.g., when editing a position), update formData
  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  // Update userId if current user changes
  useEffect(() => {
    if (currentUser?.id) {
      setFormData(prev => ({
        ...prev,
        userId: currentUser.id
      }));
    }
  }, [currentUser]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError(null);
  };

  const handleTagOperations = {
    handleAddTag: (e) => {
      e?.preventDefault();
      if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
        setFormData(prev => ({
          ...prev,
          tags: [...prev.tags, newTag.trim()]
        }));
        setNewTag('');
      }
    },
    handleKeyPress: (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        handleTagOperations.handleAddTag();
      }
    },
    handleRemoveTag: (tagToRemove) => {
      setFormData(prev => ({
        ...prev,
        tags: prev.tags.filter(tag => tag !== tagToRemove)
      }));
    }
  };

  const validateStrategyForm = async (data) => {
    try {
      // Run base validation
      if (!data.account) {
        throw new Error('Please select an account');
      }

      // Run strategy-specific validation from PortfolioContext
      if (!validatePosition(data)) {
        throw new Error('Invalid position structure');
      }

      // Run additional custom validation if provided
      if (validate) {
        await validate(data);
      }

      return true;
    } catch (error) {
      throw error;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
  
    try {
      // Prepare base position data
      const positionData = {
        ...formData,
        userId: currentUser.id,
        ownerId: currentUser.id, // Add this line
        strategy,
        createdAt: existingPosition ? existingPosition.createdAt : new Date().toISOString(),
      };
  
      // Validate the form data
      await validateStrategyForm(positionData);
  
      // Calculate metrics
      const positionWithMetrics = calculatePositionMetrics(positionData);
  
      // For new positions, handle initial note as first comment if provided
      if (!existingPosition && initialNote.trim()) {
        positionWithMetrics.comments = [{
          id: `${Date.now()}-initial`,
          text: initialNote.trim(),
          author: currentUser.displayName || 'user',
          userId: currentUser.id,
          timestamp: new Date().toISOString(),
          isInitial: true
        }];
      }
  
      if (existingPosition) {
        await updatePosition(positionWithMetrics);
      } else {
        await addPosition(positionWithMetrics);
      }
  
      onSubmit && onSubmit(positionWithMetrics);
    } catch (err) {
      setError(err.message);
      console.error('Form submission error:', err);
    }
  };
  
  const childProps = {
    formData,
    handleChange,
    setFormData,
    error,
    initialNote,
    setInitialNote,
    handleTagOperations
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Common Fields */}
        <CommonFormFields
          formData={formData}
          setFormData={setFormData}
          newTag={newTag}
          setNewTag={setNewTag}
          handleAddTag={handleTagOperations.handleAddTag}
          handleRemoveTag={handleTagOperations.handleRemoveTag}
          handleKeyPress={handleTagOperations.handleKeyPress}
        />

        {/* Strategy-specific form fields */}
        {children && children(childProps)}

        {/* Initial Note Field - Only for new positions */}
        {!existingPosition && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Initial Note (Optional)
            </label>
            <textarea
              value={initialNote}
              onChange={(e) => setInitialNote(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="Add any initial notes about this position..."
            />
          </div>
        )}

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {existingPosition ? 'Update Position' : 'Add Position'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default BaseStrategyForm;