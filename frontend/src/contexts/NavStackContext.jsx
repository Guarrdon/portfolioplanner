/**
 * NavStackContext — context-aware back navigation across the app.
 *
 * Maintains a stack of visited pages. Pages opt in by calling
 * useRememberPage(label, snapshot) to record their UI state. When the user
 * navigates back via <BackChip />, the source page mounts and reads
 * useRestoreSnapshot() to seed its initial state — so they land on the same
 * filters / expansions / scroll they left.
 *
 * Stack semantics:
 *   - Forward navigation (new path): push entry
 *   - Revisit (path already in stack): truncate stack to that entry
 *   - Same path (rerender / param change): no-op
 *
 * Snapshots live in a ref keyed by path; labels and paths live in React state.
 * That split avoids re-render storms when a page calls useRememberPage on
 * every state change, while still letting BackChip react to label updates.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

const NavStackContext = createContext(null);

const pathKey = (location) => `${location.pathname}${location.search || ''}`;

export const NavStackProvider = ({ children }) => {
  const location = useLocation();
  const currentKey = pathKey(location);

  // [{ path, label }] — minimal data for re-render-sensitive consumers.
  const [stack, setStack] = useState(() => [{ path: currentKey, label: null }]);

  // Snapshots stored out-of-state to keep useRememberPage cheap.
  const snapshotsRef = useRef(new Map());

  // Sync stack to location changes.
  useEffect(() => {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.path === currentKey) return prev;

      const idx = prev.findIndex((e) => e.path === currentKey);
      if (idx >= 0) {
        // Returning to a known page — truncate forward entries.
        return prev.slice(0, idx + 1);
      }
      // New forward navigation — push placeholder; useRememberPage fills it in.
      return [...prev, { path: currentKey, label: null }];
    });
  }, [currentKey]);

  const remember = useCallback((path, label, snapshot) => {
    snapshotsRef.current.set(path, snapshot);
    setStack((prev) => {
      const idx = prev.findIndex((e) => e.path === path);
      if (idx === -1) return prev;
      if (prev[idx].label === label) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], label };
      return next;
    });
  }, []);

  const getSnapshot = useCallback((path) => snapshotsRef.current.get(path) || null, []);

  const value = useMemo(() => ({
    stack,
    current: stack[stack.length - 1] || null,
    previous: stack.length >= 2 ? stack[stack.length - 2] : null,
    remember,
    getSnapshot,
  }), [stack, remember, getSnapshot]);

  return <NavStackContext.Provider value={value}>{children}</NavStackContext.Provider>;
};

export const useNavStack = () => {
  const ctx = useContext(NavStackContext);
  if (!ctx) {
    throw new Error('useNavStack must be used within a NavStackProvider');
  }
  return ctx;
};

/**
 * Register the current page with a friendly label and a snapshot of its UI
 * state. Call once per page; the snapshot can be a fresh object on each
 * render (only labels propagate to React state, so this is cheap).
 */
export const useRememberPage = (label, snapshot) => {
  const location = useLocation();
  const path = pathKey(location);
  const { remember } = useNavStack();
  // Hold the latest snapshot in a ref so we always write the freshest one.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    remember(path, label, snapshotRef.current);
  });  // intentionally no deps — runs every render to capture latest snapshot
};

/**
 * Read back the snapshot that was last saved for the current path. Returns
 * null on a fresh visit. Use inside useState lazy initializers:
 *
 *   const restored = useRestoreSnapshot();
 *   const [filter, setFilter] = useState(() => restored?.filter ?? '');
 */
export const useRestoreSnapshot = () => {
  const location = useLocation();
  const { getSnapshot } = useNavStack();
  // Snapshot is read-once on mount; subsequent changes shouldn't re-trigger.
  const snapshotRef = useRef(null);
  const initialized = useRef(false);
  if (!initialized.current) {
    snapshotRef.current = getSnapshot(pathKey(location));
    initialized.current = true;
  }
  return snapshotRef.current;
};
