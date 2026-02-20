export interface FuzzyMatch<T> {
  item: T
  score: number
  indices: number[] // matched character positions (for highlighting)
}

/**
 * Fuzzy search: finds items where all query characters appear in order.
 * Scoring rewards consecutive matches, word-boundary matches, and shorter strings.
 * Results sorted by score ascending (best/lowest first).
 */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): FuzzyMatch<T>[] {
  if (query.length === 0) return []

  const lowerQuery = query.toLowerCase()
  const results: FuzzyMatch<T>[] = []

  for (const item of items) {
    const text = getText(item)
    const lowerText = text.toLowerCase()
    const match = computeMatch(lowerQuery, lowerText)
    if (match) {
      // Bonus for shorter strings (more specific matches)
      const lengthPenalty = text.length * 0.5
      results.push({ item, score: match.score + lengthPenalty, indices: match.indices })
    }
  }

  results.sort((a, b) => a.score - b.score)
  return results
}

function computeMatch(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const indices: number[] = []
  let score = 0
  let textIdx = 0

  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi]
    const foundIdx = text.indexOf(ch, textIdx)
    if (foundIdx === -1) return null // character not found

    indices.push(foundIdx)

    // Consecutive match bonus: previous match was at foundIdx-1
    if (qi > 0 && foundIdx === indices[qi - 1] + 1) {
      // Consecutive — no gap penalty, small bonus
      score -= 2
    } else {
      // Gap penalty
      const gap = qi === 0 ? foundIdx : foundIdx - indices[qi - 1] - 1
      score += gap
    }

    // Word-boundary bonus: start of string, or preceded by separator
    if (foundIdx === 0 || '_- '.includes(text[foundIdx - 1])) {
      score -= 3
    }

    textIdx = foundIdx + 1
  }

  return { score, indices }
}
