import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ExternalLink, Folder, X } from 'lucide-react'
import type { DataType } from '../types/pipeline'
import { highlightCode, languageForPath } from '../utils/highlight'

const API_BASE = '/api'

/** Remote assets are fetched directly, bypassing the local content endpoint. */
const isRemoteUrl = (path: string): boolean =>
  path.startsWith('http://') || path.startsWith('https://')

export interface PreviewTarget {
  key: string
  name: string
  path: string
  type: DataType
  /** Parent data node key when the file lives inside a directory node. */
  nestedIn?: string
}

interface DataPreviewWindowProps {
  target: PreviewTarget
  onClose: () => void
  onOpenInOS: (path: string) => void
}

interface DataFileEntry {
  name: string
  path: string
  size: number
}

/** Build the URL for the raw-content endpoint (remote URLs pass through). */
function contentUrl(path: string): string {
  if (isRemoteUrl(path)) return path
  return `${API_BASE}/content/by-path?path=${encodeURIComponent(path)}`
}

const TEXT_TYPES: DataType[] = ['txt', 'csv', 'json']
const DIR_TYPES: DataType[] = ['image_directory', 'data_folder']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Text body: fetch as text and render in a scrollable <pre>. */
function TextView({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setText(null)
    setError(null)
    fetch(contentUrl(path), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then(setText)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Could not read file')
      })
    return () => controller.abort()
  }, [path])

  // Guard against pathological files: only render the first ~5000 lines.
  // Hooks run before the early returns so the hook order stays stable.
  const lines = text?.split('\n') ?? []
  const truncated = lines.length > 5000
  const shown = lines.slice(0, 5000).join('\n')
  const language = languageForPath(path)
  const html = useMemo(() => highlightCode(shown, language), [shown, language])

  if (error) return <div className="p-4 text-sm text-red-500">Could not read file: {error}</div>
  if (text === null) return <div className="p-4 text-sm text-slate-500">Loading…</div>

  return (
    <div className="h-full overflow-auto bg-slate-50 dark:bg-slate-900">
      <pre className="p-4 text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre">
        <code
          className={language ? `hljs language-${language}` : 'hljs'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
      {truncated && (
        <div className="px-4 pb-4 text-xs text-slate-500">
          Truncated to first 5000 lines ({lines.length.toLocaleString()} total)
        </div>
      )}
    </div>
  )
}

/** Fullscreen toggle for image/video: request fullscreen on the media element. */
function MediaView({ path, type }: { path: string; type: 'image' | 'video' }) {
  const ref = useRef<HTMLImageElement | HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleFullscreen = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen?.().catch(() => {
        setError('Fullscreen not permitted by the browser')
      })
    }
  }, [])

  return (
    <div className="relative h-full w-full flex items-center justify-center bg-black/90">
      <button
        onClick={toggleFullscreen}
        className="absolute top-2 right-2 z-10 px-2 py-1 rounded bg-black/60 text-white text-xs hover:bg-black/80 transition-colors"
        title="Fullscreen"
      >
        Fullscreen
      </button>
      {error && <div className="absolute bottom-2 left-2 text-xs text-red-400">{error}</div>}
      {type === 'image' ? (
        <img
          ref={(el) => {
            ref.current = el
          }}
          src={contentUrl(path)}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setError('Could not load image')}
        />
      ) : (
        <video
          ref={(el) => {
            ref.current = el
          }}
          src={contentUrl(path)}
          controls
          autoPlay={false}
          className="h-full w-full object-contain"
          onError={() => setError('Could not load video')}
        />
      )}
    </div>
  )
}

