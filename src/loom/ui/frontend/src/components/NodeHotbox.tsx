import { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect, type ReactNode } from 'react'
import { Cog, Image, Video, Table2, Braces, FolderOpen, Folder, DollarSign } from 'lucide-react'
import type { TaskInfo, DataType } from '../types/pipeline'
import { fuzzySearch } from '../utils/fuzzySearch'

const MIN_QUERY_LENGTH = 3

interface HotboxItem {
  id: string
  label: string
  category: 'task' | 'data' | 'param'
  icon: ReactNode
  task?: TaskInfo
  dataType?: DataType
  paramName?: string
  paramValue?: unknown
}

const DATA_TYPE_ENTRIES: Array<{ type: DataType; icon: ReactNode; label: string }> = [
  { type: 'image', icon: <Image className="w-4 h-4" />, label: 'Image' },
  { type: 'video', icon: <Video className="w-4 h-4" />, label: 'Video' },
  { type: 'csv', icon: <Table2 className="w-4 h-4" />, label: 'CSV' },
  { type: 'json', icon: <Braces className="w-4 h-4" />, label: 'JSON' },
  { type: 'image_directory', icon: <FolderOpen className="w-4 h-4" />, label: 'Image Directory' },
  { type: 'data_folder', icon: <Folder className="w-4 h-4" />, label: 'Data Folder' },
]

interface NodeHotboxProps {
  position: { x: number; y: number }
  flowPosition: { x: number; y: number }
  tasks: TaskInfo[]
  parameters: Record<string, unknown>
  onAddTask: (task: TaskInfo, position: { x: number; y: number }) => void
  onAddData: (dataType: DataType, position: { x: number; y: number }) => void
  onAddParameter: (name: string, value: unknown, position: { x: number; y: number }) => void
  onClose: () => void
}

export default function NodeHotbox({
  position,
  flowPosition,
  tasks,
  parameters,
  onAddTask,
  onAddData,
  onAddParameter,
  onClose,
}: NodeHotboxProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  // Build unified item list
  const allItems = useMemo<HotboxItem[]>(() => [
    ...tasks.map((t): HotboxItem => ({
      id: `task:${t.path}`,
      label: t.name,
      category: 'task',
      icon: <Cog className="w-4 h-4" />,
      task: t,
    })),
    ...Object.entries(parameters).map(([name, value]): HotboxItem => ({
      id: `param:${name}`,
      label: name,
      category: 'param',
      icon: <DollarSign className="w-4 h-4" />,
      paramName: name,
      paramValue: value,
    })),
    ...DATA_TYPE_ENTRIES.map((dt): HotboxItem => ({
      id: `data:${dt.type}`,
      label: dt.label,
      category: 'data',
      icon: dt.icon,
      dataType: dt.type,
    })),
  ], [tasks, parameters])

  // Filter with fuzzy search only when query is long enough
  const results = useMemo(() =>
    query.length >= MIN_QUERY_LENGTH
      ? fuzzySearch(query, allItems, (item) => item.label)
          .map((m) => m.item)
      : []
  , [query, allItems])

  const selectItem = useCallback((item: HotboxItem) => {
    if (item.category === 'task' && item.task) {
      onAddTask(item.task, flowPosition)
    } else if (item.category === 'param' && item.paramName !== undefined) {
      onAddParameter(item.paramName, item.paramValue, flowPosition)
    } else if (item.category === 'data' && item.dataType) {
      onAddData(item.dataType, flowPosition)
    }
    onClose()
  }, [flowPosition, onAddTask, onAddParameter, onAddData, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (results.length === 0) return
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length > 0 && selectedIndex < results.length) {
        selectItem(results[selectedIndex])
      }
    }
  }, [onClose, results, selectedIndex, selectItem])

  // Reset selection when results change
  const prevResultsLen = useRef(results.length)
  useEffect(() => {
    if (results.length !== prevResultsLen.current) {
      prevResultsLen.current = results.length
      setSelectedIndex(0)
    }
  }, [results.length])

  // Scroll selected item into view
  useLayoutEffect(() => {
    if (listRef.current && results.length > 0) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, results.length])

  // Adjust position to stay within viewport
  useLayoutEffect(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let { x, y } = position
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8
    }
    if (x < 0) x = 8
    if (y < 0) y = 8
    if (x !== adjustedPosition.x || y !== adjustedPosition.y) {
      setAdjustedPosition({ x, y })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute on initial render
  }, [])

  return (
    <>
      {/* Transparent backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Popup */}
      <div
        ref={containerRef}
        className="fixed z-50 w-72 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-600"
        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
      >
        <div className="p-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes..."
            autoFocus
            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {results.length > 0 && (
          <div ref={listRef} className="max-h-60 overflow-y-auto border-t border-slate-200 dark:border-slate-700">
            {results.map((item, idx) => (
              <button
                key={item.id}
                onClick={() => selectItem(item)}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left text-sm transition-colors ${
                  idx === selectedIndex
                    ? 'bg-blue-100 dark:bg-blue-900/50 text-slate-900 dark:text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span className="flex-shrink-0 text-slate-500 dark:text-slate-400">{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  item.category === 'task'
                    ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                    : item.category === 'param'
                    ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                    : 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                }`}>
                  {item.category === 'task' ? 'task' : item.category === 'param' ? 'param' : item.dataType}
                </span>
              </button>
            ))}
          </div>
        )}

        {query.length > 0 && query.length < MIN_QUERY_LENGTH && (
          <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700">
            Type {MIN_QUERY_LENGTH - query.length} more character{MIN_QUERY_LENGTH - query.length > 1 ? 's' : ''} to search...
          </div>
        )}

        {query.length >= MIN_QUERY_LENGTH && results.length === 0 && (
          <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700">
            No matches found
          </div>
        )}
      </div>
    </>
  )
}
