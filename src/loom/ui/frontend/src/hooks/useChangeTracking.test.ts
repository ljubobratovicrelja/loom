/**
 * Tests for change tracking (dirty/clean state) logic.
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChangeTracking, shouldTrackChange } from './useChangeTracking'

// =============================================================================
// shouldTrackChange (Pure Function) Tests
// =============================================================================

describe('shouldTrackChange', () => {
  describe('initial mount handling', () => {
    it('should not mark dirty on initial mount', () => {
      const result = shouldTrackChange(true, false)

      expect(result.markDirty).toBe(false)
      expect(result.newIsInitialMount).toBe(false)
    })

    it('should preserve skip flag on initial mount', () => {
      const result = shouldTrackChange(true, true)

      expect(result.markDirty).toBe(false)
      expect(result.newShouldSkip).toBe(true)
    })
  })

  describe('skip flag handling', () => {
    it('should not mark dirty when skip flag is set', () => {
      const result = shouldTrackChange(false, true)

      expect(result.markDirty).toBe(false)
      expect(result.newShouldSkip).toBe(false) // Flag should be consumed
    })

    it('should mark dirty when skip flag is not set', () => {
      const result = shouldTrackChange(false, false)

      expect(result.markDirty).toBe(true)
      expect(result.newShouldSkip).toBe(false)
    })
  })

  describe('state transitions', () => {
    it('should handle sequence: initial -> change -> skip -> change', () => {
      // Initial mount
      let state = shouldTrackChange(true, false)
      expect(state.markDirty).toBe(false)

      // First change after mount
      state = shouldTrackChange(state.newIsInitialMount, state.newShouldSkip)
      expect(state.markDirty).toBe(true)

      // Change with skip flag (e.g., after save)
      state = shouldTrackChange(state.newIsInitialMount, true)
      expect(state.markDirty).toBe(false)

      // Next change without skip (should mark dirty)
      state = shouldTrackChange(state.newIsInitialMount, state.newShouldSkip)
      expect(state.markDirty).toBe(true)
    })
  })
})

// =============================================================================
// useChangeTracking Hook Tests
// =============================================================================

describe('useChangeTracking', () => {
  describe('initial state', () => {
    it('should start with hasChanges=false', () => {
      const { result } = renderHook(() => useChangeTracking([]))

      expect(result.current.hasChanges).toBe(false)
    })
  })

  describe('change detection', () => {
    it('should not mark dirty on initial mount', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['initial'] } }
      )

      // Initial render - should not be dirty
      expect(result.current.hasChanges).toBe(false)

      // Rerender with same deps - still not dirty
      rerender({ deps: ['initial'] })
      expect(result.current.hasChanges).toBe(false)
    })

    it('should mark dirty when dependencies change', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['initial'] } }
      )

      expect(result.current.hasChanges).toBe(false)

      // Change dependencies
      rerender({ deps: ['changed'] })

      expect(result.current.hasChanges).toBe(true)
    })

    it('should mark dirty on subsequent changes', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['v1'] } }
      )

      // First change
      rerender({ deps: ['v2'] })
      expect(result.current.hasChanges).toBe(true)

      // Mark clean
      act(() => {
        result.current.markClean()
      })
      expect(result.current.hasChanges).toBe(false)

      // Another change
      rerender({ deps: ['v3'] })
      expect(result.current.hasChanges).toBe(true)
    })
  })

  describe('markDirty', () => {
    it('should set hasChanges to true', () => {
      const { result } = renderHook(() => useChangeTracking([]))

      expect(result.current.hasChanges).toBe(false)

      act(() => {
        result.current.markDirty()
      })

      expect(result.current.hasChanges).toBe(true)
    })
  })

  describe('markClean', () => {
    it('should set hasChanges to false', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['v1'] } }
      )

      // Make dirty
      rerender({ deps: ['v2'] })
      expect(result.current.hasChanges).toBe(true)

      // Mark clean
      act(() => {
        result.current.markClean()
      })

      expect(result.current.hasChanges).toBe(false)
    })
  })

  describe('skipNextChange', () => {
    it('should skip the next change detection', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['v1'] } }
      )

      // First change - marks dirty
      rerender({ deps: ['v2'] })
      expect(result.current.hasChanges).toBe(true)

      // Mark clean and skip next
      act(() => {
        result.current.markClean()
        result.current.skipNextChange()
      })
      expect(result.current.hasChanges).toBe(false)

      // This change should be skipped
      rerender({ deps: ['v3'] })
      expect(result.current.hasChanges).toBe(false)

      // Next change should NOT be skipped
      rerender({ deps: ['v4'] })
      expect(result.current.hasChanges).toBe(true)
    })

    it('should only skip one change', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['v1'] } }
      )

      // Skip next change
      act(() => {
        result.current.skipNextChange()
      })

      // First change - skipped
      rerender({ deps: ['v2'] })
      expect(result.current.hasChanges).toBe(false)

      // Second change - not skipped
      rerender({ deps: ['v3'] })
      expect(result.current.hasChanges).toBe(true)

      // Third change - still dirty (no new skip)
      rerender({ deps: ['v4'] })
      expect(result.current.hasChanges).toBe(true)
    })
  })

  describe('save/restore workflow', () => {
    it('should handle save workflow correctly', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['initial'] } }
      )

      // Make changes
      rerender({ deps: ['modified'] })
      expect(result.current.hasChanges).toBe(true)

      // Simulate save: mark clean and skip next (in case save triggers state update)
      act(() => {
        result.current.skipNextChange()
        result.current.markClean()
      })
      expect(result.current.hasChanges).toBe(false)

      // Any state update from save should be skipped
      rerender({ deps: ['saved_state'] })
      expect(result.current.hasChanges).toBe(false)

      // Subsequent changes should mark dirty
      rerender({ deps: ['new_change'] })
      expect(result.current.hasChanges).toBe(true)
    })

    it('should handle undo/redo restore workflow correctly', () => {
      const { result, rerender } = renderHook(
        ({ deps }) => useChangeTracking(deps),
        { initialProps: { deps: ['initial'] } }
      )

      // Make changes
      rerender({ deps: ['modified'] })
      expect(result.current.hasChanges).toBe(true)

      // Simulate undo: skip next change (state will be restored) but mark dirty
      act(() => {
        result.current.skipNextChange()
        result.current.markDirty() // Restore marks document as having changes
      })

      // State restoration happens
      rerender({ deps: ['restored_state'] })

      // Document should still be marked as having changes
      // (because undo changes the document state)
      expect(result.current.hasChanges).toBe(true)
    })
  })

  describe('multiple dependencies', () => {
    it('should detect changes in any dependency', () => {
      const { result, rerender } = renderHook(
        ({ nodes, edges }) => useChangeTracking([nodes, edges]),
        { initialProps: { nodes: [], edges: [] } }
      )

      expect(result.current.hasChanges).toBe(false)

      // Change only nodes
      rerender({ nodes: ['node1'], edges: [] })
      expect(result.current.hasChanges).toBe(true)

      // Reset
      act(() => result.current.markClean())

      // Change only edges
      rerender({ nodes: ['node1'], edges: ['edge1'] })
      expect(result.current.hasChanges).toBe(true)
    })
  })
})

// =============================================================================
// Integration-like Scenarios
// =============================================================================

describe('Change Tracking Scenarios', () => {
  it('should handle: load -> edit -> save -> edit', () => {
    const { result, rerender } = renderHook(
      ({ state }) => useChangeTracking([state]),
      { initialProps: { state: 'loaded' } }
    )

    // After load - clean
    expect(result.current.hasChanges).toBe(false)

    // User edits
    rerender({ state: 'edited' })
    expect(result.current.hasChanges).toBe(true)

    // User saves
    act(() => {
      result.current.skipNextChange()
      result.current.markClean()
    })
    rerender({ state: 'saved' })
    expect(result.current.hasChanges).toBe(false)

    // User edits again
    rerender({ state: 'edited_again' })
    expect(result.current.hasChanges).toBe(true)
  })

  it('should handle: load -> edit -> undo -> redo', () => {
    const { result, rerender } = renderHook(
      ({ state }) => useChangeTracking([state]),
      { initialProps: { state: 'original' } }
    )

    // After load - clean
    expect(result.current.hasChanges).toBe(false)

    // User edits
    rerender({ state: 'edited' })
    expect(result.current.hasChanges).toBe(true)

    // User undoes (restore to original, but document is now different from saved)
    act(() => {
      result.current.skipNextChange()
      result.current.markDirty() // Undo still means document has changes
    })
    rerender({ state: 'original' })
    expect(result.current.hasChanges).toBe(true)

    // User redoes
    act(() => {
      result.current.skipNextChange()
      result.current.markDirty()
    })
    rerender({ state: 'edited' })
    expect(result.current.hasChanges).toBe(true)
  })

  it('should handle rapid changes (typing)', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useChangeTracking([text]),
      { initialProps: { text: '' } }
    )

    // Simulate typing
    const changes = ['H', 'He', 'Hel', 'Hell', 'Hello']
    for (const text of changes) {
      rerender({ text })
    }

    // Should be dirty after any change
    expect(result.current.hasChanges).toBe(true)
  })
})
