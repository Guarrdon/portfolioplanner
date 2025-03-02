// frontend/src/components/positions/ActivityLog.jsx
import React, { useState } from 'react';
import { format } from 'date-fns';
import { MessageSquare, Tag, Edit, RefreshCw, Clock, Filter } from 'lucide-react';

const ActivityLog = ({ activities = [], maxItems = 5 }) => {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('all');

  // Filter activities based on selected filter
  const filteredActivities = activities.filter(activity => {
    if (filter === 'all') return true;
    return activity.type === filter;
  });

  // Sort activities by timestamp, most recent first
  const sortedActivities = [...filteredActivities].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  // Limit the number of activities shown unless showAll is true
  const displayedActivities = showAll 
    ? sortedActivities 
    : sortedActivities.slice(0, maxItems);

  // Get icon and color for activity type
  const getActivityIcon = (type) => {
    switch (type) {
      case 'comment_added':
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      case 'tag_added':
      case 'tag_removed':
        return <Tag className="w-4 h-4 text-amber-500" />;
      case 'position_edited':
        return <Edit className="w-4 h-4 text-purple-500" />;
      case 'sync_performed':
        return <RefreshCw className="w-4 h-4 text-green-500" />;
      case 'position_created':
        return <Edit className="w-4 h-4 text-green-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  // Get formatted activity message
  const getActivityMessage = (activity) => {
    const { type, userName, data } = activity;
    
    switch (type) {
      case 'comment_added':
        return (
          <span>
            <span className="font-medium">{userName}</span> added a comment
            {data?.text && (
              <span className="text-gray-500 italic"> "{data.text.substring(0, 40)}
                {data.text.length > 40 ? '...' : ''}"</span>
            )}
          </span>
        );
      case 'tag_added':
        return (
          <span>
            <span className="font-medium">{userName}</span> added tag 
            <span className="mx-1 px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs">
              {data?.tag}
            </span>
          </span>
        );
      case 'tag_removed':
        return (
          <span>
            <span className="font-medium">{userName}</span> removed tag 
            <span className="mx-1 px-1.5 py-0.5 bg-gray-100 text-gray-800 rounded-full text-xs line-through">
              {data?.tag}
            </span>
          </span>
        );
      case 'position_edited':
        return (
          <span>
            <span className="font-medium">{userName}</span> edited position details
            {data?.fields && (
              <span className="text-gray-500"> (changed: {data.fields.join(', ')})</span>
            )}
          </span>
        );
      case 'sync_performed':
        return (
          <span>
            <span className="font-medium">{userName}</span> synced with original position
            {data?.changeCount && (
              <span className="text-gray-500"> ({data.changeCount} changes)</span>
            )}
          </span>
        );
      case 'position_created':
        return (
          <span>
            <span className="font-medium">{userName}</span> created this position
          </span>
        );
      default:
        return (
          <span>
            <span className="font-medium">{userName}</span> performed an action
          </span>
        );
    }
  };

  if (activities.length === 0) {
    return (
      <div className="text-center py-3 text-sm text-gray-500">
        No activity recorded
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter controls */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 flex items-center">
          <Clock className="w-4 h-4 mr-1" />
          Activity Log
        </h4>
        <div className="flex items-center space-x-2">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs border-none focus:ring-0 py-0 pl-0 pr-6 text-gray-600 bg-transparent"
          >
            <option value="all">All Activity</option>
            <option value="comment_added">Comments</option>
            <option value="tag_added">Tags</option>
            <option value="position_edited">Edits</option>
            <option value="sync_performed">Syncs</option>
          </select>
        </div>
      </div>

      {/* Activity List */}
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {displayedActivities.map((activity) => (
          <div key={activity.id} className="flex space-x-3 text-sm">
            <div className="flex-shrink-0 mt-0.5">
              {getActivityIcon(activity.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-gray-700">
                {getActivityMessage(activity)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {format(new Date(activity.timestamp), 'MMM d, yyyy h:mm a')}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Show More/Less Button */}
      {sortedActivities.length > maxItems && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-blue-600 hover:text-blue-800 w-full text-center mt-1"
        >
          {showAll ? 'Show Less' : `Show ${sortedActivities.length - maxItems} More Activities`}
        </button>
      )}
    </div>
  );
};

export default ActivityLog;