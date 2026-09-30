import { memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import type { ConditionNode as ConditionNodeType } from '../types/pipeline'
import { HighlightContext } from '../contexts/HighlightContext'

/**
 * Condition node: evaluates data (or a parameter) to a boolean.
 * Inputs on the left, a single boolean `result` output on the right.
 */
function ConditionNode({ data, id, selected }: NodeProps<ConditionNodeType>) {
  const { neighborNodeIds } = useContext(HighlightContext)
  const isNeighbor = neighborNodeIds.has(id)
  const inputNames = Object.keys(data.inputs || {})
  const label = data.predicate || data.script || '(unset)'
  const isDisabled = data.disabled === true

  const borderClass =
    data.executionState === 'completed'
      ? 'border-green-500'
      : data.executionState === 'failed'
        ? 'border-red-500'
        : data.executionState === 'running'
          ? 'border-cyan-400 animate-pulse'
          : selected
            ? 'border-indigo-500 shadow-lg shadow-indigo-500/40'
            : isNeighbor
              ? 'border-indigo-400/60'
              : 'border-indigo-400 dark:border-indigo-700'

  return (
    <div
      className={`bg-indigo-50 dark:bg-indigo-950/60 rounded-lg shadow-lg min-w-[180px] border-2 transition-all duration-300 ${borderClass} ${
        data.optional ? 'border-dashed' : ''
      } ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        <GitBranch className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
        <span className="text-slate-900 dark:text-white font-medium text-sm">{data.name}</span>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300">
          condition
        </span>
      </div>

      <div className="px-3 pb-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-300">
        if {label}
        {data.negate ? ' (negated)' : ''}
        {typeof data.result === 'boolean' && (
          <span className={data.result ? 'text-green-500' : 'text-amber-500'}>
            {' '}
            → {String(data.result)}
          </span>
        )}
      </div>

      <div className="px-3 py-2 text-xs">
        {inputNames.map((name) => (
          <div key={`input-${name}`} className="flex items-center py-1 relative">
            <Handle
              type="target"
              position={Position.Left}
              id={name}
              className="!bg-teal-400"
              style={{ top: 'auto', position: 'relative', transform: 'none' }}
            />
            <span className="ml-2 text-slate-500 dark:text-slate-400">{name}</span>
          </div>
        ))}

        {Object.entries(data.args || {}).map(([argKey, argValue]) => {
          const connected = typeof argValue === 'string' && argValue.startsWith('$')
          return (
            <div key={`arg-${argKey}`} className="flex items-center py-1 relative">
              <Handle
                type="target"
                position={Position.Left}
                id={argKey}
                className={
                  connected ? '!bg-purple-400' : '!bg-transparent !border-2 !border-purple-400'
                }
                style={{ top: 'auto', position: 'relative', transform: 'none' }}
              />
              <span
                className={`ml-2 ${connected ? 'text-purple-500 dark:text-purple-400' : 'text-purple-400/60'}`}
              >
                {argKey}
                {!connected && argValue !== undefined && argValue !== '' && (
                  <span className="text-slate-400 dark:text-slate-500 ml-1 text-[10px]">
                    = {String(argValue)}
                  </span>
                )}
              </span>
            </div>
          )
        })}

        <div className="flex items-center justify-end py-1 relative">
          <span className="mr-2 text-indigo-500 dark:text-indigo-400">bool</span>
          <Handle
            type="source"
            position={Position.Right}
            id="result"
            className="!bg-indigo-400"
            style={{ top: 'auto', position: 'relative', transform: 'none' }}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(ConditionNode)
