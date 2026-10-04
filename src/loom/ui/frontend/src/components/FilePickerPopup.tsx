import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Video,
  Image,
  Table2,
  Braces,
  Folder,
  FileText,
  Loader2,
  FilePlus2,
  AlertTriangle,
} from 'lucide-react'
import type { DataFileEntry, DataType } from '../types/pipeline'
import { buildFilePickerRows, type FilePickerRow } from '../utils/filePicker'
import { inferDataTypeFromFilename } from '../utils/dataNodeCreation'

const TYPE_ICONS: Record<DataType, ReactNode> = {
  image: <Image className="w-4 h-4" />,
  video: <Video className="w-4 h-4" />,
  csv: <Table2 className="w-4 h-4" />,
  json: <Braces className="w-4 h-4" />,
  txt: <FileText className="w-4 h-4" />,
  image_directory: <Folder className="w-4 h-4" />,
  data_folder: <Folder className="w-4 h-4" />,
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FilePickerPopupProps {
  position: { x: number; y: number }
  directoryKey: string
  directoryPath: string
  directoryNestedIn?: string
  onSelect: (entry: DataFileEntry) => void
  /** Called with a relative path the user typed that isn't in the directory yet. */
  onCreateNew: (path: string) => void
  onClose: () => void
}

/**
 * Popup shown when a directory data node's output plug is dropped on empty
 * canvas. Lists the files inside the directory with a fuzzy-search box so one
 * can be dropped into the pipeline as a nested file data node.
 *
 * A name that doesn't match any existing file can be added as an expected
 * output file; that path is forwarded to the parent for confirmation, since
 * Loom cannot know whether the producing step will create it.
 */
export default function FilePickerPopup({
  position,
  directoryKey,
  directoryPath,
  directoryNestedIn,
  onSelect,
  onCreateNew,
  onClose,
}: FilePickerPopupProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<DataFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load the directory listing once on mount.
  useEffect(() => {
    const params = new URLSearchParams()
    if (directoryKey) params.set('name', directoryKey)
    if (directoryPath) params.set('path', directoryPath)
    if (directoryNestedIn) params.set('nested_in', directoryNestedIn)

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/data/files?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to list files (${res.status})`)
        return res.json() as Promise<{ files: DataFileEntry[]; truncated?: boolean }>
      })
      .then((data) => {
        setFiles(data.files ?? [])
        setTruncated(Boolean(data.truncated))
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError('Could not read this directory')
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [directoryKey, directoryPath, directoryNestedIn])

  // Focus the search box as soon as the popup appears.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  const rows = useMemo(() => buildFilePickerRows(query, files), [query, files])
  const canCreate = useMemo(() => rows.some((r) => r.kind === 'create'), [rows])

  const selectRow = useCallback(
    (row: FilePickerRow) => {
      if (row.kind === 'file') {
        onSelect(row.entry)
        onClose()
      } else {
        onCreateNew(row.path)
      }
    },
    [onSelect, onCreateNew, onClose],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (rows.length === 0) return
        setSelectedIndex((i) => Math.min(i + 1, rows.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (rows.length === 0) return
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (rows.length > 0 && selectedIndex < rows.length) {
          selectRow(rows[selectedIndex])
        }
      }
    },
    [onClose, rows, selectedIndex, selectRow],
  )

  // Reset selection when the row list length changes.
  const prevRowsLen = useRef(rows.length)
  useEffect(() => {
    if (rows.length !== prevRowsLen.current) {
      prevRowsLen.current = rows.length
      setSelectedIndex(0)
    }
  }, [rows.length])

  // Keep the highlighted row in view.
  useLayoutEffect(() => {
    if (listRef.current && rows.length > 0) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, rows.length])

  // Keep the popup within the viewport.
  useLayoutEffect(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let { x, y } = position
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8
    if (x < 0) x = 8
    if (y < 0) y = 8
    if (x !== adjustedPosition.x || y !== adjustedPosition.y) setAdjustedPosition({ x, y })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute on initial render
  }, [])

  return (
    <>
      {/* Transparent backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Popup */}
      <div
        ref={containerRef}
        className="fixed z-50 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-600"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 truncate">
          Files in ${directoryKey}
        </div>
        <div className="p-2 pt-0">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or name a file..."
            autoFocus
            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {canCreate && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              Not an existing file — added as an expected output.
            </p>
          )}
        </div>

        {loading && (
          <div className="px-3 py-3 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Reading directory...
          </div>
        )}

        {!loading && error && (
          <div className="px-3 py-3 text-xs text-red-500 border-t border-slate-200 dark:border-slate-700">
            {error}
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto border-t border-slate-200 dark:border-slate-700"
          >
            {rows.map((row, idx) => {
              const highlighted = idx === selectedIndex
              const commonClass = `w-full px-3 py-2 flex items-center gap-2 text-left text-sm transition-colors ${
                highlighted ? 'bg-blue-100 dark:bg-blue-900/50 text-slate-900 dark:text-white' : ''
              }`

              if (row.kind === 'create') {
                return (
                  <button
                    key={`create:${row.path}`}
                    onClick={() => selectRow(row)}
                    className={`${commonClass} ${
                      highlighted
                        ? ''
                        : 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                    }`}
                  >
                    <span className="flex-shrink-0 text-amber-500 dark:text-amber-400">
                      <FilePlus2 className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">
                        Add &ldquo;{row.name}&rdquo; as new file
                      </span>
                      <span className="block truncate text-[10px] text-amber-600/80 dark:text-amber-400/80">
                        assumed from output — unverified
                      </span>
                    </span>
                  </button>
                )
              }

              const entry = row.entry
              return (
                <button
                  key={entry.path}
                  onClick={() => selectRow(row)}
                  className={`${commonClass} ${
                    highlighted
                      ? ''
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="flex-shrink-0 text-slate-500 dark:text-slate-400">
                    {TYPE_ICONS[inferDataTypeFromFilename(entry.name)]}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{entry.name}</span>
                    {entry.path !== entry.name && (
                      <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
                        {entry.path}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                    {formatSize(entry.size)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700">
            {files.length === 0 ? 'No files in this directory' : 'No matching files'}
          </div>
        )}

        {truncated && (
          <div className="px-3 py-1.5 text-[10px] text-amber-500 border-t border-slate-200 dark:border-slate-700">
            Showing the first files only
          </div>
        )}
      </div>
    </>
  )
}
