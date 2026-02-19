import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ParameterNode as ParameterNodeType } from '../types/pipeline'
import { HighlightContext } from '../contexts/HighlightContext'

function ParameterNode({ data, id, selected }: NodeProps<ParameterNodeType>) {
  const { neighborNodeIds } = useContext(HighlightContext)
  const isNeighbor = neighborNodeIds.has(id)
  // Format value for display
  const displayValue = () => {
    if (typeof data.value === 'boolean') {
      return data.value ? 'true' : 'false'
    }
    return String(data.value)
  }

  // Determine type badge
  const typeBadge = () => {
    if (typeof data.value === 'boolean') return 'bool'
    if (typeof data.value === 'number') return 'num'
    return 'str'
  }

  return (
    <div
      className={`
        bg-purple-100 dark:bg-purple-900/80 rounded-lg shadow-lg min-w-[120px] border-2 transition-all duration-300
        ${selected ? 'border-purple-400 shadow-lg shadow-purple-500/60' : 'border-purple-400 dark:border-purple-700'}
        ${isNeighbor ? 'ring-1 ring-teal-400/50 shadow-teal-400/25' : ''}
      `}
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-purple-600 dark:text-purple-300 text-xs">$</span>
          <span className="text-slate-900 dark:text-white font-medium text-sm">{data.name}</span>
          <span className="text-purple-600 dark:text-purple-400 text-[10px] bg-purple-200 dark:bg-purple-800 px-1 rounded">
            {typeBadge()}
          </span>
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="value"
          className="!bg-purple-400"
        />
      </div>
      <div className="px-3 pb-2 text-xs text-purple-600 dark:text-purple-300 truncate max-w-[150px]" title={displayValue()}>
        {displayValue()}
      </div>
    </div>
  )
}

export default memo(ParameterNode)
