import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Video, Image, Table2, Braces, FolderOpen, Folder } from 'lucide-react'
import type { StepNode as StepNodeType, DataType } from '../types/pipeline'

// Color configuration for data types
const TYPE_COLORS: Record<DataType, { bg: string; border: string; text: string }> = {
  video: { bg: '!bg-rose-400', border: '!border-rose-400', text: 'text-rose-400' },
  image: { bg: '!bg-amber-400', border: '!border-amber-400', text: 'text-amber-400' },
  csv: { bg: '!bg-emerald-400', border: '!border-emerald-400', text: 'text-emerald-400' },
  json: { bg: '!bg-sky-400', border: '!border-sky-400', text: 'text-sky-400' },
  image_directory: { bg: '!bg-orange-400', border: '!border-orange-400', text: 'text-orange-400' },
  data_folder: { bg: '!bg-teal-400', border: '!border-teal-400', text: 'text-teal-400' },
}

// Default color for untyped inputs/outputs
const DEFAULT_INPUT_COLOR = { bg: '!bg-blue-400', border: '!border-blue-400', text: 'text-blue-400' }
const DEFAULT_OUTPUT_COLOR = { bg: '!bg-green-400', border: '!border-green-400', text: 'text-green-400' }

// Type icons using Lucide icons
const TYPE_ICONS: Record<DataType, ReactNode> = {
  video: <Video className="w-3 h-3" />,
  image: <Image className="w-3 h-3" />,
  csv: <Table2 className="w-3 h-3" />,
  json: <Braces className="w-3 h-3" />,
  image_directory: <FolderOpen className="w-3 h-3" />,
  data_folder: <Folder className="w-3 h-3" />,
}

