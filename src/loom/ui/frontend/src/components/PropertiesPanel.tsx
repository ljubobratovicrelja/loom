import { useState, useEffect, useMemo, type ReactNode } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { Video, Image, Table2, Braces, FolderOpen, Folder, FileQuestion } from 'lucide-react'
import type { StepData, VariableData, ParameterData, DataNodeData, DataType, TaskInfo, StepExecutionState } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'
import { getBlockReasonMessage } from '../hooks/useRunEligibility'
import type { FreshnessInfo } from '../hooks/useFreshness'
import { getFreshnessLabel, getFreshnessColorClasses } from '../hooks/useFreshness'

// Icon component lookup for data types
const TYPE_ICON_COMPONENTS: Record<DataType, ReactNode> = {
  video: <Video className="w-3 h-3" />,
  image: <Image className="w-3 h-3" />,
  csv: <Table2 className="w-3 h-3" />,
  json: <Braces className="w-3 h-3" />,
  image_directory: <FolderOpen className="w-3 h-3" />,
  data_folder: <Folder className="w-3 h-3" />,
}

// Data type options for selector
const DATA_TYPE_OPTIONS: Array<{ type: DataType; label: string }> = [
  { type: 'image', label: 'Image' },
  { type: 'video', label: 'Video' },
  { type: 'csv', label: 'CSV' },
  { type: 'json', label: 'JSON' },
  { type: 'image_directory', label: 'Image Directory' },
  { type: 'data_folder', label: 'Data Folder' },
]

// Type colors for badges (matching StepNode colors)
const TYPE_COLORS: Record<DataType, string> = {
  video: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-600',
  image: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-600',
  csv: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600',
  json: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-600',
  image_directory: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600',
  data_folder: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-600',
}

// Get type info (icon, label, color) for a data type
const getTypeInfo = (type: DataType) => {
  const option = DATA_TYPE_OPTIONS.find(opt => opt.type === type)
  return {
    icon: TYPE_ICON_COMPONENTS[type] || <FileQuestion className="w-3 h-3" />,
    label: option?.label || type,
    colors: TYPE_COLORS[type] || 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600',
  }
}

// Helper to check if a data type is a directory type
const isDirectoryType = (type: DataType): boolean => {
  return type === 'image_directory' || type === 'data_folder'
}

interface PropertiesPanelProps {
  selectedNode: Node | null
  edges: Edge[]
  onUpdateNode: (id: string, data: Partial<StepData | VariableData | ParameterData | DataNodeData>) => void
  onDeleteNode: (id: string) => void
  onUpdateParameter?: (name: string, value: unknown) => void
  onDisconnectArg?: (stepId: string, argKey: string) => void
  onTrashData?: (variableName: string) => Promise<void>
  onRunStep?: (stepName: string) => void
  onCancelStep?: (stepName: string) => void
  getStepStatus?: (stepName: string) => StepExecutionState
  parameters: Record<string, unknown>
  tasks: TaskInfo[]
  runEligibility?: RunEligibility
  freshness?: FreshnessInfo
}

