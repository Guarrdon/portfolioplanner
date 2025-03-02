import React, { useState, useEffect, useMemo } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useComments } from '../../contexts/CommentsContext';
import { useUser } from '../../contexts/UserContext';
import Toggle from '../../components/common/Toggle';
import { PlusCircle } from 'lucide-react';
import ExpandedPositionCard from '../positions/ExpandedPositionCard';
import PositionLegForm from '../forms/PositionLegForm';
import DeleteConfirmationModal from '../modals/DeleteConfirmationModal';
import EmptyState from '../common/EmptyState';
import FilterSort from '../common/FilterSort';

const StrategyView = ({
  title,
  description,
  strategyType,
  FormComponent,
  positions: initialPositions = [],
  showForm: initialShowForm = false,
  onFormClose
}) => {
  const { currentUser } = useUser();
  const {
    ownedStrategies,
    sharedStrategies,
    deletePosition,
    updatePosition,
    addPositionLeg,
    removePositionLeg
  } = usePortfolio();
  const {
    getCommentsByPosition,
    addComment,
    editComment,
    deleteComment,
    comments: allComments
  } = useComments();

  const [showForm, setShowForm] = useState(initialShowForm);
  const [showLegForm, setShowLegForm] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [positionToDelete, setPositionToDelete] = useState(null);
  const [positionToEdit, setPositionToEdit] = useState(null);
  const [expandedPositions, setExpandedPositions] = useState(new Set());
  const [filteredPositions, setFilteredPositions] = useState([]);
  const [positionComments, setPositionComments] = useState({});
  const [includeShared, setIncludeShared] = useState(true);

  // Add isValidSharedPosition helper near top of file with other helper functions
  const isValidSharedPosition = (position, currentUserId) => {
    return position.shared &&
      position.ownerId !== currentUserId &&
      position.userId === currentUserId &&
      position.originalId &&
      position.sharedAt &&
      position.sharedBy;
  };
  

  useEffect(() => {
    //console.log('StrategyView mounted');
    return () => console.log('StrategyView unmounted');
  }, []);

  // Add this at top level of component
  useEffect(() => {
    // Clear all position-related state on user change
    setExpandedPositions(new Set());
    setSelectedPosition(null);
    setPositionToDelete(null);
    setPositionToEdit(null);
    setShowForm(false);
    setShowLegForm(false);
  }, [currentUser?.id]);

  // Get positions, ensuring we recalculate when user changes
  const positions = useMemo(() => {
    if (!currentUser?.id) return [];
  
    if (initialPositions.length > 0) {
      return initialPositions.filter(position =>
        position.userId === currentUser.id ||
        isValidSharedPosition(position, currentUser.id)
      );
    }
  
    // Otherwise, combine owned and shared positions
    const ownedPositions = ownedStrategies?.[strategyType] || [];
    const sharedPositions = sharedStrategies?.[strategyType] || [];
  
    // Create a Map using position ID as key to handle duplicates
    const positionMap = new Map();
  
    // First add owned positions (they take priority)
    ownedPositions
      .filter(position => position.userId === currentUser.id)
      .forEach(position => {
        positionMap.set(position.id, position);
      });
  
    // Then add shared positions, but avoid adding if we already have the original
    sharedPositions
      .filter(position => isValidSharedPosition(position, currentUser.id))
      .forEach(position => {
        // Check if we already have the original position
        // If not, add this shared position to the map
        if (!positionMap.has(position.originalId)) {
          positionMap.set(position.id, position);
        }
      });
  
    return Array.from(positionMap.values());
  }, [initialPositions, ownedStrategies, sharedStrategies, strategyType, currentUser?.id]);
  
  // In useEffect for filtered positions
  useEffect(() => {
    setFilteredPositions([]);

    if (currentUser?.id) {
      setFilteredPositions(positions);
    }

    return () => {
      setFilteredPositions([]);
    };
  }, [currentUser?.id, positions, ownedStrategies, sharedStrategies]);

  // Update filtered positions when positions change
  useEffect(() => {
    setFilteredPositions(positions);
  }, [positions]);

  // Update comments for all positions when comments change
  useEffect(() => {
    const newComments = {};
    positions.forEach(position => {
      const posComments = getCommentsByPosition(position.id);
      newComments[position.id] = posComments;
    });
    setPositionComments(newComments);
  }, [positions, allComments, getCommentsByPosition]);
 
  const handleToggleShared = (newValue) => {
    setIncludeShared(newValue);
  };

  const handleToggleExpanded = (positionId) => {
    const newExpanded = new Set(expandedPositions);
    newExpanded.has(positionId) ? newExpanded.delete(positionId) : newExpanded.add(positionId);
    setExpandedPositions(newExpanded);
  };

  const handleDeleteClick = (position) => {
    setPositionToDelete(position);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (positionToDelete) {
      await deletePosition(positionToDelete.id, strategyType);
      setShowDeleteConfirm(false);
      setPositionToDelete(null);
    }
  };


  const handleEditClick = (position) => {
    setPositionToEdit(position);
    setShowForm(true);
  };

  const handleFormClose = async (position) => {
    // Wait briefly for comment state to propagate
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force a refresh of comments for this position
    if (position?.id) {
      const comments = getCommentsByPosition(position.id);
      setPositionComments(prev => ({
        ...prev,
        [position.id]: comments
      }));
    }

    setShowForm(false);
    setPositionToEdit(null);
    onFormClose?.();
  };

  const handleAddLeg = (position) => {
    setSelectedPosition(position);
    setShowLegForm(true);
  };

  const handleLegFormSubmit = (leg) => {
    addPositionLeg(selectedPosition.id, leg);
    setShowLegForm(false);
    setSelectedPosition(null);
  };

  const handleRemoveLeg = (positionId, legId) => {
    if (window.confirm('Are you sure you want to remove this leg?')) {
      removePositionLeg(positionId, legId);
    }
  };

  const handleAddComment = async (comment) => {
    const added = await addComment(comment);
    if (added) {
      // Update local comments state immediately
      setPositionComments(prev => ({
        ...prev,
        [comment.positionId]: [
          ...(prev[comment.positionId] || []),
          comment
        ]
      }));
    }
    return added;
  };


  const handleEditComment = async (commentId, updates) => {
    const edited = await editComment(commentId, updates);
    if (edited) {
      // Update local comments state immediately
      setPositionComments(prev => {
        const newComments = { ...prev };
        Object.keys(newComments).forEach(positionId => {
          newComments[positionId] = newComments[positionId].map(comment =>
            comment.id === commentId ? { ...comment, ...updates } : comment
          );
        });
        return newComments;
      });
    }
    return edited;
  };

  const handleDeleteComment = async (commentId) => {
    const deleted = await deleteComment(commentId);
    if (deleted) {
      // Update local comments state immediately
      setPositionComments(prev => {
        const newComments = { ...prev };
        Object.keys(newComments).forEach(positionId => {
          newComments[positionId] = newComments[positionId].filter(
            comment => comment.id !== commentId
          );
        });
        return newComments;
      });
    }
    return deleted;
  };

  const handleRemoveTag = (position, tagToRemove) => {
    const updatedPosition = {
      ...position,
      tags: position.tags.filter(tag => tag !== tagToRemove)
    };
    updatePosition(updatedPosition);
  };

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {title}
              {positions.some(p => p.shared && p.ownerId !== currentUser?.id) && (
                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  Includes Shared Positions
                </span>
              )}
            </h1>
            <p className="text-gray-600">{description}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusCircle className="h-5 w-5 mr-2" />
            Add Position
          </button>
        </div>

        <FilterSort
          positions={positions}
          onFilteredPositions={setFilteredPositions}
        />
      {/* Add new filter toggle */}
      <div className="flex items-center justify-end space-x-2">
        <label 
          htmlFor="shared-toggle" 
          className="text-sm font-medium text-gray-600"
        >
          Include Shared Positions
        </label>
        <Toggle
  checked={includeShared}
  onChange={handleToggleShared}
  label="Include Shared Positions"
/>
      </div>
      </div>

      {showForm && FormComponent && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <FormComponent
              existingPosition={positionToEdit}
              onSubmit={handleFormClose}
              onCancel={handleFormClose}
            />
          </div>
        </div>
      )}

      {showLegForm && selectedPosition && (
        <PositionLegForm
          position={selectedPosition}
          onAddLeg={handleLegFormSubmit}
          onClose={() => {
            setShowLegForm(false);
            setSelectedPosition(null);
          }}
        />
      )}

      <DeleteConfirmationModal
        isOpen={showDeleteConfirm}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <div className="grid grid-cols-1 gap-6">
        {filteredPositions.length === 0 ? (
          <EmptyState
            hasPositions={positions.length > 0}
            onAddNew={() => setShowForm(true)}
          />
        ) : (
          <>
            {/* Owned Positions First */}
            {filteredPositions
              .filter(p => p.userId === currentUser?.id && p.ownerId === currentUser?.id)
              .map(position => (
                <ExpandedPositionCard
                  key={`position-${position.id}`}
                  position={position}
                  comments={positionComments[position.id] || []}
                  isExpanded={expandedPositions.has(position.id)}
                  onToggleExpand={() => handleToggleExpanded(position.id)}
                  onEdit={handleEditClick}
                  onDelete={handleDeleteClick}
                  onAddComment={handleAddComment}
                  onEditComment={handleEditComment}
                  onDeleteComment={handleDeleteComment}
                  onRemoveTag={handleRemoveTag}
                  onAddLeg={() => handleAddLeg(position)}
                  onRemoveLeg={(legId) => handleRemoveLeg(position.id, legId)}
                  onUpdatePosition={async (position) => {
                    const success = await updatePosition(position);
                    if (success) {
                      setFilteredPositions(prev => 
                        prev.map(p => p.id === position.id ? position : p)
                      );
                    }
                    return success;
                  }}                />
              ))}

            {/* Shared Positions Section */}
            {includeShared && filteredPositions.some(p => isValidSharedPosition(p, currentUser?.id)) && (
              <div className="mt-8">
                <h2 className="text-lg font-medium text-gray-900 mb-4">
                  Shared With You
                </h2>
                <div className="space-y-6">
                  {filteredPositions
                    .filter(p => isValidSharedPosition(p, currentUser?.id))
                    .map(position => (
                      <ExpandedPositionCard
                        key={`position-${position.id}`}
                        position={position}
                        comments={positionComments[position.id] || []}
                        isExpanded={expandedPositions.has(position.id)}
                        onToggleExpand={() => handleToggleExpanded(position.id)}
                        onEdit={undefined}
                        onDelete={undefined}
                        onAddComment={handleAddComment}
                        onEditComment={handleEditComment}
                        onDeleteComment={handleDeleteComment}
                        onRemoveTag={handleRemoveTag}
                        onAddLeg={undefined}
                        onRemoveLeg={undefined}
                        onUpdatePosition={updatePosition}
                      />
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default StrategyView;