import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Video, Image, Table2, Braces, FolderOpen, Folder } from 'lucide-react'
import type { DataNode as DataNodeType, DataType } from '../types/pipeline'

// Type configuration with icons and labels
const TYPE_CONFIG: Record<DataType, { icon: ReactNode; label: string }> = {
  image: { icon: <Image className="w-4 h-4" />, label: 'Image' },
  video: { icon: <Video className="w-4 h-4" />, label: 'Video' },
  csv: { icon: <Table2 className="w-4 h-4" />, label: 'CSV' },
  json: { icon: <Braces className="w-4 h-4" />, label: 'JSON' },
  image_directory: { icon: <FolderOpen className="w-4 h-4" />, label: 'Img Dir' },
  data_folder: { icon: <Folder className="w-4 h-4" />, label: 'Folder' },
}

function DataNode({ data, selected }: NodeProps<DataNodeType>) {
  // Get type configuration
  const config = TYPE_CONFIG[data.type] || TYPE_CONFIG.data_folder

  // Determine colors based on existence status
  const getColors = () => {
    if (data.exists === true) {
      // Data exists - teal theme
      return {
        bg: 'bg-teal-900/80',
        border: selected ? 'border-teal-400' : 'border-teal-600',
        handle: '!bg-teal-400',
        dollar: 'text-teal-300',
        value: 'text-teal-400',
        badge: 'bg-teal-800 text-teal-300',
        shadow: 'shadow-teal-500/20',
      }
    } else if (data.exists === false) {
      // Data doesn't exist - grey/muted theme
      return {
        bg: 'bg-slate-800',
        border: selected ? 'border-slate-400' : 'border-slate-600',
        handle: '!bg-slate-400',
        dollar: 'text-slate-400',
        value: 'text-slate-500',
        badge: 'bg-slate-700 text-slate-400',
        shadow: '',
      }
    } else {
      // Unknown status - default teal
      return {
        bg: 'bg-teal-900',
        border: selected ? 'border-teal-400' : 'border-teal-700',
        handle: '!bg-teal-400',
        dollar: 'text-teal-300',
        value: 'text-teal-400',
        badge: 'bg-teal-800 text-teal-300',
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
          <span className="text-white font-medium text-sm truncate">{data.name}</span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="value"
          className={colors.handle}
        />
      </div>
      <div className="px-3 pb-1 flex items-center gap-2">
        <span className={`${colors.dollar} text-xs font-mono`}>${data.key}</span>
        <span className={`${colors.badge} text-[10px] px-1.5 py-0.5 rounded`}>
          {config.label}
        </span>
        {data.exists === true && (
          <span className="text-teal-400 text-xs">&#10003;</span>
        )}
        {data.exists === false && (
          <span className="text-slate-500 text-xs">&#9675;</span>
        )}
      </div>
      <div className={`px-3 pb-2 text-xs ${colors.value} truncate max-w-[180px]`} title={data.path}>
        {data.path || '(no path)'}
      </div>
    </div>
  )
}

export default memo(DataNode)
