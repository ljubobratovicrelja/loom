import { memo, useContext, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Video, Image, Table2, Braces, FolderOpen, Folder, FileText, Link } from 'lucide-react'
import type { DataNode as DataNodeType, DataType } from '../types/pipeline'
import { useThumbnail } from '../hooks/useThumbnail'
import { HighlightContext } from '../contexts/HighlightContext'

// Helper to check if a path is a URL
const isUrl = (path: string): boolean => {
  return path.startsWith('http://') || path.startsWith('https://')
}

// Type configuration with icons and labels
const TYPE_CONFIG: Record<DataType, { icon: ReactNode; label: string }> = {
  image: { icon: <Image className="w-4 h-4" />, label: 'Image' },
  video: { icon: <Video className="w-4 h-4" />, label: 'Video' },
  csv: { icon: <Table2 className="w-4 h-4" />, label: 'CSV' },
  json: { icon: <Braces className="w-4 h-4" />, label: 'JSON' },
  txt: { icon: <FileText className="w-4 h-4" />, label: 'Text' },
  image_directory: { icon: <FolderOpen className="w-4 h-4" />, label: 'Img Dir' },
  data_folder: { icon: <Folder className="w-4 h-4" />, label: 'Folder' },
}

function DataNode({ data, id, selected }: NodeProps<DataNodeType>) {
  const { neighborNodeIds } = useContext(HighlightContext)
  const isNeighbor = neighborNodeIds.has(id)

  // Get type configuration
  const config = TYPE_CONFIG[data.type] || TYPE_CONFIG.data_folder

  // Fetch thumbnail/preview for existing data
  const thumbnail = useThumbnail(data.key, data.type, data.exists, data.path)

  // Determine colors based on existence status - support both light and dark modes
  const getColors = () => {
    if (data.exists === true) {
      // Data exists - teal theme
      return {
        bg: 'bg-teal-100 dark:bg-teal-900/80',
        border: selected ? 'border-teal-400' : 'border-teal-400 dark:border-teal-600',
        handle: '!bg-teal-400',
        dollar: 'text-teal-600 dark:text-teal-300',
        value: 'text-teal-600 dark:text-teal-400',
        badge: 'bg-teal-200 dark:bg-teal-800 text-teal-700 dark:text-teal-300',
        shadow: 'shadow-teal-500/20',
      }
    } else if (data.exists === false) {
      // Data doesn't exist - grey/muted theme
      return {
        bg: 'bg-slate-200 dark:bg-slate-800',
        border: selected ? 'border-slate-400' : 'border-slate-400 dark:border-slate-600',
        handle: '!bg-slate-400',
        dollar: 'text-slate-500 dark:text-slate-400',
        value: 'text-slate-400 dark:text-slate-500',
        badge: 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
        shadow: '',
      }
    } else {
      // Unknown status - default teal
      return {
        bg: 'bg-teal-50 dark:bg-teal-900',
        border: selected ? 'border-teal-400' : 'border-teal-400 dark:border-teal-700',
        handle: '!bg-teal-400',
        dollar: 'text-teal-600 dark:text-teal-300',
        value: 'text-teal-500 dark:text-teal-400',
        badge: 'bg-teal-200 dark:bg-teal-800 text-teal-700 dark:text-teal-300',
        shadow: '',
      }
    }
  }

  const colors = getColors()

  return (
    <div
      className={`
        ${colors.bg} rounded-lg shadow-lg min-w-[160px] border-2 transition-all duration-300
        ${colors.border} ${colors.shadow}
        ${data.pulseError ? 'animate-pulse-error' : ''}
        ${selected ? 'shadow-lg shadow-blue-400/50' : ''}
        ${isNeighbor ? 'ring-1 ring-teal-400/50 shadow-teal-400/25' : ''}
      `}
    >
      {/* Input handle for receiving data from step outputs */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className={colors.handle}
      />
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm flex-shrink-0">{config.icon}</span>
          <span className="text-slate-900 dark:text-white font-medium text-sm truncate">{data.name}</span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="value"
          className={colors.handle}
        />
      </div>
      {/* Thumbnail/Preview section */}
      {data.exists && (thumbnail.thumbnailUrl || thumbnail.textPreview || thumbnail.loading) && (
        <div className="px-3 pb-2">
          {thumbnail.loading && (
            <div className="bg-slate-300/50 dark:bg-slate-700/50 rounded h-[60px] animate-pulse" />
          )}
          {thumbnail.thumbnailUrl && (
            <img
              src={thumbnail.thumbnailUrl}
              alt={`Preview of ${data.name}`}
              className="rounded max-w-full h-auto max-h-[80px] object-contain"
            />
          )}
          {thumbnail.textPreview && (
            <div className="bg-slate-200/80 dark:bg-slate-800/80 rounded p-1.5 font-mono text-[9px] leading-tight text-slate-600 dark:text-slate-300 overflow-hidden">
              {thumbnail.textPreview.lines.map((line, i) => (
                <div key={i} className="truncate">{line || '\u00A0'}</div>
              ))}
              {thumbnail.textPreview.truncated && (
                <div className="text-slate-400 dark:text-slate-500">...</div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="px-3 pb-1 flex items-center gap-2">
        <span className={`${colors.dollar} text-xs font-mono`}>${data.key}</span>
        <span className={`${colors.badge} text-[10px] px-1.5 py-0.5 rounded`}>
          {config.label}
        </span>
        {data.exists === true && (
          <span className="text-teal-500 dark:text-teal-400 text-xs">&#10003;</span>
        )}
        {data.exists === false && (
          <span className="text-slate-400 dark:text-slate-500 text-xs">&#9675;</span>
        )}
      </div>
      <div className={`px-3 pb-2 text-xs ${colors.value} truncate max-w-[180px] flex items-center gap-1`} title={data.path}>
        {data.path && isUrl(data.path) && (
          <Link className="w-3 h-3 flex-shrink-0" />
        )}
        <span className="truncate">{data.path || '(no path)'}</span>
      </div>
    </div>
  )
}

export default memo(DataNode)
