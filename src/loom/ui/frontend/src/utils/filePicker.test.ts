import { describe, it, expect } from 'vitest'
import { buildFilePickerRows } from './filePicker'
import type { DataFileEntry } from '../types/pipeline'

const files: DataFileEntry[] = [
  { name: 'hello.txt', path: 'hello.txt', size: 10 },
  { name: 'report.json', path: 'sub/report.json', size: 20 },
]

function names(rows: ReturnType<typeof buildFilePickerRows>): string[] {
  return rows.map((r) => (r.kind === 'file' ? r.entry.name : r.name))
}

describe('buildFilePickerRows', () => {
  it('shows all files for an empty query', () => {
    expect(buildFilePickerRows('', files)).toEqual([
      { kind: 'file', entry: files[0] },
      { kind: 'file', entry: files[1] },
    ])
  })

  it('filters with fuzzy search and still offers the typed name', () => {
    expect(names(buildFilePickerRows('hell', files))).toEqual(['hello.txt', 'hell'])
  })

  it('appends a create row when the name does not exist', () => {
    const rows = buildFilePickerRows('new_file.csv', files)
    expect(rows.find((r) => r.kind === 'create')).toEqual({
      kind: 'create',
      path: 'new_file.csv',
      name: 'new_file.csv',
    })
  })

  it('does not create when the query exactly matches an existing name', () => {
    const rows = buildFilePickerRows('hello.txt', files)
    expect(rows.some((r) => r.kind === 'create')).toBe(false)
  })

  it('does not create when the query exactly matches an existing path', () => {
    const rows = buildFilePickerRows('sub/report.json', files)
    expect(rows.some((r) => r.kind === 'create')).toBe(false)
  })

  it('derives the display name from a subpath query', () => {
    const rows = buildFilePickerRows('nested/new.json', files)
    expect(rows.find((r) => r.kind === 'create')).toEqual({
      kind: 'create',
      path: 'nested/new.json',
      name: 'new.json',
    })
  })
})
