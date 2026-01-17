import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useFreshness,
  getFreshnessLabel,
  getFreshnessColorClasses,
  getFreshnessIndicatorColor,
} from './useFreshness'
import type { FreshnessStatus } from '../types/pipeline'

// =============================================================================
// getFreshnessLabel Tests
// =============================================================================

describe('getFreshnessLabel', () => {
  it('should return "Up to date" for fresh status', () => {
    expect(getFreshnessLabel('fresh')).toBe('Up to date')
  })

  it('should return "Needs re-run" for stale status', () => {
    expect(getFreshnessLabel('stale')).toBe('Needs re-run')
  })

  it('should return "Not computed" for missing status', () => {
    expect(getFreshnessLabel('missing')).toBe('Not computed')
  })

  it('should return "No outputs" for no_outputs status', () => {
    expect(getFreshnessLabel('no_outputs')).toBe('No outputs')
  })

  it('should return "Unknown" for unrecognized status', () => {
    // Cast to test edge case behavior
    expect(getFreshnessLabel('invalid' as FreshnessStatus)).toBe('Unknown')
  })
})

// =============================================================================
// getFreshnessColorClasses Tests
// =============================================================================

describe('getFreshnessColorClasses', () => {
  it('should return green classes for fresh status', () => {
    const classes = getFreshnessColorClasses('fresh')
    expect(classes).toContain('green')
  })

  it('should return amber classes for stale status', () => {
    const classes = getFreshnessColorClasses('stale')
    expect(classes).toContain('amber')
  })

  it('should return slate classes for missing status', () => {
    const classes = getFreshnessColorClasses('missing')
    expect(classes).toContain('slate')
  })

  it('should return slate classes for no_outputs status', () => {
    const classes = getFreshnessColorClasses('no_outputs')
    expect(classes).toContain('slate')
  })

  it('should return fallback classes for unknown status', () => {
    const classes = getFreshnessColorClasses('invalid' as FreshnessStatus)
    expect(classes).toContain('slate')
  })
})

// =============================================================================
// getFreshnessIndicatorColor Tests
// =============================================================================

describe('getFreshnessIndicatorColor', () => {
  it('should return bg-green-500 for fresh status', () => {
    expect(getFreshnessIndicatorColor('fresh')).toBe('bg-green-500')
  })

  it('should return bg-amber-500 for stale status', () => {
    expect(getFreshnessIndicatorColor('stale')).toBe('bg-amber-500')
  })

  it('should return bg-slate-400 for missing status', () => {
    expect(getFreshnessIndicatorColor('missing')).toBe('bg-slate-400')
  })

  it('should return bg-slate-600 for no_outputs status', () => {
    expect(getFreshnessIndicatorColor('no_outputs')).toBe('bg-slate-600')
  })

  it('should return bg-slate-500 for unknown status', () => {
    expect(getFreshnessIndicatorColor('invalid' as FreshnessStatus)).toBe('bg-slate-500')
  })
})

// =============================================================================
// useFreshness Hook Tests
// =============================================================================

describe('useFreshness hook', () => {
  let originalFetch: typeof global.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
    vi.useFakeTimers()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  describe('refresh function', () => {
    it('should fetch freshness data and update state', async () => {
      const mockResponse = {
        freshness: {
          step1: { status: 'fresh', reason: 'Up to date' },
          step2: { status: 'stale', reason: 'Input newer' },
        },
      }
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const { result } = renderHook(() => useFreshness())

      // Initial state should be empty
      expect(result.current.freshness.size).toBe(0)
      expect(result.current.isLoading).toBe(false)

      // Call refresh
      await act(async () => {
        await result.current.refresh()
      })

      // Should have parsed the response into a Map
      expect(result.current.freshness.size).toBe(2)
      expect(result.current.freshness.get('step1')).toEqual({
        status: 'fresh',
        reason: 'Up to date',
      })
      expect(result.current.freshness.get('step2')).toEqual({
        status: 'stale',
        reason: 'Input newer',
      })
      expect(result.current.isLoading).toBe(false)
    })

    it('should set isLoading during fetch', async () => {
      let resolvePromise: (value: unknown) => void
      const fetchPromise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      fetchMock.mockReturnValueOnce(fetchPromise)

      const { result } = renderHook(() => useFreshness())

      // Start refresh
      let refreshPromise: Promise<void>
      act(() => {
        refreshPromise = result.current.refresh()
      })

      // Should be loading
      expect(result.current.isLoading).toBe(true)

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ freshness: {} }),
        })
        await refreshPromise
      })

      expect(result.current.isLoading).toBe(false)
    })

    it('should handle fetch errors gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      fetchMock.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useFreshness())

      await act(async () => {
        await result.current.refresh()
      })

      // Should not throw, state should remain empty
      expect(result.current.freshness.size).toBe(0)
      expect(result.current.isLoading).toBe(false)
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should handle non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const { result } = renderHook(() => useFreshness())

      await act(async () => {
        await result.current.refresh()
      })

      // Should not update freshness on error response
      expect(result.current.freshness.size).toBe(0)
      expect(result.current.isLoading).toBe(false)
    })

    it('should handle empty freshness data', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ freshness: {} }),
      })

      const { result } = renderHook(() => useFreshness())

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.freshness.size).toBe(0)
    })

    it('should handle missing freshness field in response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const { result } = renderHook(() => useFreshness())

      await act(async () => {
        await result.current.refresh()
      })

      // Should handle gracefully with empty map
      expect(result.current.freshness.size).toBe(0)
    })
  })

  describe('auto-refresh', () => {
    it('should not auto-refresh when autoRefreshMs is 0', async () => {
      const { result } = renderHook(() => useFreshness(0))

      // Advance timers
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      // Should not have called fetch
      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.current.freshness.size).toBe(0)
    })

    it('should auto-refresh when autoRefreshMs is set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ freshness: { step1: { status: 'fresh', reason: 'ok' } } }),
      })

      renderHook(() => useFreshness(1000))

      // Initial fetch should happen immediately
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // After interval, should fetch again
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // And again
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('should cleanup interval on unmount', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ freshness: {} }),
      })

      const { unmount } = renderHook(() => useFreshness(1000))

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Unmount
      unmount()

      // Advance timer - should NOT trigger more fetches
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