export default function PropertiesPanel({
  selectedNode,
  edges,
  onUpdateNode,
  onDeleteNode,
  onUpdateParameter,
  onDisconnectArg,
  onTrashData,
  onRunStep,
  onCancelStep,
  getStepStatus,
  parameters,
  tasks,
  runEligibility,
  freshness,
}: PropertiesPanelProps) {
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [showRefs, setShowRefs] = useState(true)

  // Find the task schema for the currently selected step
  const taskSchema = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'step') return null
    const stepData = selectedNode.data as StepData
    return tasks.find((t) => t.path === stepData.task) || null
  }, [selectedNode, tasks])

  // Get the step name and status for execution controls
  const stepName = selectedNode?.type === 'step' ? (selectedNode.data as StepData).name : null
  const stepStatus = stepName && getStepStatus ? getStepStatus(stepName) : 'idle'

  useEffect(() => {
    if (selectedNode) {
      setEditData({ ...selectedNode.data })
    } else {
      setEditData({})
    }
  }, [selectedNode])

  // Pre-filter edges to only those targeting this step from parameter nodes
  // This creates a stable reference that only changes when relevant edges change
  const paramEdgesToStep = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'step' || !edges || !Array.isArray(edges)) {
      return []
    }
    return edges.filter(
      (e) =>
        e &&
        e.target === selectedNode.id &&
        e.source?.startsWith('param_') &&
        e.targetHandle
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using specific properties to avoid unnecessary recomputes
  }, [selectedNode?.id, selectedNode?.type, edges])

  // Find which args are connected to parameter nodes via edges
  // IMPORTANT: This useMemo must be before the early return to respect Rules of Hooks
  const connectedArgs = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'step') {
      return new Map<string, string>()
    }

    const stepData = selectedNode.data as StepData
    const args = stepData.args || {}
    const connections = new Map<string, string>()

    for (const edge of paramEdgesToStep) {
      // Get the parameter name from the arg value (stored as $paramName)
      // This is more reliable than parsing the node ID
      const argValue = args[edge.targetHandle!]
      if (typeof argValue === 'string' && argValue.startsWith('$')) {
        const paramName = argValue.slice(1) // Remove the $ prefix
        connections.set(edge.targetHandle!, paramName)
      }
    }
    return connections
  }, [selectedNode, paramEdgesToStep])

  if (!selectedNode) {
    return (
      <div className="flex-1 bg-slate-100 dark:bg-slate-900 border-l border-slate-300 dark:border-slate-700 p-4">
        <p className="text-slate-400 dark:text-slate-500 text-sm">Select a node to edit its properties</p>
      </div>
    )
  }

  const isVariable = selectedNode.type === 'variable'
  const isStep = selectedNode.type === 'step'
  const isParameter = selectedNode.type === 'parameter'
  const isData = selectedNode.type === 'data'

  const handleChange = (key: string, value: unknown) => {
    const newData = { ...editData, [key]: value }
    setEditData(newData)
    onUpdateNode(selectedNode.id, { [key]: value } as Partial<StepData | VariableData>)
  }

  const handleArgChange = (argKey: string, value: string) => {
    const args = { ...(editData.args as Record<string, unknown> || {}) }
    // Parse value
    if (value === 'true') args[argKey] = true
    else if (value === 'false') args[argKey] = false
    else if (!isNaN(Number(value)) && value !== '') args[argKey] = Number(value)
    else args[argKey] = value

    handleChange('args', args)
  }

  const handleInputChange = (inputKey: string, value: string) => {
    const inputs = { ...(editData.inputs as Record<string, string> || {}) }
    inputs[inputKey] = value
    handleChange('inputs', inputs)
  }

  const handleAddArg = (argKey: string) => {
    const args = { ...(editData.args as Record<string, unknown> || {}) }
    const schema = taskSchema?.args?.[argKey]
    // For bool flags, set to true; otherwise use default or empty string
    // Treat null as "no default" since backend sends null for optional args
    if (schema?.type === 'bool') {
      args[argKey] = true
    } else {
      const hasDefault = schema?.default !== undefined && schema?.default !== null
      args[argKey] = hasDefault ? schema.default : ''
    }
    handleChange('args', args)
  }

  const handleRemoveArg = (argKey: string) => {
    const args = { ...(editData.args as Record<string, unknown> || {}) }
    delete args[argKey]
    handleChange('args', args)
  }

  // Get available args that aren't currently in the step
  const availableArgs = taskSchema?.args
    ? Object.entries(taskSchema.args).filter(
        ([key]) => !Object.prototype.hasOwnProperty.call(editData.args || {}, key)
      )
    : []

  // Handler for disconnecting an arg
  const handleDisconnectArg = (argKey: string) => {
    if (!selectedNode || !onDisconnectArg) return
    // Update local editData to clear the arg value immediately
    const newArgs = { ...(editData.args as Record<string, unknown> || {}) }
    newArgs[argKey] = ''
    setEditData({ ...editData, args: newArgs })
    // Notify parent to remove the edge and update node
    onDisconnectArg(selectedNode.id, argKey)
  }

  return (
    <div className="flex-1 bg-slate-100 dark:bg-slate-900 border-l border-slate-300 dark:border-slate-700 flex flex-col">
      <div className="p-4 border-b border-slate-300 dark:border-slate-700 flex justify-between items-center">
        <h2 className="text-slate-900 dark:text-white font-semibold text-sm">Properties</h2>
        <button
          onClick={() => onDeleteNode(selectedNode.id)}
          className="px-2 py-1 bg-red-600 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs rounded"
        >
          Delete
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Variable properties */}
        {isVariable && (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Name</label>
              <input
                type="text"
                value={(editData.name as string) || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Value</label>
              <input
                type="text"
                value={(editData.value as string) || ''}
                onChange={(e) => handleChange('value', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
              />
            </div>
            {/* Trash data button */}
            {onTrashData && (editData.exists as boolean) && (
              <div className="pt-2">
                <button
                  onClick={() => {
                    const name = (editData.name as string) || ''
                    if (window.confirm(`Move "${name}" data to trash?\n\nThis will move the file/folder to your system trash.`)) {
                      onTrashData(name)
                    }
                  }}
                  className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-500 dark:bg-orange-700 dark:hover:bg-orange-600 text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                >
                  <span>&#128465;</span> Move Data to Trash
                </button>
                <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                  Moves the file/folder to system trash
                </p>
              </div>
            )}
          </>
        )}

        {/* Parameter properties */}
        {isParameter && (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Name</label>
              <div className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-purple-600 dark:text-purple-300 text-sm">
                ${(editData.name as string) || ''}
              </div>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Value</label>
              <input
                type="text"
                value={String(editData.value ?? '')}
                onChange={(e) => {
                  const newValue = e.target.value
                  // Parse value type
                  let parsedValue: unknown = newValue
                  if (newValue === 'true') parsedValue = true
                  else if (newValue === 'false') parsedValue = false
                  else if (!isNaN(Number(newValue)) && newValue.trim() !== '') {
                    parsedValue = Number(newValue)
                  }
                  handleChange('value', parsedValue)
                  // Also update the global parameter
                  if (onUpdateParameter && editData.name) {
                    onUpdateParameter(editData.name as string, parsedValue)
                  }
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-purple-500"
              />
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500">
              <p>This parameter is shared across the pipeline.</p>
              <p>Editing here updates all references.</p>
            </div>
          </>
        )}

        {/* Data node properties */}
        {isData && (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Display Name</label>
              <input
                type="text"
                value={(editData.name as string) || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Human readable name"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Key (for $references)</label>
              <div className="flex items-center gap-1">
                <span className="text-teal-500 dark:text-teal-400 text-sm">$</span>
                <input
                  type="text"
                  value={(editData.key as string) || ''}
                  onChange={(e) => handleChange('key', e.target.value)}
                  placeholder="variable_name"
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm font-mono focus:border-teal-500"
                />
              </div>
              <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                Use this key in pipeline as ${(editData.key as string) || 'key'}
              </p>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Type</label>
              <select
                value={(editData.type as DataType) || 'data_folder'}
                onChange={(e) => handleChange('type', e.target.value as DataType)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
              >
                {DATA_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.type} value={opt.type}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Path</label>
              <input
                type="text"
                value={(editData.path as string) || ''}
                onChange={(e) => handleChange('path', e.target.value)}
                placeholder="data/path/to/file.ext"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Description (optional)</label>
              <input
                type="text"
                value={(editData.description as string) || ''}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="What this data represents"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
              />
            </div>
            {/* Pattern field for directory types */}
            {isDirectoryType((editData.type as DataType) || 'data_folder') && (
              <div>
                <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Pattern (optional)</label>
                <input
                  type="text"
                  value={(editData.pattern as string) || ''}
                  onChange={(e) => handleChange('pattern', e.target.value)}
                  placeholder="*.png"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
                />
                <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                  Glob pattern to filter files in the directory
                </p>
              </div>
            )}
            {/* Existence indicator */}
            {editData.exists !== undefined && (
              <div className="flex items-center gap-2 text-xs">
                {editData.exists ? (
                  <span className="text-teal-500 dark:text-teal-400">&#10003; Path exists</span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">&#9675; Path not found</span>
                )}
              </div>
            )}
            {/* Trash data button */}
            {onTrashData && (editData.exists as boolean) && (
              <div className="pt-2">
                <button
                  onClick={() => {
                    const displayName = (editData.name as string) || ''
                    const key = (editData.key as string) || displayName
                    if (window.confirm(`Move "${displayName}" data to trash?\n\nThis will move the file/folder to your system trash.`)) {
                      onTrashData(key)
                    }
                  }}
                  className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-500 dark:bg-orange-700 dark:hover:bg-orange-600 text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                >
                  <span>&#128465;</span> Move Data to Trash
                </button>
                <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                  Moves the file/folder to system trash
                </p>
              </div>
            )}
          </>
        )}

        {/* Step properties */}
        {isStep && (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Name</label>
              <input
                type="text"
                value={(editData.name as string) || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Task</label>
              <input
                type="text"
                value={(editData.task as string) || ''}
                onChange={(e) => handleChange('task', e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                <input
                  type="checkbox"
                  checked={(editData.optional as boolean) || false}
                  onChange={(e) => handleChange('optional', e.target.checked)}
                  className="rounded"
                />
                Optional step
              </label>
            </div>

            <div>
              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                <input
                  type="checkbox"
                  checked={(editData.disabled as boolean) || false}
                  onChange={(e) => handleChange('disabled', e.target.checked)}
                  className="rounded"
                />
                Disabled (skip during execution)
              </label>
            </div>

            {/* Inputs */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">Inputs</label>
              {Object.entries((editData.inputs as Record<string, string>) || {}).map(([key, value]) => {
                const inputType = (editData.inputTypes as Record<string, DataType>)?.[key]
                const typeInfo = inputType ? getTypeInfo(inputType) : null
                return (
                  <div key={key} className="mb-3">
                    <div className="flex gap-2 mb-1">
                      <div className="w-1/3 flex items-center gap-1">
                        <input
                          type="text"
                          value={key}
                          disabled
                          className="flex-1 px-2 py-1 bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-500 dark:text-slate-400 text-xs"
                        />
                      </div>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-xs"
                      />
                    </div>
                    {typeInfo && (
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${typeInfo.colors}`}>
                        <span>{typeInfo.icon}</span>
                        <span>{typeInfo.label}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {Object.keys((editData.inputs as Record<string, string>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">No inputs defined</p>
              )}
            </div>

            {/* Outputs */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">Outputs</label>
              {Object.entries((editData.outputs as Record<string, string>) || {}).map(([key, value]) => {
                const outputType = (editData.outputTypes as Record<string, DataType>)?.[key]
                const typeInfo = outputType ? getTypeInfo(outputType) : null
                return (
                  <div key={key} className="mb-3">
                    <div className="flex gap-2 mb-1">
                      <input
                        type="text"
                        value={key.replace(/^-+/, '')}
                        disabled
                        className="w-1/3 px-2 py-1 bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-500 dark:text-slate-400 text-xs"
                      />
                      <input
                        type="text"
                        value={value}
                        disabled
                        className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-400 dark:text-slate-400 text-xs"
                        title="Outputs are connected via edges"
                      />
                    </div>
                    {typeInfo && (
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${typeInfo.colors}`}>
                        <span>{typeInfo.icon}</span>
                        <span>{typeInfo.label}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {Object.keys((editData.outputs as Record<string, string>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">No outputs defined</p>
              )}
            </div>

            {/* Args */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">Arguments</label>
              {Object.entries((editData.args as Record<string, unknown>) || {}).map(([key, value]) => {
                const argSchema = taskSchema?.args?.[key]
                const isDefault = argSchema?.default !== undefined && value === argSchema.default
                const canRemove = !argSchema?.required
                const isBoolFlag = argSchema?.type === 'bool'
                const connectedParam = connectedArgs.get(key)
                const isConnected = !!connectedParam

                return (
                  <div key={key} className="mb-3">
                    <div className="flex gap-2 mb-1">
                      {isConnected ? (
                        // Connected to parameter - show as disabled with param name
                        <>
                          <input
                            type="text"
                            value={key.replace(/^-+/, '')}
                            disabled
                            className="w-1/2 px-2 py-1 bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-500 dark:text-slate-400 text-xs"
                          />
                          <div
                            className="flex-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/30 border border-purple-400 dark:border-purple-600 rounded text-purple-600 dark:text-purple-300 text-xs cursor-pointer flex items-center justify-between"
                            onContextMenu={(e) => {
                              e.preventDefault()
                              handleDisconnectArg(key)
                            }}
                            title="Right-click to disconnect"
                          >
                            <span>${connectedParam}</span>
                            <span className="text-purple-400 dark:text-purple-500 text-[10px]">&#128279;</span>
                          </div>
                          {canRemove && (
                            <button
                              onClick={() => handleRemoveArg(key)}
                              className="px-2 py-1 bg-slate-200 hover:bg-red-600 dark:bg-slate-700 dark:hover:bg-red-700 text-slate-500 dark:text-slate-400 hover:text-white text-xs rounded transition-colors"
                              title="Remove argument"
                            >
                              &#10005;
                            </button>
                          )}
                        </>
                      ) : isBoolFlag ? (
                        // Bool flag - show as enabled indicator
                        <>
                          <div className="flex-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 border border-green-500 dark:border-green-700 rounded text-green-600 dark:text-green-400 text-xs flex items-center gap-2">
                            <span>&#10003;</span>
                            <span className="font-mono">{key.replace(/^-+/, '')}</span>
                          </div>
                          {canRemove && (
                            <button
                              onClick={() => handleRemoveArg(key)}
                              className="px-2 py-1 bg-slate-200 hover:bg-red-600 dark:bg-slate-700 dark:hover:bg-red-700 text-slate-500 dark:text-slate-400 hover:text-white text-xs rounded transition-colors"
                              title="Remove flag"
                            >
                              &#10005;
                            </button>
                          )}
                        </>
                      ) : (
                        // Regular arg with value - editable
                        <>
                          <input
                            type="text"
                            value={key.replace(/^-+/, '')}
                            disabled
                            className="w-1/2 px-2 py-1 bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-500 dark:text-slate-400 text-xs"
                          />
                          <input
                            type={argSchema?.type === 'int' || argSchema?.type === 'float' ? 'number' : 'text'}
                            step={argSchema?.type === 'int' ? '1' : argSchema?.type === 'float' ? 'any' : undefined}
                            value={String(value)}
                            onChange={(e) => handleArgChange(key, e.target.value)}
                            className={`flex-1 px-2 py-1 bg-white dark:bg-slate-800 border rounded text-slate-900 dark:text-white text-xs ${
                              isDefault ? 'border-slate-300 dark:border-slate-700' : 'border-blue-500 dark:border-blue-600'
                            }`}
                          />
                          {canRemove && (
                            <button
                              onClick={() => handleRemoveArg(key)}
                              className="px-2 py-1 bg-slate-200 hover:bg-red-600 dark:bg-slate-700 dark:hover:bg-red-700 text-slate-500 dark:text-slate-400 hover:text-white text-xs rounded transition-colors"
                              title="Remove argument"
                            >
                              &#10005;
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {argSchema && !isBoolFlag && !isConnected && (
                      <div className="text-xs ml-1">
                        {argSchema.description && (
                          <div className="text-slate-400 dark:text-slate-500 mb-0.5">{argSchema.description}</div>
                        )}
                        <div className="flex gap-2 text-slate-400 dark:text-slate-600">
                          <span>type: {argSchema.type}</span>
                          {argSchema.default !== undefined && argSchema.default !== null && (
                            <span>default: {String(argSchema.default)}</span>
                          )}
                          {argSchema.choices && (
                            <span>choices: {argSchema.choices.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    )}
                    {argSchema && isBoolFlag && argSchema.description && !isConnected && (
                      <div className="text-xs ml-1 text-slate-400 dark:text-slate-500">{argSchema.description}</div>
                    )}
                  </div>
                )
              })}
              {Object.keys((editData.args as Record<string, unknown>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">No arguments configured</p>
              )}
            </div>

            {/* Available Args to Add */}
            {availableArgs.length > 0 && (
              <div className="border-t border-slate-300 dark:border-slate-700 pt-3 mt-3">
                <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">Available Arguments</label>
                <div className="space-y-2">
                  {availableArgs.map(([key, schema]) => (
                    <button
                      key={key}
                      onClick={() => handleAddArg(key)}
                      className="w-full text-left px-2 py-2 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-600 rounded text-xs transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500 dark:text-blue-400 font-mono">{key.replace(/^-+/, '')}</span>
                          {schema.type === 'bool' && (
                            <span className="text-slate-400 dark:text-slate-500 text-xs">(flag)</span>
                          )}
                        </div>
                        <span className="text-slate-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-blue-400">+ Add</span>
                      </div>
                      {schema.description && (
                        <div className="text-slate-400 dark:text-slate-500 text-xs mt-1 truncate">{schema.description}</div>
                      )}
                      {schema.type !== 'bool' && (
                        <div className="flex gap-2 text-slate-400 dark:text-slate-600 text-xs mt-1">
                          <span>type: {schema.type}</span>
                          {schema.default !== undefined && schema.default !== null && (
                            <span>default: {String(schema.default)}</span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Execution Controls */}
            {onRunStep && onCancelStep && stepName && (
              <div className="border-t border-slate-300 dark:border-slate-700 pt-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-slate-500 dark:text-slate-400 text-xs">Execution</label>
                  {/* Freshness badge */}
                  {freshness && (
                    <span
                      className={`px-2 py-0.5 text-xs rounded border ${getFreshnessColorClasses(freshness.status)}`}
                      title={freshness.reason}
                    >
                      {getFreshnessLabel(freshness.status)}
                    </span>
                  )}
                </div>
                {stepStatus === 'running' ? (
                  <button
                    onClick={() => onCancelStep(stepName)}
                    className="w-full px-3 py-2 bg-red-600 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="animate-pulse">&#9679;</span> Cancel Execution
                  </button>
                ) : (
                  <button
                    onClick={() => onRunStep(stepName)}
                    disabled={runEligibility && !runEligibility.canRun}
                    className={`w-full px-3 py-2 text-white text-sm rounded transition-colors flex items-center justify-center gap-2 ${
                      runEligibility && !runEligibility.canRun
                        ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
                        : 'bg-green-600 hover:bg-green-500 dark:bg-green-700 dark:hover:bg-green-600'
                    }`}
                    title={runEligibility ? getBlockReasonMessage(runEligibility) || undefined : undefined}
                  >
                    &#9654; Run This Step
                  </button>
                )}
                {/* Eligibility reason when blocked */}
                {runEligibility && !runEligibility.canRun && stepStatus !== 'running' && (
                  <p className="text-amber-500 dark:text-amber-400 text-xs mt-1 text-center">
                    {getBlockReasonMessage(runEligibility)}
                  </p>
                )}
                {stepStatus === 'completed' && (
                  <p className="text-green-500 dark:text-green-400 text-xs mt-1 text-center">&#10003; Completed</p>
                )}
                {stepStatus === 'failed' && (
                  <p className="text-red-500 dark:text-red-400 text-xs mt-1 text-center">&#10007; Failed</p>
                )}
              </div>
            )}

            {/* Available References */}
            <div className="border-t border-slate-300 dark:border-slate-700 pt-4 mt-4">
              <button
                onClick={() => setShowRefs(!showRefs)}
                className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs mb-2 hover:text-slate-900 dark:hover:text-white"
              >
                <span className={`transition-transform ${showRefs ? 'rotate-90' : ''}`}>&#9654;</span>
                Available References
              </button>
              {showRefs && (
                <div className="space-y-3 text-xs">
                  {/* Parameters */}
                  {Object.keys(parameters).length > 0 && (
                    <div>
                      <div className="text-slate-400 dark:text-slate-500 mb-1">Parameters</div>
                      <div className="space-y-1">
                        {Object.entries(parameters).map(([name, value]) => (
                          <div
                            key={name}
                            onClick={() => navigator.clipboard.writeText(`$${name}`)}
                            className="flex items-center justify-between px-2 py-1 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-800/40 rounded cursor-pointer"
                            title="Click to copy"
                          >
                            <span className="text-purple-600 dark:text-purple-300">${name}</span>
                            <span className="text-purple-400 dark:text-purple-400/70 font-mono">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
