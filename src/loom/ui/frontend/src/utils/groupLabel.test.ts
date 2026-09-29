import { describe, it, expect } from 'vitest'
import {
  computeCenteredGroupLabel,
  wrapText,
  CHAR_WIDTH_RATIO,
  INNER_RATIO,
  LINE_HEIGHT_RATIO,
  MAX_LINES,
  MAX_SCREEN_FONT_SIZE,
  MIN_SCREEN_FONT_SIZE,
} from './groupLabel'

// =============================================================================
// wrapText
// =============================================================================

describe('wrapText', () => {
  it('keeps words on one line while they fit', () => {
    expect(wrapText('alpha beta gamma', 20)).toEqual(['alpha beta gamma'])
  })

  it('breaks between words when the line is full', () => {
    expect(wrapText('alpha beta gamma', 5)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('packs multiple short words per line', () => {
    expect(wrapText('a b c d', 3)).toEqual(['a b', 'c d'])
  })

  it('never splits a word, leaving it on its own line', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcdefghij'])
    expect(wrapText('hi abcdefghij', 4)).toEqual(['hi', 'abcdefghij'])
  })

  it('returns a single empty line for blank input', () => {
    expect(wrapText('   ', 5)).toEqual([''])
  })
})

// =============================================================================
// computeCenteredGroupLabel
// =============================================================================

describe('computeCenteredGroupLabel', () => {
  it('wraps a narrow group onto multiple lines instead of shrinking to one', () => {
    const name = 'Alpha Beta Gamma Delta Epsilon'
    const width = 90
    const height = 300
    const zoom = 1

    const result = computeCenteredGroupLabel(name, width, height, zoom)

    expect(result.hidden).toBe(false)
    expect(result.overflow).toBe(false)
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.fontSize).toBeGreaterThanOrEqual(MIN_SCREEN_FONT_SIZE)

    // A single-line "shrink to fit width" layout would be microscopic here.
    const naiveSingleLineFont = (width * zoom * INNER_RATIO) / (CHAR_WIDTH_RATIO * name.length)
    expect(result.fontSize).toBeGreaterThan(naiveSingleLineFont)
  })

  it('keeps short names on a single line in a wide group', () => {
    const result = computeCenteredGroupLabel('Ops', 400, 120, 1)
    expect(result.hidden).toBe(false)
    expect(result.lines).toEqual(['Ops'])
  })

  it('shrinks to stay inside the rectangle instead of overflowing', () => {
    // At this zoom the old floor-based approach kept a readable font but let it
    // spill outside the box. Now the label scales down to fit.
    const result = computeCenteredGroupLabel('Processing', 200, 120, 0.15)

    expect(result.hidden).toBe(false)
    expect(result.overflow).toBe(false)
    expect(result.lines).toEqual(['Processing'])

    const innerWidth = 200 * 0.15 * INNER_RATIO
    expect(result.lines[0].length * CHAR_WIDTH_RATIO * result.fontSize).toBeLessThanOrEqual(
      innerWidth + 1e-6,
    )
  })

  it('returns the overflow floor only when the rectangle is sub-glyph sized', () => {
    const result = computeCenteredGroupLabel('Preprocessing', 40, 20, 0.2)
    expect(result.hidden).toBe(false)
    expect(result.fontSize).toBe(MIN_SCREEN_FONT_SIZE)
    // The word is preserved, not chopped into pieces.
    expect(result.lines).toEqual(['Preprocessing'])
    expect(result.overflow).toBe(true)
  })

  it('hides the label only for an empty name', () => {
    expect(computeCenteredGroupLabel('', 400, 300, 1).hidden).toBe(true)
  })

  it('hides the label for degenerate geometry', () => {
    expect(computeCenteredGroupLabel('Ops', 0, 300, 1).hidden).toBe(true)
    expect(computeCenteredGroupLabel('Ops', 400, 0, 1).hidden).toBe(true)
    expect(computeCenteredGroupLabel('Ops', 400, 300, 0).hidden).toBe(true)
  })

  it('clamps the font size to the configured range', () => {
    const result = computeCenteredGroupLabel('Ops', 5000, 5000, 1)
    expect(result.fontSize).toBeGreaterThanOrEqual(MIN_SCREEN_FONT_SIZE)
    expect(result.fontSize).toBeLessThanOrEqual(MAX_SCREEN_FONT_SIZE)
  })

  it('never grows the font as the user zooms out', () => {
    const zoomedIn = computeCenteredGroupLabel('Data Processing', 200, 160, 0.5)
    const zoomedOut = computeCenteredGroupLabel('Data Processing', 200, 160, 0.25)
    expect(zoomedOut.fontSize).toBeLessThanOrEqual(zoomedIn.fontSize)
  })

  it('always fits inside the rectangle unless the rectangle is sub-glyph sized', () => {
    const names = [
      'Ops',
      'Data Processing',
      'A Very Long Group Name With Many Words Indeed',
      'Supercalifragilisticexpialidocious',
    ]
    const widths = [40, 80, 150, 300, 600]
    const heights = [30, 80, 200, 400]
    const zooms = [0.15, 0.25, 0.4, 0.75, 1, 2]

    for (const name of names) {
      for (const width of widths) {
        for (const height of heights) {
          for (const zoom of zooms) {
            const result = computeCenteredGroupLabel(name, width, height, zoom)
            expect(result.hidden).toBe(false)
            if (result.overflow) {
              expect(result.fontSize).toBe(MIN_SCREEN_FONT_SIZE)
              continue
            }

            const innerWidth = width * zoom * INNER_RATIO
            const innerHeight = height * zoom * INNER_RATIO
            const glyphWidth = CHAR_WIDTH_RATIO * result.fontSize

            expect(result.lines.length).toBeLessThanOrEqual(MAX_LINES)
            expect(result.lines.length * LINE_HEIGHT_RATIO * result.fontSize).toBeLessThanOrEqual(
              innerHeight + 1e-6,
            )
            for (const line of result.lines) {
              expect(line.length * glyphWidth).toBeLessThanOrEqual(innerWidth + 1e-6)
            }
          }
        }
      }
    }
  })
})
