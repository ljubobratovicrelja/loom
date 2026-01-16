import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useHistory, type HistoryState } from './useHistory'

const createState = (id: number): HistoryState => ({
  nodes: [{ id: `node_${id}`, type: 'step', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  parameters: { value: id },
})

describe('useHistory', () => {
  describe('snapshot', () => {
    it('should add state to history', () => {
      const { result } = renderHook(() => useHistory())

      act(() => {
        result.current.snapshot(createState(1))
      })

      expect(result.current.canUndo).toBe(true)
      expect(result.current.canRedo).toBe(false)
    })

    it('should clear future on new snapshot', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      // Create history: S1 -> S2
      act(() => result.current.snapshot(createState(1)))
      act(() => result.current.snapshot(createState(2)))

      // Undo to S1
      act(() => result.current.undo(createState(3)))
      expect(result.current.canRedo).toBe(true)

      // New action clears redo
      act(() => result.current.snapshot(createState(4)))
      expect(result.current.canRedo).toBe(false)
    })

    it('should enforce maxHistory limit', () => {
      const { result } = renderHook(() => useHistory({ maxHistory: 3 }))

      act(() => {
        result.current.snapshot(createState(1))
        result.current.snapshot(createState(2))
        result.current.snapshot(createState(3))
        result.current.snapshot(createState(4))
      })

      // Should only have 3 items, oldest removed
      let undoCount = 0
      while (result.current.canUndo) {
        act(() => result.current.undo(createState(99)))
        undoCount++
      }
      expect(undoCount).toBe(3)
    })
  })

  describe('undo', () => {
    it('should restore previous state', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const state1 = createState(1)
      const state2 = createState(2)
      const currentState = createState(3)

      act(() => {
        result.current.snapshot(state1)
        result.current.snapshot(state2)
      })

      act(() => result.current.undo(currentState))

      // Should restore state2 (the state before currentState)
      expect(onRestore).toHaveBeenCalledWith(state2)
    })

    it('should do nothing when history is empty', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      act(() => result.current.undo(createState(1)))

      expect(onRestore).not.toHaveBeenCalled()
      expect(result.current.canUndo).toBe(false)
    })

    it('should push current state to future for redo', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      act(() => result.current.snapshot(createState(1)))
      act(() => result.current.undo(createState(2)))

      expect(result.current.canRedo).toBe(true)
    })
  })

  describe('redo', () => {
    it('should restore state from future', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const state1 = createState(1)
      const undoneState = createState(2)

      act(() => result.current.snapshot(state1))
      act(() => result.current.undo(undoneState))

      onRestore.mockClear()
      act(() => result.current.redo(createState(3)))

      // Should restore undoneState (the state that was current when undo was called)
      expect(onRestore).toHaveBeenCalledWith(undoneState)
    })

    it('should do nothing when future is empty', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      act(() => result.current.snapshot(createState(1)))
      act(() => result.current.redo(createState(2)))

      expect(onRestore).not.toHaveBeenCalled()
    })
  })

  describe('clear', () => {
    it('should reset all history', () => {
      const { result } = renderHook(() => useHistory())

      act(() => {
        result.current.snapshot(createState(1))
        result.current.snapshot(createState(2))
      })

      expect(result.current.canUndo).toBe(true)

      act(() => result.current.clear())

      expect(result.current.canUndo).toBe(false)
      expect(result.current.canRedo).toBe(false)
    })
  })

  describe('undo/redo sequence', () => {
    it('should handle multiple undo/redo correctly', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      // Build history: S1 -> S2 -> S3 -> [current: S4]
      const s1 = createState(1)
      const s2 = createState(2)
      const s3 = createState(3)
      const s4 = createState(4)

      act(() => {
        result.current.snapshot(s1)
        result.current.snapshot(s2)
        result.current.snapshot(s3)
      })

      // Undo from S4 -> should restore S3
      act(() => result.current.undo(s4))
      expect(onRestore).toHaveBeenLastCalledWith(s3)

      // Undo from S3 -> should restore S2
      act(() => result.current.undo(s3))
      expect(onRestore).toHaveBeenLastCalledWith(s2)

      // Redo from S2 -> should restore S3
      act(() => result.current.redo(s2))
      expect(onRestore).toHaveBeenLastCalledWith(s3)

      // Redo from S3 -> should restore S4
      act(() => result.current.redo(s3))
      expect(onRestore).toHaveBeenLastCalledWith(s4)
    })
  })

  describe('deep cloning', () => {
    it('should not be affected by mutations to original state', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const state = createState(1)
      act(() => result.current.snapshot(state))

      // Mutate original
      state.parameters.value = 999
      state.nodes[0].id = 'mutated'

      act(() => result.current.undo(createState(2)))

      // Restored state should have original values
      const restored = onRestore.mock.calls[0][0]
      expect(restored.parameters.value).toBe(1)
      expect(restored.nodes[0].id).toBe('node_1')
    })

    it('should handle deeply nested objects', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const state: HistoryState = {
        nodes: [{
          id: 'node_1',
          type: 'step',
          position: { x: 100, y: 200 },
          data: {
            name: 'test',
            nested: { deep: { value: 42 } }
          }
        }],
        edges: [],
        parameters: { config: { setting: { enabled: true } } }
      }

      act(() => result.current.snapshot(state))

      // Mutate deeply nested values
      ;(state.nodes[0].data as Record<string, unknown>).nested = { deep: { value: 999 } }
      ;(state.parameters.config as Record<string, unknown>).setting = { enabled: false }

      act(() => result.current.undo(createState(2)))

      const restored = onRestore.mock.calls[0][0]
      expect((restored.nodes[0].data as Record<string, unknown>).nested).toEqual({ deep: { value: 42 } })
      expect((restored.parameters.config as Record<string, unknown>).setting).toEqual({ enabled: true })
    })

    it('should handle arrays within state', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const state: HistoryState = {
        nodes: [
          { id: 'node_1', type: 'step', position: { x: 0, y: 0 }, data: { items: [1, 2, 3] } },
          { id: 'node_2', type: 'variable', position: { x: 0, y: 0 }, data: { name: 'test' } },
        ],
        edges: [
          { id: 'edge_1', source: 'node_1', target: 'node_2' },
        ],
        parameters: { list: ['a', 'b', 'c'] }
      }

      act(() => result.current.snapshot(state))

      // Mutate arrays
      state.nodes.push({ id: 'node_3', type: 'step', position: { x: 0, y: 0 }, data: {} })
      state.edges.push({ id: 'edge_2', source: 'node_2', target: 'node_3' })
      ;(state.parameters.list as string[]).push('d')

      act(() => result.current.undo(createState(99)))

      const restored = onRestore.mock.calls[0][0]
      expect(restored.nodes.length).toBe(2)
      expect(restored.edges.length).toBe(1)
      expect(restored.parameters.list).toEqual(['a', 'b', 'c'])
    })
  })

  describe('error handling in cloning', () => {
    it('should handle standard cloneable data types', () => {
      const { result } = renderHook(() => useHistory())

      const state: HistoryState = {
        nodes: [{ id: 'node_1', type: 'step', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        parameters: {
          string: 'hello',
          number: 42,
          boolean: true,
          null: null,
          array: [1, 2, 3],
          object: { nested: true },
          date: new Date('2024-01-01'),
        }
      }

      // Should not throw
      act(() => result.current.snapshot(state))
      expect(result.current.canUndo).toBe(true)
    })

    it('should preserve data integrity through undo/redo cycles', () => {
      const onRestore = vi.fn()
      const { result } = renderHook(() => useHistory({ onRestore }))

      const states = [1, 2, 3, 4, 5].map(createState)

      // Build history
      states.forEach(state => {
        act(() => result.current.snapshot(state))
      })

      // Undo multiple times
      act(() => result.current.undo(createState(6)))
      act(() => result.current.undo(createState(5)))
      act(() => result.current.undo(createState(4)))

      // Redo
      act(() => result.current.redo(createState(3)))

      // Verify state integrity
      const lastRestored = onRestore.mock.calls[onRestore.mock.calls.length - 1][0]
      expect(lastRestored.parameters.value).toBe(4)
      expect(lastRestored.nodes[0].id).toBe('node_4')
    })
  })
})
