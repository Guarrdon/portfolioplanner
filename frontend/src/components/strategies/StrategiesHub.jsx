/**
 * StrategiesHub — top-level strategy index with inline group assignment.
 *
 * One tile per strategy class plus an "Uncategorized" tile for groups with
 * no strategy classes. Each tile shows assigned Group chips (with × to
 * remove) and a "+" button that opens a checklist popover of every Group
 * for toggling membership in this strategy.
 *
 * A Group can belong to multiple strategies; toggling commits via PATCH.
 *
 * Route: /strategies
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag as TagIcon, ChevronRight, Plus, X, Check } from 'lucide-react';
import { fetchTags, updateTag } from '../../services/tags';
import { STRATEGY_LIST } from '../../strategies/registry';
import { useRememberPage } from '../../contexts/NavStackContext';

// Toggle whether a tag belongs to a given strategy class. Returns the new
// list of classes for that tag (existing - removed - added).
const toggleClass = (current, strategyKey) => {
  const list = current || [];
  return list.includes(strategyKey)
    ? list.filter((k) => k !== strategyKey)
    : [...list, strategyKey];
};

const AssignPopover = ({ strategy, tags, onToggle, onClose }) => {
  const popRef = useRef(null);

  // Outside-click closes the popover.
  useEffect(() => {
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={popRef}
      className="absolute z-30 right-2 top-full mt-1 w-72 max-h-80 overflow-auto bg-white border border-gray-200 rounded shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`px-3 py-2 text-xs font-medium ${strategy.accent.text} ${strategy.accent.soft} border-b border-gray-200`}>
        Assign groups to {strategy.label}
      </div>
      {tags.length === 0 ? (
        <div className="p-4 text-sm text-gray-500 text-center">No groups defined yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {tags.map((t) => {
            const checked = (t.strategy_classes || []).includes(strategy.key);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onToggle(t)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-left"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      checked
                        ? `${strategy.accent.bar} border-transparent text-white`
                        : 'bg-white border-gray-300'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: t.color || '#9ca3af' }}
                  />
                  <span className="flex-1 text-sm text-gray-800 truncate">{t.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">
                    {t.member_count || 0}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const StrategyTile = ({ strategy, assignedGroups, allTags, onToggleAssignment, mutating }) => {
  const [open, setOpen] = useState(false);
  const Icon = strategy.icon || TagIcon;

  return (
    <div
      className={`group relative bg-white border ${strategy.accent.tile} rounded p-3 hover:shadow-sm transition-shadow`}
    >
      <Link to={`/strategies/${strategy.key}`} className="flex items-start gap-3">
        <div className={`w-1 self-stretch rounded ${strategy.accent.bar} flex-shrink-0`} />
        <div className={`p-2 rounded ${strategy.accent.soft} flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${strategy.accent.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${strategy.accent.text}`}>{strategy.label}</span>
            <span className="text-xs text-gray-500 tabular-nums">
              {assignedGroups.length} group{assignedGroups.length === 1 ? '' : 's'}
              {assignedGroups.reduce((acc, g) => acc + (g.member_count || 0), 0) > 0 && (
                <> · {assignedGroups.reduce((acc, g) => acc + (g.member_count || 0), 0)} member
                {assignedGroups.reduce((acc, g) => acc + (g.member_count || 0), 0) === 1 ? '' : 's'}</>
              )}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-600">{strategy.tagline}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1 group-hover:text-gray-600" />
      </Link>

      {/* Chip row: assigned groups + "+" */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 ml-7" onClick={(e) => e.stopPropagation()}>
        {assignedGroups.map((g) => (
          <span
            key={g.id}
            className={`inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 text-[11px] rounded ${strategy.accent.soft} ${strategy.accent.text} border ${strategy.accent.tile}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: g.color || '#9ca3af' }}
            />
            <span className="truncate max-w-[140px]">{g.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleAssignment(g);
              }}
              disabled={mutating}
              className="ml-0.5 p-0.5 rounded hover:bg-white/60 disabled:opacity-50"
              title={`Remove from ${strategy.label}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] rounded border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          title={`Assign groups to ${strategy.label}`}
        >
          <Plus className="w-3 h-3" />
          {assignedGroups.length === 0 ? 'Assign group' : 'Add'}
        </button>
      </div>

      {open && (
        <AssignPopover
          strategy={strategy}
          tags={allTags}
          onToggle={(t) => {
            onToggleAssignment(t);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

const StrategiesHub = () => {
  useRememberPage('Strategies', null);
  const queryClient = useQueryClient();

  const { data: tags = [], isLoading, error } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const tagsByStrategy = useMemo(() => {
    const out = new Map();
    for (const s of STRATEGY_LIST) out.set(s.key, []);
    out.set('_uncategorized', []);
    for (const t of tags) {
      const classes = t.strategy_classes || [];
      if (classes.length === 0) {
        out.get('_uncategorized').push(t);
      } else {
        for (const c of classes) {
          if (out.has(c)) out.get(c).push(t);
        }
      }
    }
    return out;
  }, [tags]);

  const tagMutation = useMutation({
    mutationFn: ({ tagId, strategy_classes }) =>
      updateTag(tagId, { strategy_classes }),
    onMutate: async ({ tagId, strategy_classes }) => {
      await queryClient.cancelQueries({ queryKey: ['tags'] });
      const prev = queryClient.getQueryData(['tags']);
      queryClient.setQueryData(['tags'], (old = []) =>
        old.map((t) => (t.id === tagId ? { ...t, strategy_classes } : t))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tags'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });

  const handleToggle = (strategyKey, tag) => {
    const next = toggleClass(tag.strategy_classes, strategyKey);
    tagMutation.mutate({ tagId: tag.id, strategy_classes: next });
  };

  if (isLoading) {
    return <div className="p-6 text-gray-600">Loading strategies…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-red-700 bg-red-50 border border-red-200 rounded">
        Failed to load tags: {error.message}
      </div>
    );
  }

  const totalTags = tags.length;
  const classifiedTags = tags.filter((t) => (t.strategy_classes || []).length > 0).length;

  return (
    <div className="px-2 py-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Strategies</h1>
        <p className="text-xs text-gray-500">
          {classifiedTags} of {totalTags} groups assigned to a strategy
          {classifiedTags < totalTags && (
            <> · {totalTags - classifiedTags} uncategorized</>
          )}
          {' · '}A group can belong to multiple strategies.
        </p>
      </div>

      {/* Responsive tile grid: each tile gets at least ~340px before the
          grid will pack a second column. Result on a typical desktop:
          1 col on phones, 2 on small tablets, 3 on standard laptops,
          4–5 on wider monitors. Auto-fit means it just keeps adding
          columns as width allows — no breakpoint guessing. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        {STRATEGY_LIST.map((s) => (
          <StrategyTile
            key={s.key}
            strategy={s}
            assignedGroups={tagsByStrategy.get(s.key) || []}
            allTags={tags}
            onToggleAssignment={(tag) => handleToggle(s.key, tag)}
            mutating={tagMutation.isPending}
          />
        ))}
      </div>

      {tagsByStrategy.get('_uncategorized').length > 0 && (
        <p className="mt-3 text-[11px] text-gray-500">
          {tagsByStrategy.get('_uncategorized').length} uncategorized group
          {tagsByStrategy.get('_uncategorized').length === 1 ? '' : 's'} —{' '}
          <Link to="/strategies/_uncategorized" className="text-sky-700 hover:underline">
            review &amp; assign
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default StrategiesHub;
