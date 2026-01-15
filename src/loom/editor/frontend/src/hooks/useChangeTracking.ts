/**
 * Change tracking logic for detecting unsaved document changes.
 *
 * This hook tracks whether the document has been modified since last save/load.
 * It handles:
 * - Skipping initial mount (document isn't "dirty" just because it loaded)
 * - Skipping after restore operations (undo/redo marks dirty differently)
 * - Skipping after save operations (save clears dirty state)
 */

import { useState, useRef, useEffect, useCallback } from 'react'

export interface ChangeTrackingState {
  /** Whether the document has unsaved changes */
  hasChanges: boolean
  /** Mark the document as having changes */
  markDirty: () => void
  /** Mark the document as saved (no changes) */
  markClean: () => void
  /** Skip the next change detection (used after programmatic state updates) */
  skipNextChange: () => void
}

/**
 * Hook to track document change state.
 *
 * @param dependencies - Values to watch for changes (e.g., nodes, edges)
 * @returns Change tracking state and controls
 */
export function useChangeTracking(dependencies: unknown[]): ChangeTrackingState {
  const [hasChanges, setHasChanges] = useState(false)
  const isInitialMount = useRef(true)
  const skipNextChangeRef = useRef(false)

  // Track changes when dependencies change
  useEffect(() => {
    // Skip initial mount - document isn't dirty just because it loaded
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    // Skip if flagged (after restore/save) - reset flag for next change
    if (skipNextChangeRef.current) {
      skipNextChangeRef.current = false
      return
    }

    setHasChanges(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  const markDirty = useCallback(() => {
    setHasChanges(true)
  }, [])

  const markClean = useCallback(() => {
    setHasChanges(false)
  }, [])

  const skipNextChange = useCallback(() => {
    skipNextChangeRef.current = true
  }, [])

  return {
    hasChanges,
    markDirty,
    markClean,
    skipNextChange,
  }
}

/**
 * Pure function to determine if change should be tracked.
 * Useful for testing the logic without React hooks.
 *
 * @param isInitialMount - Is this the first render?
 * @param shouldSkip - Was skip requested?
 * @returns Whether to mark as dirty, and new values for the refs
 */
export function shouldTrackChange(
  isInitialMount: boolean,
  shouldSkip: boolean
): { markDirty: boolean; newIsInitialMount: boolean; newShouldSkip: boolean } {
  if (isInitialMount) {
    return { markDirty: false, newIsInitialMount: false, newShouldSkip: shouldSkip }
  }

  if (shouldSkip) {
    return { markDirty: false, newIsInitialMount: false, newShouldSkip: false }
  }

  return { markDirty: true, newIsInitialMount: false, newShouldSkip: false }
}
