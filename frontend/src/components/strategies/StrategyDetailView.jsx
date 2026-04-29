/**
 * StrategyDetailView — generic shell for any strategy class.
 *
 * Reads :key from the route, looks up the strategy in the registry, and
 * renders:
 *   - BackChip + header (icon, label, tagline)
 *   - Groups list filtered to this strategy_class
 *   - Strategy-specific KPI panel (if a panel is registered for the key)
 *
 * Adding a new KPI panel: drop a component file in this folder and register
 * it in PANEL_BY_KEY below.
 *
 * Route: /strategies/:key
 */
import React, { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Tag as TagIcon, ChevronRight } from 'lucide-react';
import BackChip from '../common/BackChip';
import { fetchTags } from '../../services/tags';
import { getStrategy, STRATEGY_LIST } from '../../strategies/registry';
import { useRememberPage } from '../../contexts/NavStackContext';
import VerticalsPanel from './panels/VerticalsPanel';
import LongStockPanel from './panels/LongStockPanel';
import CoveredCallsPanel from './panels/CoveredCallsPanel';
import SingleLegPanel from './panels/SingleLegPanel';
import BigOptionsPanel from './panels/BigOptionsPanel';
import BoxSpreadsPanel from './panels/BoxSpreadsPanel';

// Map strategy keys to their KPI panel components. Strategies without an
// entry get a placeholder. Panels receive `tags` (the Groups in that class).
const PANEL_BY_KEY = {
  verticals: VerticalsPanel,
  long_stock: LongStockPanel,
  covered_calls: CoveredCallsPanel,
  single_leg: SingleLegPanel,
  big_options: BigOptionsPanel,
  box_spreads: BoxSpreadsPanel,
};

const UncategorizedHeader = ({ groupCount }) => (
  <div className="flex items-start gap-3 mb-3">
    <div className="p-2 rounded bg-gray-100 flex-shrink-0">
      <TagIcon className="w-5 h-5 text-gray-500" />
    </div>
    <div className="flex-1 min-w-0">
      <h1 className="text-lg font-semibold text-gray-900">Uncategorized</h1>
      <p className="text-xs text-gray-600">
        {groupCount} group{groupCount === 1 ? '' : 's'} — assign a strategy class to make them appear under that strategy.
      </p>
    </div>
  </div>
);

const StrategyDetailView = () => {
  const { key } = useParams();
  const strategy = key === '_uncategorized' ? null : getStrategy(key);
  const isUncategorized = key === '_uncategorized';

  useRememberPage(strategy?.label || (isUncategorized ? 'Uncategorized' : 'Strategy'), null);

  const { data: tags = [], isLoading, error } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const groups = useMemo(() => {
    if (isUncategorized) {
      return tags.filter((t) => !t.strategy_classes || t.strategy_classes.length === 0);
    }
    return tags.filter((t) => (t.strategy_classes || []).includes(key));
  }, [tags, key, isUncategorized]);

  if (!strategy && !isUncategorized) {
    return (
      <div className="p-6">
        <BackChip fallbackLabel="Strategies" fallbackPath="/strategies" />
        <div className="mt-4 text-gray-700">Unknown strategy: <code>{key}</code></div>
        <div className="mt-2 text-xs text-gray-500">
          Known keys: {STRATEGY_LIST.map((s) => s.key).join(', ')}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <BackChip fallbackLabel="Strategies" fallbackPath="/strategies" />
        <div className="mt-4 text-red-700 bg-red-50 border border-red-200 rounded p-2">
          Failed to load groups: {error.message}
        </div>
      </div>
    );
  }

  const Panel = strategy ? PANEL_BY_KEY[strategy.key] : null;

  return (
    <div className="px-2 py-4">
      <div className="mb-3">
        <BackChip fallbackLabel="Strategies" fallbackPath="/strategies" />
      </div>

      {strategy ? (
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-1 self-stretch rounded ${strategy.accent.bar} flex-shrink-0`} />
          <div className={`p-2 rounded ${strategy.accent.soft} flex-shrink-0`}>
            <strategy.icon className={`w-5 h-5 ${strategy.accent.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={`text-lg font-semibold ${strategy.accent.text}`}>{strategy.label}</h1>
            <p className="text-xs text-gray-600">{strategy.tagline}</p>
          </div>
        </div>
      ) : (
        <UncategorizedHeader groupCount={groups.length} />
      )}

      {/* Groups list */}
      <section className="mb-4">
        <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
          Groups ({groups.length})
        </div>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading groups…</div>
        ) : groups.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded">
            No groups in this strategy yet. Assign a Group's strategy class to see it here.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {groups.map((g) => (
              <div
                key={g.id}
                className="bg-white border border-gray-200 rounded px-3 py-2 flex items-center gap-3"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: g.color || '#9ca3af' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{g.name}</div>
                  {g.note && <div className="text-xs text-gray-500 truncate">{g.note}</div>}
                </div>
                <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                  {g.member_count || 0} member{(g.member_count || 0) === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Strategy-specific KPI panel */}
      {Panel ? (
        <Panel tags={groups} strategy={strategy} />
      ) : strategy ? (
        <section className="mt-4 p-4 border border-dashed border-gray-300 rounded text-sm text-gray-500">
          KPI panel for <span className="font-medium text-gray-700">{strategy.label}</span> coming next.
          Membership and base layout work today.
        </section>
      ) : null}
    </div>
  );
};

export default StrategyDetailView;
