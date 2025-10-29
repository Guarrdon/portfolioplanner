/**
 * Collaboration Dashboard - Functional hub for trade ideas
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  fetchTradeIdeas, 
  fetchSharedPositions,
  createTradeIdea
} from '../../services/collaboration';
import { 
  Users, 
  Plus, 
  Share2, 
  MessageSquare, 
  TrendingUp,
  Search,
  X,
  Check
} from 'lucide-react';
import { TradeIdeaCard } from './TradeIdeaCard';

export const CollaborationDashboard = () => {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('my-ideas');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStrategy, setFilterStrategy] = useState('');
  const [showNewIdeaForm, setShowNewIdeaForm] = useState(false);
  const [highlightId, setHighlightId] = useState(null);

  // Check for highlight parameter in URL (from conversion)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const highlight = params.get('highlight');
    if (highlight) {
      setHighlightId(highlight);
      // Clear the URL parameter after 3 seconds
      setTimeout(() => {
        navigate('/collaboration', { replace: true });
        setHighlightId(null);
      }, 3000);
    }
  }, [location, navigate]);

  // New trade idea form state
  const [newIdea, setNewIdea] = useState({
    symbol: '',
    underlying: '',
    strategy_type: 'covered_call',
    status: 'planned',
    target_quantity: '',
    target_entry_price: '',
    max_profit: '',
    max_loss: '',
    notes: '',
    tags: [],
    legs: []
  });

  // Fetch trade ideas
  const { data: tradeIdeasData, isLoading: loadingIdeas } = useQuery({
    queryKey: ['positions', 'ideas'],
    queryFn: () => fetchTradeIdeas()
  });

  // Fetch shared positions
  const { data: sharedData, isLoading: loadingShared } = useQuery({
    queryKey: ['positions', 'shared'],
    queryFn: () => fetchSharedPositions()
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createTradeIdea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions', 'ideas'] });
      setShowNewIdeaForm(false);
      resetNewIdeaForm();
    }
  });

  const resetNewIdeaForm = () => {
    setNewIdea({
      symbol: '',
      underlying: '',
      strategy_type: 'covered_call',
      status: 'planned',
      target_quantity: '',
      target_entry_price: '',
      max_profit: '',
      max_loss: '',
      notes: '',
      tags: [],
      legs: []
    });
  };

  const handleCreateTradeIdea = () => {
    // Basic validation
    if (!newIdea.symbol || !newIdea.strategy_type) {
      alert('Please fill in required fields (Symbol and Strategy)');
      return;
    }

    // Convert to proper format
    const payload = {
      ...newIdea,
      underlying: newIdea.underlying || newIdea.symbol,
      target_quantity: newIdea.target_quantity ? parseFloat(newIdea.target_quantity) : null,
      target_entry_price: newIdea.target_entry_price ? parseFloat(newIdea.target_entry_price) : null,
      max_profit: newIdea.max_profit ? parseFloat(newIdea.max_profit) : null,
      max_loss: newIdea.max_loss ? parseFloat(newIdea.max_loss) : null
    };

    createMutation.mutate(payload);
  };

  const tradeIdeas = tradeIdeasData?.positions || [];
  const sharedPositions = sharedData?.positions || [];

  const filteredIdeas = tradeIdeas.filter(idea => {
    const matchesSearch = !searchTerm || 
      idea.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      idea.underlying?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStrategy = !filterStrategy || idea.strategy_type === filterStrategy;
    return matchesSearch && matchesStrategy;
  });

  const filteredShared = sharedPositions.filter(pos => {
    const matchesSearch = !searchTerm || 
      pos.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pos.underlying?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStrategy = !filterStrategy || pos.strategy_type === filterStrategy;
    return matchesSearch && matchesStrategy;
  });

  const currentPositions = activeTab === 'my-ideas' ? filteredIdeas : filteredShared;
  const isLoading = activeTab === 'my-ideas' ? loadingIdeas : loadingShared;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <Users className="w-6 h-6 text-blue-600" />
                  Collaboration Hub
                </h1>
                <p className="mt-1 text-xs text-gray-600">
                  Create, share, and collaborate on trade ideas
                </p>
              </div>
              <button
                onClick={() => setShowNewIdeaForm(!showNewIdeaForm)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                <Plus className="w-4 h-4" />
                New Trade Idea
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{tradeIdeas.length}</div>
                <div className="text-xs text-gray-600">Your Ideas</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <Share2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{sharedPositions.length}</div>
                <div className="text-xs text-gray-600">Shared With You</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-purple-100 rounded-lg">
                <MessageSquare className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">
                  {tradeIdeas.reduce((sum, idea) => sum + (idea.comments?.length || 0), 0)}
                </div>
                <div className="text-xs text-gray-600">Comments</div>
              </div>
            </div>
          </div>
        </div>
      </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* New Trade Idea Form */}
        {showNewIdeaForm && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Create New Trade Idea</h2>
              <button
                onClick={() => setShowNewIdeaForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Symbol <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newIdea.symbol}
                  onChange={(e) => setNewIdea({ ...newIdea, symbol: e.target.value.toUpperCase() })}
                  placeholder="AAPL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Strategy Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={newIdea.strategy_type}
                  onChange={(e) => setNewIdea({ ...newIdea, strategy_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="covered_call">Covered Call</option>
                  <option value="vertical_spread">Vertical Spread</option>
                  <option value="box_spread">Box Spread</option>
                  <option value="big_option">Big Options</option>
                  <option value="single_option">Single Option</option>
                  <option value="long_stock">Long Stock</option>
                  <option value="dividend">Dividend</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Quantity</label>
                <input
                  type="number"
                  value={newIdea.target_quantity}
                  onChange={(e) => setNewIdea({ ...newIdea, target_quantity: e.target.value })}
                  placeholder="100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Entry Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={newIdea.target_entry_price}
                  onChange={(e) => setNewIdea({ ...newIdea, target_entry_price: e.target.value })}
                  placeholder="150.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Profit</label>
                <input
                  type="number"
                  step="0.01"
                  value={newIdea.max_profit}
                  onChange={(e) => setNewIdea({ ...newIdea, max_profit: e.target.value })}
                  placeholder="500.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Loss</label>
                <input
                  type="number"
                  step="0.01"
                  value={newIdea.max_loss}
                  onChange={(e) => setNewIdea({ ...newIdea, max_loss: e.target.value })}
                  placeholder="1500.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={newIdea.notes}
                  onChange={(e) => setNewIdea({ ...newIdea, notes: e.target.value })}
                  placeholder="Add your strategy notes and context..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleCreateTradeIdea}
                disabled={createMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                Create Trade Idea
              </button>
              <button
                onClick={() => setShowNewIdeaForm(false)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tabs and Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="border-b border-gray-200">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('my-ideas')}
                  className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${
                    activeTab === 'my-ideas'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  My Trade Ideas ({tradeIdeas.length})
                </button>
                <button
                  onClick={() => setActiveTab('shared-with-me')}
                  className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${
                    activeTab === 'shared-with-me'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Shared With Me ({sharedPositions.length})
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search symbols..."
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Strategy Filter */}
                <select
                  value={filterStrategy}
                  onChange={(e) => setFilterStrategy(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Strategies</option>
                  <option value="covered_call">Covered Call</option>
                  <option value="vertical_spread">Vertical Spread</option>
                  <option value="box_spread">Box Spread</option>
                  <option value="big_option">Big Options</option>
                  <option value="single_option">Single Option</option>
                </select>
              </div>
            </div>
          </div>

          {/* Positions List */}
          <div className="p-6">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-gray-600">Loading positions...</p>
              </div>
            ) : currentPositions.length === 0 ? (
              <div className="text-center py-12">
                <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  {activeTab === 'my-ideas' ? (
                    <TrendingUp className="w-8 h-8 text-gray-400" />
                  ) : (
                    <Share2 className="w-8 h-8 text-gray-400" />
                  )}
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {activeTab === 'my-ideas' ? 'No Trade Ideas Yet' : 'No Shared Positions'}
                </h3>
                <p className="text-gray-600 mb-4">
                  {activeTab === 'my-ideas' 
                    ? 'Create your first trade idea to start collaborating'
                    : 'You don\'t have any positions shared with you yet'
                  }
                </p>
                {activeTab === 'my-ideas' && (
                  <button
                    onClick={() => setShowNewIdeaForm(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Create Trade Idea
                  </button>
                )}
              </div>
            ) : (
                <div className="space-y-3">
                  {currentPositions.map((position) => (
                    <TradeIdeaCard
                      key={position.id}
                      position={position}
                      isOwner={activeTab === 'my-ideas'}
                      highlightId={highlightId}
                    />
                  ))}
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollaborationDashboard;

