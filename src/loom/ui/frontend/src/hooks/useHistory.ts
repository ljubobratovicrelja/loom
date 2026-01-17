import { useCallback, useRef, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'

export interface HistoryState {
  nodes: Node[]
  edges: Edge[]
  parameters: Record<string, unknown>
}

interface UseHistoryOptions {
  maxHistory?: number
  onRestore?: (state: HistoryState) => void
}

interface UseHistoryReturn {
  snapshot: (state: HistoryState) => void
  undo: (currentState: HistoryState) => void
  redo: (currentState: HistoryState) => void
  clear: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Deep clones a history state using structuredClone for efficiency.
 * Falls back to JSON serialization if structuredClone fails (e.g., for non-cloneable data).
 */
function cloneState(state: HistoryState): HistoryState {
  try {
    return structuredClone(state)
  } catch (error) {
    // structuredClone can fail on certain data types (Functions, Symbols, etc.)
    // Fall back to JSON serialization (slower but more compatible)
    console.warn('structuredClone failed, falling back to JSON deep clone:', error)
    try {
      return JSON.parse(JSON.stringify(state))
    } catch (jsonError) {
      // If JSON also fails, log error and return a shallow copy as last resort
      console.error('Failed to clone history state:', jsonError)
      return {
        nodes: [...state.nodes],
        edges: [...state.edges],
        parameters: { ...state.parameters },
      }
    }
  }
}

export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { maxHistory = 50, onRestore } = options

  // Use refs for past/future to avoid re-renders on every snapshot
  const pastRef = useRef<HistoryState[]>([])
  const futureRef = useRef<HistoryState[]>([])

  // Track counts for canUndo/canRedo (triggers re-render when needed)
  const [historyInfo, setHistoryInfo] = useState({ pastCount: 0, futureCount: 0 })

  const snapshot = useCallback(
    (state: HistoryState) => {
      // Deep clone and push to past
      pastRef.current.push(cloneState(state))

      // Enforce max history limit
      if (pastRef.current.length > maxHistory) {
        pastRef.current.shift()
      }

      // Clear future on new action (standard undo/redo behavior)
      futureRef.current = []

      setHistoryInfo({
        pastCount: pastRef.current.length,
        futureCount: 0,
      })
    },
    [maxHistory]
  )

  const undo = useCallback(
    (currentState: HistoryState) => {
      if (pastRef.current.length === 0) return

      // Save current state to future for redo
      futureRef.current.unshift(cloneState(currentState))

      // Restore last state from past
      const stateToRestore = pastRef.current.pop()!

      setHistoryInfo({
        pastCount: pastRef.current.length,
        futureCount: futureRef.current.length,
      })

      onRestore?.(stateToRestore)
    },
    [onRestore]
  )

  const redo = useCallback(
    (currentState: HistoryState) => {
      if (futureRef.current.length === 0) return

      // Save current state to past
      pastRef.current.push(cloneState(currentState))

      // Restore from future
      const stateToRestore = futureRef.current.shift()!

      setHistoryInfo({
        pastCount: pastRef.current.length,
        futureCount: futureRef.current.length,
      })

      onRestore?.(stateToRestore)
    },
    [onRestore]
  )

  const clear = useCallback(() => {
    pastRef.current = []
    futureRef.current = []
    setHistoryInfo({ pastCount: 0, futureCount: 0 })
  }, [])

  return {
    snapshot,
    undo,
    redo,
    clear,
    canUndo: historyInfo.pastCount > 0,
    canRedo: historyInfo.futureCount > 0,
  }
}
