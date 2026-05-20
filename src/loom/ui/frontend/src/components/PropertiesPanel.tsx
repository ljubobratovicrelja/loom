import { useState, useEffect, useMemo, type ReactNode } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  Video,
  Image,
  Table2,
  Braces,
  FolderOpen,
  Folder,
  FileText,
  FileQuestion,
  Link,
  RefreshCw,
} from 'lucide-react'
import type {
  StepData,
  ParameterData,
  DataNodeData,
  DataType,
  TaskInfo,
  StepExecutionState,
  LoopConfig,
  FeedbackEdgeData,
} from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'
import { getBlockReasonMessage } from '../hooks/useRunEligibility'
import type { FreshnessInfo } from '../hooks/useFreshness'
import { getFreshnessLabel, getFreshnessColorClasses } from '../hooks/useFreshness'

// Helper to check if a path is a URL
const isUrl = (path: string): boolean => {
  return path.startsWith('http://') || path.startsWith('https://')
}

// Icon component lookup for data types
const TYPE_ICON_COMPONENTS: Record<DataType, ReactNode> = {
  video: <Video className="w-3 h-3" />,
  image: <Image className="w-3 h-3" />,
  csv: <Table2 className="w-3 h-3" />,
  json: <Braces className="w-3 h-3" />,
  image_directory: <FolderOpen className="w-3 h-3" />,
  data_folder: <Folder className="w-3 h-3" />,
  txt: <FileText className="w-3 h-3" />,
}

// Data type options for selector
const DATA_TYPE_OPTIONS: Array<{ type: DataType; label: string }> = [
  { type: 'image', label: 'Image' },
  { type: 'video', label: 'Video' },
  { type: 'csv', label: 'CSV' },
  { type: 'json', label: 'JSON' },
  { type: 'image_directory', label: 'Image Directory' },
  { type: 'data_folder', label: 'Data Folder' },
  { type: 'txt', label: 'Text' },
]

// Type colors for badges (matching StepNode colors)
const TYPE_COLORS: Record<DataType, string> = {
  video:
    'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-600',
  image:
    'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-600',
  csv: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600',
  json: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-600',
  image_directory:
    'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600',
  data_folder:
    'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-600',
  txt: 'bg-slate-100 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600',
}

// Get type info (icon, label, color) for a data type
const getTypeInfo = (type: DataType) => {
  const option = DATA_TYPE_OPTIONS.find((opt) => opt.type === type)
  return {
    icon: TYPE_ICON_COMPONENTS[type] || <FileQuestion className="w-3 h-3" />,
    label: option?.label || type,
    colors:
      TYPE_COLORS[type] ||
      'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600',
  }
}

// Helper to check if a data type is a directory type
const isDirectoryType = (type: DataType): boolean => {
  return type === 'image_directory' || type === 'data_folder'
}

