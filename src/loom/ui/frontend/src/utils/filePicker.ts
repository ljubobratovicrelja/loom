import type { DataFileEntry } from '../types/pipeline'
import { fuzzySearch } from './fuzzySearch'

/** A row in the directory file picker: an existing file or a "create" option. */
export type FilePickerRow =
  | { kind: 'file'; entry: DataFileEntry }
  | { kind: 'create'; path: string; name: string }

/**
 * Builds the picker rows for a query.
 *
 * With an empty query all files are shown. A non-empty query fuzzy-filters the
 * files, and when it matches no existing file (by relative path or name) a
 * `create` row is appended so the typed name can be added as an expected output.
 */
export function buildFilePickerRows(query: string, files: DataFileEntry[]): FilePickerRow[] {
  const trimmed = query.trim()
  const matched = trimmed ? fuzzySearch(trimmed, files, (f) => f.path).map((m) => m.item) : files
  const rows: FilePickerRow[] = matched.map((entry) => ({ kind: 'file', entry }))

  const exists = trimmed.length > 0 && files.some((f) => f.path === trimmed || f.name === trimmed)
  if (trimmed.length > 0 && !exists) {
    rows.push({
      kind: 'create',
      path: trimmed,
      name: trimmed.split('/').pop() || trimmed,
    })
  }

  return rows
}
