import { useState, useCallback, useRef, useEffect } from 'react'
import type { FreshnessStatus } from '../types/pipeline'

export type { FreshnessStatus }

export interface FreshnessInfo {
  status: FreshnessStatus
  reason: string
}

export interface FreshnessState {
  /** Map of step name -> freshness info */
  freshness: Map<string, FreshnessInfo>
  /** Manually trigger a refresh */
  refresh: () => Promise<void>
  /** Whether currently loading */
  isLoading: boolean
}

/**
 * Hook to track freshness status of pipeline steps.
 *
 * Freshness is determined by comparing input/output file timestamps:
 * - fresh: All outputs exist and are newer than all inputs
 * - stale: Outputs exist but at least one input is newer (needs re-run)
 * - missing: One or more outputs don't exist
 * - no_outputs: Step has no outputs defined
 */
export function useFreshness(autoRefreshMs: number = 0): FreshnessState {
  const [freshness, setFreshness] = useState<Map<string, FreshnessInfo>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const refreshIntervalRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/steps/freshness')
      if (response.ok) {
        const data = await response.json()
        const freshnessData = data.freshness || {}

        const newFreshness = new Map<string, FreshnessInfo>()
        for (const [stepName, info] of Object.entries(freshnessData)) {
          const typedInfo = info as { status: string; reason: string }
          newFreshness.set(stepName, {
            status: typedInfo.status as FreshnessStatus,
            reason: typedInfo.reason,
          })
        }
        setFreshness(newFreshness)
      }
    } catch (error) {
      console.error('Failed to fetch freshness status:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Auto-refresh if interval is set
  useEffect(() => {
    if (autoRefreshMs > 0) {
      // Initial fetch
      refresh()

      // Set up interval
      refreshIntervalRef.current = window.setInterval(refresh, autoRefreshMs)

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
        }
      }
    }
  }, [autoRefreshMs, refresh])

  return { freshness, refresh, isLoading }
}

/**
 * Get a human-readable label for freshness status.
 */
export function getFreshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'Up to date'
    case 'stale':
      return 'Needs re-run'
    case 'missing':
      return 'Not computed'
    case 'no_outputs':
      return 'No outputs'
    default:
      return 'Unknown'
  }
}

/**
 * Get Tailwind CSS classes for freshness status badge.
 */
export function getFreshnessColorClasses(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30'
    case 'stale':
      return 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30'
    case 'missing':
      return 'bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-500/30'
    case 'no_outputs':
      return 'bg-slate-600/20 text-slate-500 border-slate-600/30'
    default:
      return 'bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-500/30'
  }
}

/**
 * Get icon indicator color for freshness status (for node display).
 */
export function getFreshnessIndicatorColor(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'bg-green-500'
    case 'stale':
      return 'bg-amber-500'
    case 'missing':
      return 'bg-slate-400'
    case 'no_outputs':
      return 'bg-slate-600'
    default:
      return 'bg-slate-500'
  }
}