/** Directory listing: flat table grouped by folder, with breadcrumb drill-down. */
function DirectoryView({
  target,
  onDrill,
}: {
  target: PreviewTarget
  onDrill: (path: string, type: DataType) => void
}) {
  const [files, setFiles] = useState<DataFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (target.nestedIn) {
      params.set('path', target.path)
      params.set('nested_in', target.nestedIn)
    } else {
      params.set('name', target.key)
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/data/files?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{
          files: DataFileEntry[]
          truncated?: boolean
        }>
      })
      .then((data) => {
        setFiles(data.files ?? [])
        setTruncated(Boolean(data.truncated))
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Could not list directory')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [target.key, target.path, target.nestedIn])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const filtered = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files
    return filtered.slice(0, 2000)
  }, [files, filter])

  const openFile = (entry: DataFileEntry) => {
    // Nested file inside a directory node: reuse the parent's type so the
    // window picks the right renderer.
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg']
    const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']
    const type: DataType = imageExts.includes(ext)
      ? 'image'
      : videoExts.includes(ext)
        ? 'video'
        : ext === 'json'
          ? 'json'
          : ext === 'csv'
            ? 'csv'
            : 'txt'
    const fullPath = target.path.endsWith('/')
      ? `${target.path}${entry.path}`
      : `${target.path}/${entry.path}`
    onDrill(fullPath, type)
  }

  if (loading) return <div className="p-4 text-sm text-slate-500">Loading…</div>
  if (error)
    return <div className="p-4 text-sm text-red-500">Could not list directory: {error}</div>

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="flex-1 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
        />
        <span className="text-xs text-slate-500">{rows.length} files</span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((entry) => (
              <tr
                key={entry.path}
                onClick={() => openFile(entry)}
                className="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800"
              >
                <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300 truncate max-w-[70%]">
                  {entry.path}
                </td>
                <td className="px-3 py-1.5 text-right text-slate-500 whitespace-nowrap">
                  {formatSize(entry.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && (
          <div className="px-3 py-2 text-xs text-slate-500">
            Listing truncated — use the filter to narrow it down.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * In-graph preview window for data nodes.
 *
 * Sits inside the canvas container: the graph behind it is dimmed by a
 * full-container backdrop, and clicking the backdrop (or pressing Escape)
 * closes it. The React Flow canvas is never unmounted, so the viewport and
 * selection survive.
 */
export default function DataPreviewWindow({ target, onClose, onOpenInOS }: DataPreviewWindowProps) {
  const [current, setCurrent] = useState<PreviewTarget>(target)
  const [breadcrumb, setBreadcrumb] = useState<PreviewTarget[]>([])

  useEffect(() => {
    setCurrent(target)
    setBreadcrumb([])
  }, [target])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const drill = useCallback(
    (path: string, type: DataType) => {
      setBreadcrumb((prev) => [...prev, current])
      setCurrent({ ...current, path, type, name: path.split('/').pop() ?? path })
    },
    [current],
  )

  const goBack = useCallback(() => {
    setBreadcrumb((prev) => {
      if (prev.length === 0) return prev
      const next = prev[prev.length - 1]
      setCurrent(next)
      return prev.slice(0, -1)
    })
  }, [])

  const isText = TEXT_TYPES.includes(current.type)
  const isDir = DIR_TYPES.includes(current.type)

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      {/* Shade: dims the graph, clicking closes the window */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* The window: 80% of the smaller edge, so it stays landscape/portrait aware.
          Both dimensions are clamped so the window never overflows the canvas. */}
      <div
        data-preview-window
        className="relative flex flex-col bg-white dark:bg-slate-900 rounded-lg shadow-2xl border border-slate-300 dark:border-slate-700 overflow-hidden"
        style={{
          width: 'min(80vh, 80vw)',
          height: 'min(80vh, 80vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0">
          {breadcrumb.length > 0 && (
            <button
              onClick={goBack}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="Back"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          )}
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {isDir && <Folder className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />}
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
              {current.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex-shrink-0">
              {current.type}
            </span>
          </div>
          <span
            className="text-xs text-slate-500 truncate max-w-[40%] hidden sm:block"
            title={current.path}
          >
            {current.path}
          </span>
          <button
            onClick={() => onOpenInOS(current.path)}
            className="p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
            title="Open in native application"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {current.type === 'image' && <MediaView path={current.path} type="image" />}
          {current.type === 'video' && <MediaView path={current.path} type="video" />}
          {isText && <TextView path={current.path} />}
          {isDir && <DirectoryView target={current} onDrill={drill} />}
        </div>
      </div>
    </div>
  )
}