// Editable feedback edge sub-panel
function FeedbackEdgePanel({
  edgeData,
  onUpdateMultiPass,
}: {
  edgeData: FeedbackEdgeData
  onUpdateMultiPass?: (groupName: string, multiPass: FeedbackEdgeData['multiPass']) => void
}) {
  const mp = edgeData.multiPass
  const groupName = edgeData.groupName
  const isScheduleMode = !!mp?.schedule
  const iterCount = mp?.schedule?.length ?? mp?.count ?? 0

  // Local edit state for schedule rows
  const [scheduleRows, setScheduleRows] = useState<string[]>(
    () => mp?.schedule?.map((row) => JSON.stringify(row)) ?? [],
  )
  const [count, setCount] = useState<number>(mp?.count ?? 1)
  const [expressions, setExpressions] = useState<[string, string][]>(() =>
    mp?.expressions ? Object.entries(mp.expressions) : [],
  )
  const [conditionScript, setConditionScript] = useState<string>(mp?.condition?.script ?? '')
  const [conditionInputs, setConditionInputs] = useState<string>(
    mp?.condition?.inputs ? JSON.stringify(mp.condition.inputs) : '',
  )
  const [conditionArgs, setConditionArgs] = useState<string>(
    mp?.condition?.args ? JSON.stringify(mp.condition.args) : '',
  )

  // Per-field JSON-validity state (red border when invalid). Empty strings count as valid.
  const [invalid, setInvalid] = useState<{
    schedule: Set<number>
    conditionInputs: boolean
    conditionArgs: boolean
  }>({ schedule: new Set(), conditionInputs: false, conditionArgs: false })

  // Reset local state when edge changes
  useEffect(() => {
    setScheduleRows(mp?.schedule?.map((row) => JSON.stringify(row)) ?? [])
    setCount(mp?.count ?? 1)
    setExpressions(mp?.expressions ? Object.entries(mp.expressions) : [])
    setConditionScript(mp?.condition?.script ?? '')
    setConditionInputs(mp?.condition?.inputs ? JSON.stringify(mp.condition.inputs) : '')
    setConditionArgs(mp?.condition?.args ? JSON.stringify(mp.condition.args) : '')
    setInvalid({ schedule: new Set(), conditionInputs: false, conditionArgs: false })
  }, [mp])

  const tryParse = (s: string): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(s) }
    } catch {
      return { ok: false }
    }
  }

  const commitChanges = (overrides?: {
    schedule?: Record<string, unknown>[]
    count?: number
    expressions?: Record<string, string>
    conditionScript?: string
    feedback?: Record<string, string>
  }) => {
    if (!onUpdateMultiPass) return

    // Pre-validate all JSON; if anything fails, mark invalid fields and skip commit.
    const badScheduleRows = new Set<number>()
    let parsedSchedule: Record<string, unknown>[] | undefined
    if (isScheduleMode && !overrides?.schedule) {
      parsedSchedule = []
      scheduleRows.forEach((row, i) => {
        if (row === '') {
          parsedSchedule!.push({})
          return
        }
        const r = tryParse(row)
        if (!r.ok) {
          badScheduleRows.add(i)
        } else {
          parsedSchedule!.push(r.value as Record<string, unknown>)
        }
      })
    }

    const newScript =
      overrides?.conditionScript !== undefined ? overrides.conditionScript : conditionScript
    let parsedInputs: unknown
    let parsedArgs: unknown
    let badInputs = false
    let badArgs = false
    if (newScript) {
      if (conditionInputs) {
        const r = tryParse(conditionInputs)
        if (!r.ok) badInputs = true
        else parsedInputs = r.value
      }
      if (conditionArgs) {
        const r = tryParse(conditionArgs)
        if (!r.ok) badArgs = true
        else parsedArgs = r.value
      }
    }

    if (badScheduleRows.size > 0 || badInputs || badArgs) {
      setInvalid({ schedule: badScheduleRows, conditionInputs: badInputs, conditionArgs: badArgs })
      return
    }
    setInvalid({ schedule: new Set(), conditionInputs: false, conditionArgs: false })

    const updated: FeedbackEdgeData['multiPass'] = {
      ...mp,
      feedback: overrides?.feedback ?? mp.feedback,
    }

    if (isScheduleMode) {
      updated.schedule = overrides?.schedule ?? parsedSchedule!
      delete updated.expressions
      delete updated.count
    } else {
      const exprs = overrides?.expressions ?? Object.fromEntries(expressions)
      updated.expressions = exprs
      updated.count = overrides?.count ?? count
      delete updated.schedule
    }

    if (newScript) {
      updated.condition = {
        script: newScript,
        inputs: parsedInputs as Record<string, string> | undefined,
        args: parsedArgs as Record<string, unknown> | undefined,
      }
    } else {
      delete updated.condition
    }

    onUpdateMultiPass(groupName, updated)
  }

  return (
    <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900 flex flex-col">
      <div className="p-4 border-b border-slate-300 dark:border-slate-700">
        <h2 className="text-slate-900 dark:text-white font-semibold text-sm">
          Multi-Pass Feedback
        </h2>
        <span className="text-slate-400 dark:text-slate-500 text-xs">{groupName}</span>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Iteration count display */}
        <div>
          <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
            Iterations
          </label>
          <div className="px-3 py-2 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded text-purple-700 dark:text-purple-300 text-sm font-mono">
            {String(iterCount)}
          </div>
        </div>

        {/* Schedule mode */}
        {isScheduleMode && (
          <div>
            <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
              Schedule
            </label>
            <div className="space-y-1">
              {scheduleRows.map((row, i) => (
                <div key={i} className="flex gap-1">
                  <span className="text-slate-400 dark:text-slate-500 text-xs font-mono w-5 pt-1 flex-shrink-0">
                    {i}:
                  </span>
                  <input
                    type="text"
                    value={row}
                    onChange={(e) => {
                      const next = [...scheduleRows]
                      next[i] = e.target.value
                      setScheduleRows(next)
                    }}
                    onBlur={() => commitChanges()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className={`flex-1 px-2 py-1 bg-white dark:bg-slate-800 border rounded text-xs font-mono text-slate-700 dark:text-slate-300 ${
                      invalid.schedule.has(i)
                        ? 'border-red-500 dark:border-red-500'
                        : 'border-slate-300 dark:border-slate-700 focus:border-purple-500'
                    }`}
                  />
                  <button
                    onClick={() => {
                      const next = scheduleRows.filter((_, j) => j !== i)
                      setScheduleRows(next)
                      // Row removal triggers a fresh validate+commit via overrides:
                      // parse each remaining row; if any are invalid, commitChanges will mark them.
                      const parsed: Record<string, unknown>[] = []
                      let allOk = true
                      for (const r of next) {
                        if (r === '') {
                          parsed.push({})
                          continue
                        }
                        try {
                          parsed.push(JSON.parse(r))
                        } catch {
                          allOk = false
                          break
                        }
                      }
                      if (allOk) commitChanges({ schedule: parsed })
                      else commitChanges()
                    }}
                    className="px-1.5 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 text-xs"
                    title="Remove iteration"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                const template =
                  scheduleRows.length > 0 ? scheduleRows[scheduleRows.length - 1] : '{}'
                const next = [...scheduleRows, template]
                setScheduleRows(next)
                const parsed = next.map((r) => {
                  try {
                    return JSON.parse(r)
                  } catch {
                    return {}
                  }
                })
                commitChanges({ schedule: parsed })
              }}
              className="mt-1 text-xs text-purple-500 hover:text-purple-400 dark:text-purple-400 dark:hover:text-purple-300"
            >
              + Add iteration
            </button>
          </div>
        )}

        {/* Expressions mode */}
        {!isScheduleMode && (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">Count</label>
              <input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                onBlur={() => commitChanges({ count })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-sm font-mono text-slate-700 dark:text-slate-300 focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                Expressions
              </label>
              <div className="space-y-1">
                {expressions.map(([name, expr], i) => (
                  <div key={i} className="flex gap-1 items-center">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const next = [...expressions] as [string, string][]
                        next[i] = [e.target.value, expr]
                        setExpressions(next)
                      }}
                      onBlur={() => commitChanges()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      placeholder="name"
                      className="w-1/3 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-700 dark:text-slate-300 focus:border-purple-500"
                    />
                    <span className="text-slate-400 dark:text-slate-500 text-xs">=</span>
                    <input
                      type="text"
                      value={expr}
                      onChange={(e) => {
                        const next = [...expressions] as [string, string][]
                        next[i] = [name, e.target.value]
                        setExpressions(next)
                      }}
                      onBlur={() => commitChanges()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      placeholder="iter * 2 + 1"
                      className="flex-1 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-mono text-slate-700 dark:text-slate-300 focus:border-purple-500"
                    />
                    <button
                      onClick={() => {
                        const next = expressions.filter((_, j) => j !== i)
                        setExpressions(next)
                        commitChanges({ expressions: Object.fromEntries(next) })
                      }}
                      className="px-1.5 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 text-xs"
                      title="Remove expression"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  const next = [...expressions, ['', 'iter'] as [string, string]]
                  setExpressions(next)
                }}
                className="mt-1 text-xs text-purple-500 hover:text-purple-400 dark:text-purple-400 dark:hover:text-purple-300"
              >
                + Add expression
              </button>
            </div>
          </>
        )}

        {/* Condition script */}
        <div>
          <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
            Condition Script (optional)
          </label>
          <input
            type="text"
            value={conditionScript}
            onChange={(e) => setConditionScript(e.target.value)}
            onBlur={() => commitChanges({ conditionScript })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            placeholder="conditions/has_converged.py"
            className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-teal-300 dark:border-teal-700 rounded text-xs font-mono text-teal-700 dark:text-teal-300 focus:border-teal-500"
          />
          {conditionScript && (
            <>
              <p className="text-teal-500 dark:text-teal-400 text-[10px] mt-1">
                Python script with evaluate() function, called after each iteration
              </p>
              <div className="mt-2 space-y-2">
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 text-[10px] mb-0.5">
                    Inputs (JSON, optional)
                  </label>
                  <input
                    type="text"
                    value={conditionInputs}
                    onChange={(e) => setConditionInputs(e.target.value)}
                    onBlur={() => commitChanges({ conditionScript })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder='{"cleaned_csv": "$cleaned_signal"}'
                    className={`w-full px-2 py-1 bg-white dark:bg-slate-800 border rounded text-[10px] font-mono text-teal-700 dark:text-teal-300 ${
                      invalid.conditionInputs
                        ? 'border-red-500 dark:border-red-500'
                        : 'border-teal-300 dark:border-teal-700 focus:border-teal-500'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-500 dark:text-slate-400 text-[10px] mb-0.5">
                    Args (JSON, optional)
                  </label>
                  <input
                    type="text"
                    value={conditionArgs}
                    onChange={(e) => setConditionArgs(e.target.value)}
                    onBlur={() => commitChanges({ conditionScript })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder='{"tolerance": 0.01}'
                    className={`w-full px-2 py-1 bg-white dark:bg-slate-800 border rounded text-[10px] font-mono text-teal-700 dark:text-teal-300 ${
                      invalid.conditionArgs
                        ? 'border-red-500 dark:border-red-500'
                        : 'border-teal-300 dark:border-teal-700 focus:border-teal-500'
                    }`}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Feedback connections */}
        {mp?.feedback && Object.keys(mp.feedback).length > 0 && (
          <div>
            <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
              Feedback Connections
            </label>
            <div className="space-y-1">
              {Object.entries(mp.feedback).map(([src, tgt]) => (
                <div key={src} className="flex items-center gap-1">
                  <div className="flex-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-xs font-mono text-purple-600 dark:text-purple-400">
                    {src} &rarr; {tgt}
                  </div>
                  {onUpdateMultiPass && (
                    <button
                      onClick={() => {
                        const newFeedback = { ...mp.feedback }
                        delete newFeedback[src]
                        commitChanges({ feedback: newFeedback })
                      }}
                      className="px-1.5 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 text-xs"
                      title="Remove feedback connection"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface PropertiesPanelProps {
  selectedNode: Node | null
  selectedEdge?: Edge | null
  edges: Edge[]
  onUpdateNode: (id: string, data: Partial<StepData | ParameterData | DataNodeData>) => void
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
  onUpdateMultiPass?: (groupName: string, multiPass: FeedbackEdgeData['multiPass']) => void
}

export default function PropertiesPanel({
  selectedNode,
  selectedEdge,
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
  onUpdateMultiPass,
}: PropertiesPanelProps) {
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [showRefs, setShowRefs] = useState(true)
  const [paramValueInput, setParamValueInput] = useState('')

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
      if (selectedNode.type === 'parameter') {
        const paramData = selectedNode.data as ParameterData
        setParamValueInput(String(paramData.value ?? ''))
      }
    } else {
      setEditData({})
      setParamValueInput('')
    }
  }, [selectedNode])

  // Pre-filter edges to only those targeting this step from parameter nodes
  // This creates a stable reference that only changes when relevant edges change
  const paramEdgesToStep = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'step' || !edges || !Array.isArray(edges)) {
      return []
    }
    return edges.filter(
      (e) => e && e.target === selectedNode.id && e.source?.startsWith('param_') && e.targetHandle,
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

  // Find which args are targets of feedback edges (multi-pass)
  // Returns a map of argKey -> { sourceSpec, groupName }
  const feedbackArgs = useMemo(() => {
    if (!selectedNode || selectedNode.type !== 'step') {
      return new Map<string, { sourceSpec: string; groupName: string }>()
    }

    const result = new Map<string, { sourceSpec: string; groupName: string }>()
    for (const edge of edges) {
      if (
        edge.type === 'feedback' &&
        edge.target === selectedNode.id &&
        edge.targetHandle &&
        edge.data
      ) {
        const edgeData = edge.data as unknown as FeedbackEdgeData
        // Find the source spec from the feedback mapping
        const mp = edgeData.multiPass
        let sourceSpec = ''
        if (mp?.feedback) {
          for (const [src, tgt] of Object.entries(mp.feedback)) {
            const [, tgtFlag] = tgt.split('.', 2)
            if (tgtFlag === edge.targetHandle) {
              sourceSpec = src
              break
            }
          }
        }
        result.set(edge.targetHandle, {
          sourceSpec,
          groupName: edgeData.groupName,
        })
      }
    }
    return result
  }, [selectedNode, edges])

  if (!selectedNode) {
    // Show feedback edge properties if selected
    if (selectedEdge?.type === 'feedback' && selectedEdge.data) {
      return (
        <FeedbackEdgePanel
          edgeData={selectedEdge.data as unknown as FeedbackEdgeData}
          onUpdateMultiPass={onUpdateMultiPass}
        />
      )
    }

    return (
      <div className="flex-1 bg-slate-100 dark:bg-slate-900 border-l border-slate-300 dark:border-slate-700 p-4">
        <p className="text-slate-400 dark:text-slate-500 text-sm">
          Select a node to edit its properties
        </p>
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
    onUpdateNode(selectedNode.id, { [key]: value } as Partial<StepData | DataNodeData>)
  }

  const handleArgChange = (argKey: string, value: string) => {
    const args = { ...((editData.args as Record<string, unknown>) || {}) }
    // Parse value
    if (value === 'true') args[argKey] = true
    else if (value === 'false') args[argKey] = false
    else if (!isNaN(Number(value)) && value !== '') args[argKey] = Number(value)
    else args[argKey] = value

    handleChange('args', args)
  }

  const handleInputChange = (inputKey: string, value: string) => {
    const inputs = { ...((editData.inputs as Record<string, string>) || {}) }
    inputs[inputKey] = value
    handleChange('inputs', inputs)
  }

  const handleLoopChange = (field: keyof LoopConfig, value: string | boolean | undefined) => {
    const loop = { ...((editData.loop as LoopConfig) || { over: '', into: '' }) }
    if (field === 'parallel') {
      loop.parallel = value as boolean | undefined
    } else if (field === 'filter') {
      loop.filter = value as string | undefined
    } else {
      ;(loop as Record<string, unknown>)[field] = value
    }
    handleChange('loop', loop)
  }

  const handleAddArg = (argKey: string) => {
    const args = { ...((editData.args as Record<string, unknown>) || {}) }
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
    const args = { ...((editData.args as Record<string, unknown>) || {}) }
    delete args[argKey]
    handleChange('args', args)
  }

  // Get available args that aren't currently in the step
  const availableArgs = taskSchema?.args
    ? Object.entries(taskSchema.args).filter(
        ([key]) => !Object.prototype.hasOwnProperty.call(editData.args || {}, key),
      )
    : []

  // Handler for disconnecting an arg
  const handleDisconnectArg = (argKey: string) => {
    if (!selectedNode || !onDisconnectArg) return
    // Update local editData to clear the arg value immediately
    const newArgs = { ...((editData.args as Record<string, unknown>) || {}) }
    newArgs[argKey] = ''
    setEditData({ ...editData, args: newArgs })
    // Notify parent to remove the edge and update node
    onDisconnectArg(selectedNode.id, argKey)
  }

  return (
    <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900 flex flex-col">
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
                    if (
                      window.confirm(
                        `Move "${name}" data to trash?\n\nThis will move the file/folder to your system trash.`,
                      )
                    ) {
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
                value={paramValueInput}
                onChange={(e) => setParamValueInput(e.target.value)}
                onBlur={() => {
                  let parsedValue: unknown = paramValueInput
                  if (paramValueInput === 'true') parsedValue = true
                  else if (paramValueInput === 'false') parsedValue = false
                  else if (!isNaN(Number(paramValueInput)) && paramValueInput.trim() !== '') {
                    parsedValue = Number(paramValueInput)
                  }
                  handleChange('value', parsedValue)
                  if (onUpdateParameter && editData.name) {
                    onUpdateParameter(editData.name as string, parsedValue)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-purple-500"
              />
            </div>
            {selectedNode.id !== `param_${editData.name}` && (
              <div className="text-xs text-purple-500 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 rounded px-2 py-1">
                Reference of <span className="font-mono">${editData.name as string}</span>
              </div>
            )}
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
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={(editData.name as string) || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Human readable name"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                Key (for $references)
              </label>
              <div className="flex items-center gap-1">
                <span className="text-teal-500 dark:text-teal-400 text-sm">$</span>
                <input
                  type="text"
                  value={(editData.key as string) || ''}
                  onChange={(e) => handleChange('key', e.target.value)}
                  placeholder="data_name"
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
              <div className="relative">
                {(editData.path as string) && isUrl(editData.path as string) && (
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 dark:text-blue-400" />
                )}
                <input
                  type="text"
                  value={(editData.path as string) || ''}
                  onChange={(e) => handleChange('path', e.target.value)}
                  placeholder="data/path/to/file.ext or https://..."
                  className={`w-full py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-white text-sm focus:border-teal-500 ${
                    (editData.path as string) && isUrl(editData.path as string)
                      ? 'pl-9 pr-3'
                      : 'px-3'
                  }`}
                />
              </div>
              {(editData.path as string) && isUrl(editData.path as string) && (
                <p className="text-blue-500 dark:text-blue-400 text-xs mt-1 flex items-center gap-1">
                  <Link className="w-3 h-3" />
                  URL will be downloaded and cached locally
                </p>
              )}
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                Description (optional)
              </label>
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
                <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                  Pattern (optional)
                </label>
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
                    if (
                      window.confirm(
                        `Move "${displayName}" data to trash?\n\nThis will move the file/folder to your system trash.`,
                      )
                    ) {
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

            {/* Loop config */}
            {editData.loop && (
              <div className="border border-violet-300 dark:border-violet-700 rounded p-3 bg-violet-50 dark:bg-violet-900/10">
                <div className="flex items-center gap-2 mb-3">
                  <RefreshCw className="w-3 h-3 text-violet-500 dark:text-violet-400" />
                  <label className="text-violet-600 dark:text-violet-400 text-xs font-semibold">
                    Loop
                  </label>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                      Over (input collection)
                    </label>
                    <input
                      type="text"
                      value={(editData.loop as LoopConfig).over || ''}
                      onChange={(e) => handleLoopChange('over', e.target.value)}
                      placeholder="$input_dir"
                      className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-violet-300 dark:border-violet-700 rounded text-slate-900 dark:text-white text-xs font-mono focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                      Into (output collection)
                    </label>
                    <input
                      type="text"
                      value={(editData.loop as LoopConfig).into || ''}
                      onChange={(e) => handleLoopChange('into', e.target.value)}
                      placeholder="$output_dir"
                      className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-violet-300 dark:border-violet-700 rounded text-slate-900 dark:text-white text-xs font-mono focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                      <input
                        type="checkbox"
                        checked={(editData.loop as LoopConfig).parallel || false}
                        onChange={(e) =>
                          handleLoopChange('parallel', e.target.checked || undefined)
                        }
                        className="rounded"
                      />
                      Run iterations in parallel
                    </label>
                  </div>
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 text-xs mb-1">
                      Filter (glob, optional)
                    </label>
                    <input
                      type="text"
                      value={(editData.loop as LoopConfig).filter || ''}
                      onChange={(e) => handleLoopChange('filter', e.target.value || undefined)}
                      placeholder="*.jpg"
                      className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-violet-300 dark:border-violet-700 rounded text-slate-900 dark:text-white text-xs font-mono focus:border-violet-500"
                    />
                  </div>
                  <p className="text-violet-400 dark:text-violet-500 text-[10px]">
                    Use <code className="font-mono">$loop_item</code> in inputs and{' '}
                    <code className="font-mono">$loop_output</code> in outputs
                  </p>
                </div>
              </div>
            )}

            {/* Inputs */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">
                Inputs
              </label>
              {Object.entries((editData.inputs as Record<string, string>) || {}).map(
                ([key, value]) => {
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
                        <div
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${typeInfo.colors}`}
                        >
                          <span>{typeInfo.icon}</span>
                          <span>{typeInfo.label}</span>
                        </div>
                      )}
                      {feedbackArgs.has(key) &&
                        (() => {
                          const fb = feedbackArgs.get(key)!
                          return (
                            <div className="mt-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-[10px]">
                              <span className="text-purple-500 dark:text-purple-400">
                                &#8617; feedback
                              </span>
                              {fb.sourceSpec && (
                                <span className="text-purple-400 dark:text-purple-500 ml-1 font-mono">
                                  from {fb.sourceSpec.replace(/^-+/, '')}
                                </span>
                              )}
                              <span className="text-purple-400/60 dark:text-purple-500/60 ml-1">
                                ({fb.groupName})
                              </span>
                            </div>
                          )
                        })()}
                    </div>
                  )
                },
              )}
              {Object.keys((editData.inputs as Record<string, string>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">
                  No inputs defined
                </p>
              )}
            </div>

            {/* Outputs */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">
                Outputs
              </label>
              {Object.entries((editData.outputs as Record<string, string>) || {}).map(
                ([key, value]) => {
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
                        <div
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border ${typeInfo.colors}`}
                        >
                          <span>{typeInfo.icon}</span>
                          <span>{typeInfo.label}</span>
                        </div>
                      )}
                    </div>
                  )
                },
              )}
              {Object.keys((editData.outputs as Record<string, string>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">
                  No outputs defined
                </p>
              )}
            </div>

            {/* Args */}
            <div>
              <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">
                Arguments
              </label>
              {Object.entries((editData.args as Record<string, unknown>) || {}).map(
                ([key, value]) => {
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
                              <span className="text-purple-400 dark:text-purple-500 text-[10px]">
                                &#128279;
                              </span>
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
                              type={
                                argSchema?.type === 'int' || argSchema?.type === 'float'
                                  ? 'number'
                                  : 'text'
                              }
                              step={
                                argSchema?.type === 'int'
                                  ? '1'
                                  : argSchema?.type === 'float'
                                    ? 'any'
                                    : undefined
                              }
                              value={String(value)}
                              onChange={(e) => handleArgChange(key, e.target.value)}
                              className={`flex-1 px-2 py-1 bg-white dark:bg-slate-800 border rounded text-slate-900 dark:text-white text-xs ${
                                isDefault
                                  ? 'border-slate-300 dark:border-slate-700'
                                  : 'border-blue-500 dark:border-blue-600'
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
                            <div className="text-slate-400 dark:text-slate-500 mb-0.5">
                              {argSchema.description}
                            </div>
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
                        <div className="text-xs ml-1 text-slate-400 dark:text-slate-500">
                          {argSchema.description}
                        </div>
                      )}
                      {/* Feedback indicator */}
                      {feedbackArgs.has(key) &&
                        (() => {
                          const fb = feedbackArgs.get(key)!
                          return (
                            <div className="mt-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-[10px]">
                              <span className="text-purple-500 dark:text-purple-400">
                                &#8617; feedback
                              </span>
                              {fb.sourceSpec && (
                                <span className="text-purple-400 dark:text-purple-500 ml-1 font-mono">
                                  from {fb.sourceSpec.replace(/^-+/, '')}
                                </span>
                              )}
                              <span className="text-purple-400/60 dark:text-purple-500/60 ml-1">
                                ({fb.groupName})
                              </span>
                            </div>
                          )
                        })()}
                    </div>
                  )
                },
              )}
              {Object.keys((editData.args as Record<string, unknown>) || {}).length === 0 && (
                <p className="text-slate-400 dark:text-slate-600 text-xs italic">
                  No arguments configured
                </p>
              )}
            </div>

            {/* Available Args to Add */}
            {availableArgs.length > 0 && (
              <div className="border-t border-slate-300 dark:border-slate-700 pt-3 mt-3">
                <label className="block text-slate-500 dark:text-slate-400 text-xs mb-2">
                  Available Arguments
                </label>
                <div className="space-y-2">
                  {availableArgs.map(([key, schema]) => (
                    <button
                      key={key}
                      onClick={() => handleAddArg(key)}
                      className="w-full text-left px-2 py-2 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-600 rounded text-xs transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500 dark:text-blue-400 font-mono">
                            {key.replace(/^-+/, '')}
                          </span>
                          {schema.type === 'bool' && (
                            <span className="text-slate-400 dark:text-slate-500 text-xs">
                              (flag)
                            </span>
                          )}
                        </div>
                        <span className="text-slate-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-blue-400">
                          + Add
                        </span>
                      </div>
                      {schema.description && (
                        <div className="text-slate-400 dark:text-slate-500 text-xs mt-1 truncate">
                          {schema.description}
                        </div>
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
                    title={
                      runEligibility
                        ? getBlockReasonMessage(runEligibility) || undefined
                        : undefined
                    }
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
                  <p className="text-green-500 dark:text-green-400 text-xs mt-1 text-center">
                    &#10003; Completed
                  </p>
                )}
                {stepStatus === 'failed' && (
                  <p className="text-red-500 dark:text-red-400 text-xs mt-1 text-center">
                    &#10007; Failed
                  </p>
                )}
              </div>
            )}

            {/* Available References */}
            <div className="border-t border-slate-300 dark:border-slate-700 pt-4 mt-4">
              <button
                onClick={() => setShowRefs(!showRefs)}
                className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs mb-2 hover:text-slate-900 dark:hover:text-white"
              >
                <span className={`transition-transform ${showRefs ? 'rotate-90' : ''}`}>
                  &#9654;
                </span>
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
                            <span className="text-purple-400 dark:text-purple-400/70 font-mono">
                              {String(value)}
                            </span>
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
