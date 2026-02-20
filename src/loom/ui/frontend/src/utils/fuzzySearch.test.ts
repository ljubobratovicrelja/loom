import { describe, it, expect } from 'vitest'
import { fuzzySearch } from './fuzzySearch'

const items = [
  'resize_image',
  'crop_video',
  'parse_json',
  'extract_frames',
  'build_mosaic',
  'run_inference',
]

const getText = (s: string) => s

describe('fuzzySearch', () => {
  it('matches substring characters in order', () => {
    const results = fuzzySearch('rsi', items, getText)
    const matched = results.map((r) => r.item)
    expect(matched).toContain('resize_image')
  })

  it('rejects when characters are missing', () => {
    const results = fuzzySearch('xyz', items, getText)
    expect(results).toHaveLength(0)
  })

  it('scores consecutive matches higher (lower score)', () => {
    // "res" is consecutive in "resize_image" but scattered in others
    const results = fuzzySearch('res', items, getText)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toBe('resize_image')
  })

  it('scores word-boundary matches higher', () => {
    // "bi" matches at word boundary in "build_mosaic" (b at start, then i)
    // vs "crop_video" where neither is at a word boundary start
    const results = fuzzySearch('bm', items, getText)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toBe('build_mosaic')
  })

  it('is case insensitive', () => {
    const results = fuzzySearch('RESIZE', items, getText)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item).toBe('resize_image')
  })

  it('returns empty for empty query', () => {
    const results = fuzzySearch('', items, getText)
    expect(results).toHaveLength(0)
  })

  it('sorts results by score (best first)', () => {
    const results = fuzzySearch('ri', items, getText)
    // All scores should be in non-decreasing order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i - 1].score)
    }
  })

  it('returns matched character indices', () => {
    const results = fuzzySearch('ri', items, getText)
    const resizeMatch = results.find((r) => r.item === 'resize_image')
    expect(resizeMatch).toBeDefined()
    // 'r' at 0, 'i' at 3 in "resize_image"
    expect(resizeMatch!.indices).toEqual([0, 3])
  })

  it('handles single character query', () => {
    const results = fuzzySearch('r', items, getText)
    expect(results.length).toBeGreaterThan(0)
  })

  it('prefers shorter strings for specificity', () => {
    const shortItems = ['ab', 'ab_long_name_here']
    const results = fuzzySearch('ab', shortItems, getText)
    expect(results[0].item).toBe('ab')
  })
})
