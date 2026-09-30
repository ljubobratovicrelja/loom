import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Split } from 'lucide-react'
import type { SwitchNode as SwitchNodeType } from '../types/pipeline'
import { HighlightContext } from '../contexts/HighlightContext'

/**
 * Switch node: routes a data payload by a boolean condition.
 * Targets: `condition` (bool) and `data` (payload). Sources: `then` / `else`.
 */
function SwitchNode({ data, id, selected }: NodeProps<SwitchNodeType>) {
  const { neighborNodeIds } = useContext(HighlightContext)
  const isNeighbor = neighborNodeIds.has(id)
  const isDisabled = data.disabled === true

  const borderClass = selected
    ? 'border-indigo-500 shadow-lg shadow-indigo-500/40'
    : isNeighbor
      ? 'border-indigo-400/60'
      : 'border-indigo-400 dark:border-indigo-700'

  return (
    <div
      className={`bg-indigo-50 dark:bg-indigo-950/60 rounded-lg shadow-lg min-w-[170px] border-2 transition-all duration-300 ${borderClass} ${
        data.optional ? 'border-dashed' : ''
      } ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        <Split className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
        <span className="text-slate-900 dark:text-white font-medium text-sm">{data.name}</span>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300">
          switch
        </span>
      </div>

      <div className="px-3 py-2 text-xs">
        <div className="flex items-center py-1 relative">
          <Handle
            type="target"
            position={Position.Left}
            id="condition"
            className="!bg-indigo-400"
            style={{ top: 'auto', position: 'relative', transform: 'none' }}
          />
          <span className="ml-2 text-indigo-500 dark:text-indigo-400">if (bool)</span>
        </div>
        <div className="flex items-center py-1 relative">
          <Handle
            type="target"
            position={Position.Left}
            id="data"
            className="!bg-teal-400"
            style={{ top: 'auto', position: 'relative', transform: 'none' }}
          />
          <span className="ml-2 text-slate-500 dark:text-slate-400">data</span>
        </div>

        <div className="mt-1 border-t border-indigo-200 dark:border-indigo-800 pt-1">
          <div className="flex items-center justify-end py-1 relative">
            <span
              className={`mr-2 ${data.taken === 'then' ? 'text-green-500 font-semibold' : 'text-indigo-500 dark:text-indigo-400'}`}
            >
              then
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="then"
              className="!bg-green-400"
              style={{ top: 'auto', position: 'relative', transform: 'none' }}
            />
          </div>
          <div className="flex items-center justify-end py-1 relative">
            <span
              className={`mr-2 ${data.taken === 'else' ? 'text-amber-500 font-semibold' : 'text-indigo-500 dark:text-indigo-400'}`}
            >
              else
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id="else"
              className="!bg-amber-400"
              style={{ top: 'auto', position: 'relative', transform: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(SwitchNode)
