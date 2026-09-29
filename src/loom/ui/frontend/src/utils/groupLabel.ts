// Fitting logic for group labels drawn inside a group rectangle.
//
// When zoomed out, the label is centered in the rectangle and sized to fill as
// much of it as possible. The naive "one line, shrink to fit width" approach
// makes narrow groups microscopic, so instead we wrap the name onto multiple
// lines (never splitting a word) and pick the largest font size that still
// fits. Sizing is done in SCREEN pixels so the label stays readable as the user
// zooms out, matching the corner label (already screen-anchored via `13 / zoom`).
//
// The font is always chosen to fit the rectangle. Because wrapping maximizes the
// size against both dimensions, this is the largest font that stays inside — at
// extreme zoom it necessarily shrinks along with the rectangle, but it never
// overflows and never disappears.
// Once the rectangle is large enough that the fitted font would exceed
// MAX_SCREEN_FONT_SIZE, we stop scaling up and leave the label at that cap.

/** Absolute floor used only to avoid a zero font size; below this the label is
 *  effectively invisible anyway and a hair of overflow is tolerated. */
export const MIN_SCREEN_FONT_SIZE = 1
/** Upper clamp so short names in large groups don't become absurd. */
export const MAX_SCREEN_FONT_SIZE = 44
/** Never grow past this many lines (very narrow/tall groups). */
export const MAX_LINES = 4
/** Bold sans-serif line box height relative to font size. */
export const LINE_HEIGHT_RATIO = 1.15
/** Approximate average glyph advance for the bold sans label font (~0.6em). */
export const CHAR_WIDTH_RATIO = 0.6
/** Fraction of the rectangle used by the text block (leaves a margin). */
export const INNER_RATIO = 0.85

export interface GroupLabelLayout {
  /** True when there is nothing to render (empty name / invalid geometry). */
  hidden: boolean
  /** Font size in screen pixels (divide by zoom to get world pixels). */
  fontSize: number
  /** Wrapped lines, for callers that want to render them explicitly. */
  lines: string[]
  /**
   * True only when even MIN_SCREEN_FONT_SIZE couldn't fit, i.e. the rectangle is
   * smaller than a single glyph. Effectively invisible; kept for completeness.
   */
  overflow: boolean
}

/**
 * Greedily wrap `text` into lines of at most `maxChars` characters, breaking
 * only between words. A word wider than a line is left intact on its own line
 * (the caller treats that as "does not fit").
 */
export function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars))
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  return lines
}

/**
 * Pick the largest screen-space font size (and the resulting wrapped lines) at
 * which `name` fits inside the group rectangle. The rectangle dimensions are in
 * world pixels; `zoom` converts them to screen pixels.
 */
export function computeCenteredGroupLabel(
  name: string,
  width: number,
  height: number,
  zoom: number,
): GroupLabelLayout {
  if (!name || width <= 0 || height <= 0 || zoom <= 0) {
    return { hidden: true, fontSize: MIN_SCREEN_FONT_SIZE, lines: [], overflow: false }
  }

  const innerWidth = width * zoom * INNER_RATIO
  const innerHeight = height * zoom * INNER_RATIO
  const longestWord = name
    .trim()
    .split(/\s+/)
    .reduce((max, word) => Math.max(max, word.length), 0)

  const linesAt = (fontSize: number): string[] =>
    wrapText(name, innerWidth / (CHAR_WIDTH_RATIO * fontSize))

  const fitsAt = (fontSize: number): boolean => {
    const maxChars = innerWidth / (CHAR_WIDTH_RATIO * fontSize)
    // A single word must fit on a line (we never split words).
    if (longestWord > Math.floor(maxChars)) return false
    const lines = linesAt(fontSize)
    return lines.length <= MAX_LINES && lines.length * LINE_HEIGHT_RATIO * fontSize <= innerHeight
  }

  // `fitsAt` is monotone: shrinking the font can only reduce the wrapped height.
  // Search the whole range so the label always fits; this never overflows.
  let lo = MIN_SCREEN_FONT_SIZE
  let hi = Math.max(MIN_SCREEN_FONT_SIZE, MAX_SCREEN_FONT_SIZE)
  if (!fitsAt(lo)) {
    return { hidden: false, fontSize: lo, lines: linesAt(lo), overflow: true }
  }
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2
    if (fitsAt(mid)) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const fontSize = Math.max(MIN_SCREEN_FONT_SIZE, Math.floor(lo))
  return { hidden: false, fontSize, lines: linesAt(fontSize), overflow: false }
}
