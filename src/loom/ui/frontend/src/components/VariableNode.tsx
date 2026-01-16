import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { VariableNode as VariableNodeType } from '../types/pipeline'

function VariableNode({ data, selected }: NodeProps<VariableNodeType>) {
  // Determine colors based on existence status
  const getColors = () => {
    if (data.exists === true) {
      // Data exists - green theme
      return {
        bg: 'bg-green-900/80',
        border: selected ? 'border-green-400' : 'border-green-600',
        handle: '!bg-green-400',
        dollar: 'text-green-300',
        value: 'text-green-400',
        shadow: 'shadow-green-500/20',
      }
    } else if (data.exists === false) {
      // Data doesn't exist - grey/muted theme
      return {
        bg: 'bg-slate-800',
        border: selected ? 'border-slate-400' : 'border-slate-600',
        handle: '!bg-slate-400',
        dollar: 'text-slate-400',
        value: 'text-slate-500',
        shadow: '',
      }
    } else {
      // Unknown status - default indigo
      return {
        bg: 'bg-indigo-900',
        border: selected ? 'border-indigo-400' : 'border-indigo-700',
        handle: '!bg-indigo-400',
        dollar: 'text-indigo-300',
        value: 'text-indigo-400',
        shadow: '',
      }
    }
  }

  const colors = getColors()

  return (
    <div
      className={`
        ${colors.bg} rounded-lg shadow-lg min-w-[150px] border-2 transition-all duration-300
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
        <div className="flex items-center gap-2">
          <span className={`${colors.dollar} text-xs`}>$</span>
          <span className="text-white font-medium text-sm">{data.name}</span>
          {data.exists === true && (
            <span className="text-green-400 text-xs">&#10003;</span>
          )}
          {data.exists === false && (
            <span className="text-slate-500 text-xs">&#9675;</span>
          )}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="value"
          className={colors.handle}
        />
      </div>
      <div className={`px-3 pb-2 text-xs ${colors.value} truncate max-w-[180px]`} title={data.value}>
        {data.value}
      </div>
    </div>
  )
}

export default memo(VariableNode)
