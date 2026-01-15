import { describe, it, expect } from 'vitest'
import {
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