function StepNode({ data, selected }: NodeProps<StepNodeType>) {
  const inputNames = Object.keys(data.inputs || {})
  const outputNames = Object.keys(data.outputs || {})

  // Get color for input based on type
  const getInputColor = (name: string) => {
    const type = data.inputTypes?.[name]
    return type ? TYPE_COLORS[type] : DEFAULT_INPUT_COLOR
  }

  // Get color for output based on type
  const getOutputColor = (flag: string) => {
    const type = data.outputTypes?.[flag]
    return type ? TYPE_COLORS[type] : DEFAULT_OUTPUT_COLOR
  }

  // All args - each gets a handle
  const allArgEntries = Object.entries(data.args || {})

  // Check if an arg is connected to a parameter (has $param value)
  const isArgConnected = (value: unknown): boolean =>
    typeof value === 'string' && value.startsWith('$')

  // Determine border styling based on execution state
  const getBorderClass = () => {
    if (data.executionState === 'running') {
      return 'border-cyan-400 animate-pulse shadow-cyan-400/50 shadow-lg'
    }
    if (data.executionState === 'completed') {
      return 'border-green-500 shadow-green-500/30 shadow-md'
    }
    if (data.executionState === 'failed') {
      return 'border-red-500 shadow-red-500/30 shadow-md'
    }
    if (selected) {
      return 'border-blue-500'
    }
    return 'border-slate-600'
  }

  // Determine status indicator color
  const getStatusIndicator = () => {
    if (data.executionState === 'running') {
      return 'bg-cyan-400 animate-ping'
    }
    if (data.executionState === 'completed') {
      return 'bg-green-500'
    }
    if (data.executionState === 'failed') {
      return 'bg-red-500'
    }
    // Show freshness when idle
    if (!data.executionState || data.executionState === 'idle') {
      if (data.freshnessStatus === 'fresh') {
        return 'bg-green-500'
      }
      if (data.freshnessStatus === 'stale') {
        return 'bg-amber-500'
      }
      if (data.freshnessStatus === 'missing') {
        return 'bg-slate-400'
      }
    }
    if (data.optional) {
      return 'bg-yellow-500'
    }
    return 'bg-slate-500'
  }

  // Get freshness badge for header
  const getFreshnessBadge = () => {
    if (data.executionState && data.executionState !== 'idle') {
      return null // Don't show freshness badge during execution
    }
    switch (data.freshnessStatus) {
      case 'fresh':
        return { text: '✓', className: 'text-green-400', title: 'Up to date' }
      case 'stale':
        return { text: '↻', className: 'text-amber-400', title: 'Needs re-run' }
      case 'missing':
        return { text: '○', className: 'text-slate-400', title: 'Not computed' }
      default:
        return null
    }
  }

  const freshnessBadge = getFreshnessBadge()

  return (
    <div
      className={`
        bg-slate-800 rounded-lg shadow-lg min-w-[200px] border-2 transition-all duration-300
        ${getBorderClass()}
        ${data.optional ? 'border-dashed' : ''}
      `}
    >
      {/* Header */}
      <div className={`px-3 py-2 rounded-t-md flex items-center gap-2 transition-colors duration-300 ${
        data.executionState === 'running' ? 'bg-cyan-900/50' :
        data.executionState === 'completed' ? 'bg-green-900/30' :
        data.executionState === 'failed' ? 'bg-red-900/30' :
        'bg-slate-700'
      }`}>
        <div className="relative">
          <div className={`w-2 h-2 rounded-full ${getStatusIndicator()}`} />
          {data.executionState === 'running' && (
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-cyan-400" />
          )}
        </div>
        <span className="text-white font-medium text-sm">{data.name}</span>
        {data.executionState === 'completed' && (
          <span className="ml-auto text-green-400 text-xs">&#10003;</span>
        )}
        {data.executionState === 'failed' && (
          <span className="ml-auto text-red-400 text-xs">&#10007;</span>
        )}
        {freshnessBadge && (
          <span className={`ml-auto text-xs ${freshnessBadge.className}`} title={freshnessBadge.title}>
            {freshnessBadge.text}
          </span>
        )}
      </div>

      {/* Inputs/Outputs */}
      <div className="px-3 py-2 text-xs">
        {/* Input handles (file inputs) */}
        {inputNames.map((name) => {
          const inputType = data.inputTypes?.[name]
          const colors = getInputColor(name)
          return (
            <div key={`input-${name}`} className="flex items-center py-1 relative">
              <Handle
                type="target"
                position={Position.Left}
                id={name}
                className={colors.bg}
                style={{ top: 'auto', position: 'relative', transform: 'none' }}
              />
              <span className={`ml-2 flex items-center gap-1 ${inputType ? colors.text : 'text-slate-400'}`}>
                {inputType && <span className="flex-shrink-0">{TYPE_ICONS[inputType]}</span>}
                {name}
              </span>
            </div>
          )
        })}

        {/* Arg handles - all args get handles, connected ones are purple solid, unconnected are purple outline */}
        {allArgEntries.map(([argKey, argValue]) => {
          const connected = isArgConnected(argValue)
          return (
            <div key={`arg-${argKey}`} className="flex items-center py-1 relative">
              <Handle
                type="target"
                position={Position.Left}
                id={argKey}
                className={connected ? '!bg-purple-400' : '!bg-transparent !border-2 !border-purple-400'}
                style={{ top: 'auto', position: 'relative', transform: 'none' }}
              />
              <span className={`ml-2 ${connected ? 'text-purple-400' : 'text-purple-400/60'}`}>
                {argKey.replace(/^-+/, '')}
                {!connected && argValue !== undefined && argValue !== '' && (
                  <span className="text-slate-500 ml-1 text-[10px]">= {String(argValue)}</span>
                )}
              </span>
            </div>
          )
        })}

        {/* Output handles */}
        {outputNames.map((flag) => {
          const outputType = data.outputTypes?.[flag]
          const colors = getOutputColor(flag)
          return (
            <div key={`output-${flag}`} className="flex items-center justify-end py-1 relative">
              <span className={`mr-2 flex items-center gap-1 ${outputType ? colors.text : 'text-slate-400'}`}>
                {flag.replace(/^-+/, '')}
                {outputType && <span className="flex-shrink-0">{TYPE_ICONS[outputType]}</span>}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={flag}
                className={colors.bg}
                style={{ top: 'auto', position: 'relative', transform: 'none' }}
              />
            </div>
          )
        })}
      </div>

    </div>
  )
}

export default memo(StepNode)
