import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react'
import { useNodesState, useEdgesState, type Node, type Edge as FlowEdge, type NodeChange } from '@xyflow/react'
import { AlertTriangle, Info, XCircle, X, ChevronLeft, ChevronRight } from 'lucide-react'

import AutoLayoutConfirmDialog from './components/AutoLayoutConfirmDialog'
import Canvas from './components/Canvas'
import CleanDialog from './components/CleanDialog'
import ConfirmDialog from './components/ConfirmDialog'
import UnsavedChangesDialog from './components/UnsavedChangesDialog'
import Sidebar from './components/Sidebar'
import PropertiesPanel from './components/PropertiesPanel'
import Toolbar from './components/Toolbar'
import TerminalPanel from './components/TerminalPanel'
import { useApi } from './hooks/useApi'
import { useStepExecutions } from './hooks/useStepExecutions'
import { useHistory, type HistoryState } from './hooks/useHistory'
import { useRunEligibility, getParallelRunEligibility, getGroupRunEligibility } from './hooks/useRunEligibility'
import { useFreshness } from './hooks/useFreshness'
import { applyDagreLayout } from './utils/layout'
import type {
  PipelineGraph,
  PipelineNode,
  PipelineInfo,
  StepNode,
  ParameterNode,
  DataNode,
  TaskInfo,
  StepData,
  DataType,
  DataEntry,
  DataNodeData,
  ExecutionStatus,
  RunMode,
  RunRequest,
  StepExecutionState,
  ValidationWarning,
  CleanPreview,
} from './types/pipeline'

// Type alias for edges used throughout the app
type Edge = FlowEdge

// Helper to enrich step nodes with input/output type information from task schemas
function enrichStepNodesWithTypes(nodes: PipelineNode[], tasks: TaskInfo[]): PipelineNode[] {
  const taskMap = new Map(tasks.map(t => [t.path, t]))

  return nodes.map(node => {
    if (node.type !== 'step') return node

    const stepData = node.data as StepData
    const task = taskMap.get(stepData.task)
    if (!task) return node

    // Extract input types from task schema
    const inputTypes: Record<string, DataType> = {}
    for (const [inputName, inputSchema] of Object.entries(task.inputs)) {
      if (inputSchema.type) {
        inputTypes[inputName] = inputSchema.type
      }
    }

    // Extract output types from task schema
    const outputTypes: Record<string, DataType> = {}
    for (const [outputName, outputSchema] of Object.entries(task.outputs)) {
      if (outputSchema.type) {
        outputTypes[outputName] = outputSchema.type
      }
    }

    // Only update if we have type info
    if (Object.keys(inputTypes).length === 0 && Object.keys(outputTypes).length === 0) {
      return node
    }

    return {
      ...node,
      data: {
        ...stepData,
        inputTypes,
        outputTypes,
      },
    }
  })
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodes, setSelectedNodes] = useState<PipelineNode[]>([])
  const [configPath, setConfigPath] = useState<string | null>(null)
  const [parameters, setParameters] = useState<Record<string, unknown>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Save confirmation dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [skipSaveConfirmation, setSkipSaveConfirmation] = useState(false)

  // Execution options state
  const [parallelEnabled, setParallelEnabled] = useState(false)
  const [maxWorkers, setMaxWorkers] = useState<number | null>(null)

  // Resizable sidebar widths
  const [sidebarWidth, setSidebarWidth] = useState(256) // Default w-64
  const [propertiesWidth, setPropertiesWidth] = useState(320) // Default w-80

  // Collapsible sidebar state
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => localStorage.getItem('loom-ui:leftCollapsed') === 'true'
  )
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('loom-ui:rightCollapsed') === 'true'
  )

  useEffect(() => {
    localStorage.setItem('loom-ui:leftCollapsed', String(leftCollapsed))
  }, [leftCollapsed])

  useEffect(() => {
    localStorage.setItem('loom-ui:rightCollapsed', String(rightCollapsed))
  }, [rightCollapsed])

  // Parameter nodes visibility
  const [showParameterNodes, setShowParameterNodes] = useState(
    () => localStorage.getItem('loom-ui:showParameterNodes') !== 'false'
  )

  useEffect(() => {
    localStorage.setItem('loom-ui:showParameterNodes', String(showParameterNodes))
  }, [showParameterNodes])

  // Auto-layout confirm dialog
  const [showAutoLayoutConfirm, setShowAutoLayoutConfirm] = useState(false)

  // One-shot flag: when true, next save omits the layout section
  const clearLayoutOnSave = useRef(false)

  // Refs for change tracking and history
  const isInitialMount = useRef(true)
  // Flag to skip change tracking during initial load (stays true until init completes)
  const isLoadingRef = useRef(true)
  // Flag to skip change tracking after restore/save operations
  // Using a boolean flag ensures we skip exactly once regardless of React's batching behavior
  const skipNextChangeTrackingRef = useRef(false)

  // History for undo/redo - refs to access current state in callbacks
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const parametersRef = useRef(parameters)

  // Use useLayoutEffect to update refs synchronously after DOM mutations,
  // ensuring refs are up-to-date before any event handlers can fire
  useLayoutEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useLayoutEffect(() => {
    edgesRef.current = edges
  }, [edges])
  useLayoutEffect(() => {
    parametersRef.current = parameters
  }, [parameters])

  // Track dragging state for debouncing
  const isDraggingRef = useRef(false)

  // Trailing debounce for rapid changes (e.g., typing in input fields)
  // Fires 300ms after the last change, capturing the final state
  const SNAPSHOT_DEBOUNCE_MS = 300
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce for path check (when editing data node paths)
  const PATH_CHECK_DEBOUNCE_MS = 500
  const pathCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // History hook with restore callback
  const handleHistoryRestore = useCallback(
    (state: HistoryState) => {
      skipNextChangeTrackingRef.current = true
      setNodes(state.nodes as PipelineNode[])
      setEdges(state.edges)
      setParameters(state.parameters)
      setHasChanges(true)
    },
    [setNodes, setEdges]
  )

  const { snapshot, undo, redo, clear: clearHistory, canUndo, canRedo } = useHistory({
    maxHistory: 50,
    onRestore: handleHistoryRestore,
  })

  // Helper to get current state for undo/redo
  // Note: Uses refs which are updated via useEffect after render. For user-triggered
  // actions this is fine since effects run before the next user interaction.
  const getCurrentState = useCallback(
    (): HistoryState => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      parameters: parametersRef.current,
    }),
    []
  )

  // Trailing debounce: captures state 300ms after the last change
  // This ensures we snapshot the final state after typing stops, not intermediate states
  const debouncedSnapshot = useCallback(
    (state: HistoryState) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        snapshot(state)
        debounceTimerRef.current = null
      }, SNAPSHOT_DEBOUNCE_MS)
    },
    [snapshot]
  )

  // Clean up debounce timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (pathCheckTimerRef.current) {
        clearTimeout(pathCheckTimerRef.current)
      }
    }
  }, [])

  // Execution state
  const [terminalVisible, setTerminalVisible] = useState(false)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle')
  const [runRequest, setRunRequest] = useState<RunRequest | null>(null)

  // Per-step terminal output for parallel execution
  const [activeTerminalStep, setActiveTerminalStep] = useState<string | null>(null)
  const [stepTerminalOutputs, setStepTerminalOutputs] = useState<Map<string, string>>(new Map())

  // Task schemas (shared between Sidebar and PropertiesPanel)
  const [tasks, setTasks] = useState<TaskInfo[]>([])

  const { loadConfig, saveConfig, loadState, loadTasks, loadDataStatus, trashData, openPath, validateConfig, previewClean, cleanAllData, listPipelines, openPipeline, checkPath, loading, error: apiError } = useApi()

  // Debounced path check: validates path existence after typing stops
  // Used when editing data node paths to provide instant feedback
  const debouncedPathCheck = useCallback(
    (nodeId: string, path: string) => {
      if (pathCheckTimerRef.current) {
        clearTimeout(pathCheckTimerRef.current)
      }
      pathCheckTimerRef.current = setTimeout(async () => {
        const result = await checkPath(path)
        // Runtime-only change - don't mark as dirty
        skipNextChangeTrackingRef.current = true
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId && n.type === 'data'
              ? { ...n, data: { ...n.data, exists: result.exists } }
              : n
          )
        )
        pathCheckTimerRef.current = null
      }, PATH_CHECK_DEBOUNCE_MS)
    },
    [checkPath, setNodes]
  )

  // Validation warnings
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([])
  const [showWarnings, setShowWarnings] = useState(true)
  const [expandWarnings, setExpandWarnings] = useState(false)

  // Clean dialog state
  const [showCleanDialog, setShowCleanDialog] = useState(false)
  const [cleanPreview, setCleanPreview] = useState<CleanPreview | null>(null)
  const [cleanLoading, setCleanLoading] = useState(false)

  // Workspace mode state
  const [isWorkspaceMode, setIsWorkspaceMode] = useState(false)
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([])
  const [pipelinesLoading, setPipelinesLoading] = useState(false)
  const [pendingPipeline, setPendingPipeline] = useState<PipelineInfo | null>(null)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)


  // Independent step execution hook - each step can run concurrently
  const {
    runStep: runStepIndependent,
    cancelStep: cancelStepIndependent,
    getStepStatus: getIndependentStepStatus,
    stepStatuses: independentStepStatuses,
  } = useStepExecutions({
    onStepStatusChange: (stepName, status) => {
      handleStepStatusChange(stepName, status)
      // Refresh variable status and freshness when a step completes or fails
      // Run sequentially to ensure variable status is updated before freshness check
      if (status === 'completed' || status === 'failed') {
        setTimeout(async () => {
          await refreshVariableStatus()
          refreshFreshness()
        }, 200)
      }
    },
    onStepOutput: (stepName, output) => {
      handleStepOutput(stepName, output)
    },
  })

  // Run eligibility based on dependency graph and running steps
  const runEligibility = useRunEligibility(nodes, edges, independentStepStatuses)

  // Freshness status for all steps (timestamp-based)
  const { freshness, refresh: refreshFreshness } = useFreshness()

  // Sync freshness status to node data when freshness Map changes
  // Only update nodes that actually changed to avoid unnecessary re-renders
  useEffect(() => {
    if (freshness.size === 0) return

    // Runtime-only change - don't mark document as dirty
    skipNextChangeTrackingRef.current = true
    setNodes((nds) => {
      // First pass: check if any nodes need updating
      let hasChanges = false
      for (const node of nds) {
        if (node.type === 'step') {
          const data = node.data as StepData
          const freshnessInfo = freshness.get(data.name)
          if (freshnessInfo && freshnessInfo.status !== data.freshnessStatus) {
            hasChanges = true
            break
          }
        }
      }

      // No changes needed - return original array to avoid re-renders
      if (!hasChanges) return nds

      // Second pass: update only the changed nodes
      return nds.map((node) => {
        if (node.type === 'step') {
          const data = node.data as StepData
          const freshnessInfo = freshness.get(data.name)
          if (freshnessInfo && freshnessInfo.status !== data.freshnessStatus) {
            return {
              ...node,
              data: { ...data, freshnessStatus: freshnessInfo.status },
            }
          }
        }
        return node
      })
    })
  }, [freshness, setNodes])

  // Derive selection info for run controls
  const selectedStepNodes = selectedNodes.filter((n) => n.type === 'step')
  const selectedStepNames = selectedStepNodes.map((n) => (n.data as StepData).name)
  const selectedStepName = selectedStepNames.length === 1 ? selectedStepNames[0] : null
  const selectedDataKey = selectedNodes.length === 1 && selectedNodes[0].type === 'data'
    ? (selectedNodes[0].data as DataNodeData).key
    : null

  // Detect if selected steps include exactly one complete group
  // (clicking a group node selects members + neighbors, so we check if any
  // single group has ALL its members within the selection)
  const detectedGroupName = useMemo(() => {
    if (selectedStepNodes.length < 2) return null
    const selectedIds = new Set(selectedStepNodes.map(n => n.id))

    // Build map of group name → member node IDs
    const groupMembers = new Map<string, string[]>()
    for (const n of nodes) {
      if (n.type === 'step') {
        const group = (n.data as StepData).group
        if (group) {
          if (!groupMembers.has(group)) groupMembers.set(group, [])
          groupMembers.get(group)!.push(n.id)
        }
      }
    }

    // Find groups where ALL members are selected, and detect partial selections
    const matchingGroups: string[] = []
    let hasPartialOtherGroup = false
    for (const [groupName, members] of groupMembers) {
      const selectedCount = members.filter(id => selectedIds.has(id)).length
      if (members.length >= 2 && selectedCount === members.length) {
        matchingGroups.push(groupName)
      } else if (selectedCount > 0 && selectedCount < members.length) {
        hasPartialOtherGroup = true
      }
    }

    // Only detect group when unambiguous: exactly one full group, no partial others
    if (matchingGroups.length === 1 && !hasPartialOtherGroup) {
      return matchingGroups[0]
    }
    return null
  }, [selectedStepNodes, nodes])

  // For PropertiesPanel - show first selected node (single selection behavior)
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null

  // Sync activeTerminalStep with selected step - ensures terminal switches when selection changes
  useEffect(() => {
    if (selectedStepName) {
      setActiveTerminalStep(selectedStepName)
    }
  }, [selectedStepName])

  // Helper to check if all inputs/outputs of a step exist
  const checkStepCompleted = (stepData: StepData, status: Record<string, boolean>): boolean => {
    // Extract variable names from inputs and outputs
    const varRefs = [
      ...Object.values(stepData.inputs),
      ...Object.values(stepData.outputs),
    ]

    for (const ref of varRefs) {
      if (ref.startsWith('$')) {
        const varName = ref.slice(1)
        // If variable doesn't exist or status is false, step is not completed
        if (!status[varName]) {
          return false
        }
      }
    }

    // All referenced variables exist
    return varRefs.length > 0
  }

  // Refresh data node existence status and update ALL node states accordingly
  // This is the single source of truth for node visual states based on file existence
  const refreshVariableStatus = useCallback(async () => {
    const status = await loadDataStatus()
    if (Object.keys(status).length === 0) return

    // Runtime-only change - don't mark document as dirty
    skipNextChangeTrackingRef.current = true
    setNodes((nds) =>
      nds.map((node) => {
        // Update data nodes - use key for lookup (not display name)
        if (node.type === 'data') {
          const data = node.data as DataNodeData
          const exists = status[data.key]
          if (exists !== undefined) {
            return { ...node, data: { ...data, exists } }
          }
        }
        // Update step nodes based on whether all their I/O exists
        if (node.type === 'step') {
          const data = node.data as StepData
          const allExist = checkStepCompleted(data, status)
          const currentState = data.executionState || 'idle'

          // Determine new state based on I/O existence
          // Only auto-update idle <-> completed, don't interfere with running/failed
          if (allExist && (currentState === 'idle' || currentState === 'completed')) {
            return { ...node, data: { ...data, executionState: 'completed' as StepExecutionState } }
          }
          if (!allExist && currentState === 'completed') {
            // I/O was deleted, reset to idle
            return { ...node, data: { ...data, executionState: 'idle' as StepExecutionState } }
          }
        }
        return node
      })
    )
  }, [loadDataStatus, setNodes])

  // Load initial state and tasks
  useEffect(() => {
    const init = async () => {
      // Load tasks for sidebar and properties panel
      const loadedTasks = await loadTasks()
      setTasks(loadedTasks)

      const state = await loadState()

      // Check if we're in workspace mode
      let hashPipelinePath: string | null = null
      if (state?.isWorkspaceMode) {
        setIsWorkspaceMode(true)
        // Load available pipelines
        setPipelinesLoading(true)
        const pipelineList = await listPipelines()
        setPipelines(pipelineList)
        setPipelinesLoading(false)

        // Check URL hash for deep-linked pipeline
        const hash = window.location.hash.replace(/^#\/?/, '')
        const pipelineMatch = hash.match(/^pipeline\/(.+)$/)
        if (pipelineMatch) {
          const relativePath = pipelineMatch[1]
          const matched = pipelineList.find(p => p.relative_path === relativePath)
          if (matched) {
            hashPipelinePath = matched.path
          }
        }

        // If hash points to a valid pipeline different from current, switch to it
        if (hashPipelinePath && hashPipelinePath !== state?.configPath) {
          // Open the hash-specified pipeline via backend
          const result = await openPipeline(hashPipelinePath)
          if (result.success && result.configPath) {
            // Override configPath so the rest of init loads the right pipeline
            state.configPath = result.configPath
          }
        }
      }

      if (state?.configPath) {
        setConfigPath(state.configPath)
        const graph = await loadConfig(state.configPath)
        if (graph) {
          // Apply Dagre layout if no saved layout, otherwise use saved positions
          let layoutedNodes = graph.hasLayout
            ? graph.nodes
            : applyDagreLayout(graph.nodes as Node[], graph.edges) as PipelineNode[]
          // Enrich step nodes with type information from task schemas
          layoutedNodes = enrichStepNodesWithTypes(layoutedNodes, loadedTasks)
          setNodes(layoutedNodes)
          setEdges(graph.edges)
          setParameters(graph.parameters)

          // Load editor options
          if (graph.editor) {
            setSkipSaveConfirmation(graph.editor.autoSave ?? false)
          }

          // Load execution options
          if (graph.execution) {
            setParallelEnabled(graph.execution.parallel ?? false)
            setMaxWorkers(graph.execution.maxWorkers ?? null)
          }

          // Clear undo history on load - loaded state is baseline
          clearHistory()

          // Check data node file existence immediately after loading
          const status = await loadDataStatus()
          if (Object.keys(status).length > 0) {
            setNodes((nds) =>
              nds.map((node) => {
                // Update data nodes - use key for lookup (not display name)
                if (node.type === 'data') {
                  const data = node.data as DataNodeData
                  const exists = status[data.key]
                  if (exists !== undefined) {
                    return { ...node, data: { ...data, exists } }
                  }
                }
                // Also mark steps as completed if all their I/O exists
                if (node.type === 'step') {
                  const data = node.data as StepData
                  const allExist = checkStepCompleted(data, status)
                  if (allExist) {
                    return { ...node, data: { ...data, executionState: 'completed' as StepExecutionState } }
                  }
                }
                return node
              })
            )
          }

          // Fetch initial freshness status
          refreshFreshness()

          // Validate the loaded config and show warnings
          const validationResult = await validateConfig(state.configPath)
          if (validationResult.warnings.length > 0) {
            setValidationWarnings(validationResult.warnings)
            setShowWarnings(true)
            // Log all issues to console for full visibility
            console.group(`Pipeline Validation (${validationResult.warnings.length} suggestions)`)
            validationResult.warnings.forEach((w, i) => {
              const prefix = w.step ? `[${w.step}]` : ''
              if (w.level === 'error') {
                console.error(`${i + 1}. ${prefix} ${w.message}`)
              } else if (w.level === 'warning') {
                console.warn(`${i + 1}. ${prefix} ${w.message}`)
              } else {
                console.info(`${i + 1}. ${prefix} ${w.message}`)
              }
            })
            console.groupEnd()
          }
        }
      }
      // Sync URL hash with loaded pipeline (for workspace mode)
      if (state?.isWorkspaceMode && state?.configPath) {
        const pipelineList = pipelines.length > 0 ? pipelines : await listPipelines()
        const matched = pipelineList.find(p => p.path === state.configPath)
        if (matched && matched.relative_path) {
          programmaticHashChangeRef.current = true
          window.location.hash = `/pipeline/${matched.relative_path}`
        }
      }

      // Mark loading as complete - changes after this point should mark dirty
      isLoadingRef.current = false
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pipelines is intentionally omitted: used as a cache check, not a reactive dependency
  }, [loadConfig, loadState, loadTasks, loadDataStatus, validateConfig, listPipelines, openPipeline, setNodes, setEdges, clearHistory, refreshFreshness])

  // Flag to skip hashchange events triggered by our own programmatic hash updates
  const programmaticHashChangeRef = useRef(false)

  // Track changes - skip initial mount and handle save properly
  useEffect(() => {
    // Skip initial mount - don't mark as changed when first loading
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    // Skip during initial load phase
    if (isLoadingRef.current) {
      return
    }
    // Skip if flagged (after restore/save) - reset flag for next change
    if (skipNextChangeTrackingRef.current) {
      skipNextChangeTrackingRef.current = false
      return
    }
    setHasChanges(true)
  }, [nodes, edges])

  // Track execution settings changes
  const prevParallelRef = useRef(parallelEnabled)
  const prevMaxWorkersRef = useRef(maxWorkers)
  useEffect(() => {
    // Skip during initial load phase
    if (isLoadingRef.current) {
      prevParallelRef.current = parallelEnabled
      prevMaxWorkersRef.current = maxWorkers
      return
    }
    // Only mark dirty if the values actually changed
    if (prevParallelRef.current !== parallelEnabled || prevMaxWorkersRef.current !== maxWorkers) {
      setHasChanges(true)
      prevParallelRef.current = parallelEnabled
      prevMaxWorkersRef.current = maxWorkers
    }
  }, [parallelEnabled, maxWorkers])

  // Track previous execution status to detect when execution stops
  const prevExecutionStatusRef = useRef<ExecutionStatus>('idle')

  // Refresh variable status and freshness when execution stops (transitions from 'running' to any other state)
  useEffect(() => {
    const wasRunning = prevExecutionStatusRef.current === 'running'
    const stoppedRunning = executionStatus !== 'running'

    if (wasRunning && stoppedRunning) {
      // Small delay to allow filesystem to sync after process exits
      // Run sequentially to ensure variable status is updated before freshness check
      const timer = setTimeout(async () => {
        await refreshVariableStatus()
        refreshFreshness()
      }, 200)
      prevExecutionStatusRef.current = executionStatus
      return () => clearTimeout(timer)
    }

    prevExecutionStatusRef.current = executionStatus
  }, [executionStatus, refreshVariableStatus, refreshFreshness])

  // Perform the actual save without confirmation
  const performSave = useCallback(async () => {
    if (!configPath) return

    // Build data entries from data nodes
    const data: Record<string, DataEntry> = {}
    nodes.forEach((node) => {
      if (node.type === 'data') {
        const dataNode = node.data as DataNodeData
        data[dataNode.key] = {
          type: dataNode.type,
          path: dataNode.path,
          name: dataNode.name,
          description: dataNode.description,
          pattern: dataNode.pattern,
        }
      }
    })

    const graph: PipelineGraph = {
      variables: {},  // Deprecated - kept for compatibility
      parameters,
      data,
      nodes: nodes as PipelineGraph['nodes'],
      edges,
      hasLayout: !clearLayoutOnSave.current,
      editor: {
        autoSave: skipSaveConfirmation,
      },
      execution: {
        parallel: parallelEnabled,
        maxWorkers: maxWorkers,
      },
    }

    const success = await saveConfig(graph, configPath)
    if (success) {
      // Reset the clear-layout flag after a successful save
      clearLayoutOnSave.current = false
      // Clear undo history on save - saved state is now baseline
      clearHistory()
      // Skip next change tracking trigger - save doesn't change the document
      skipNextChangeTrackingRef.current = true
      setHasChanges(false)
    } else {
      // Show error to user - save failed
      const errorMessage = apiError || 'Failed to save changes. Please try again.'
      alert(`Save failed: ${errorMessage}`)
    }
  }, [configPath, nodes, edges, parameters, skipSaveConfirmation, parallelEnabled, maxWorkers, saveConfig, clearHistory, apiError])

  // Request save - shows confirmation dialog unless skipped
  const handleSave = useCallback(() => {
    if (!configPath) return
    if (skipSaveConfirmation) {
      performSave()
    } else {
      setShowSaveDialog(true)
    }
  }, [configPath, skipSaveConfirmation, performSave])

  // Re-runs dagre and saves without layout positions in the YAML
  const performAutoLayoutAndSave = useCallback(async () => {
    snapshot(getCurrentState())
    const layoutedNodes = applyDagreLayout(nodes as Node[], edges) as PipelineNode[]
    setNodes(layoutedNodes)
    clearLayoutOnSave.current = true
    await performSave()
  }, [snapshot, getCurrentState, nodes, edges, setNodes, performSave])

  // Entry point for auto-layout: confirm when autosave is off
  const handleAutoLayout = useCallback(() => {
    if (!configPath) return
    if (skipSaveConfirmation) {
      performAutoLayoutAndSave()
    } else {
      setShowAutoLayoutConfirm(true)
    }
  }, [configPath, skipSaveConfirmation, performAutoLayoutAndSave])

  // Keyboard shortcuts for undo/redo/save/layout/sidebar/parameter-toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const modifier = e.metaKey || e.ctrlKey

      if (modifier && e.key === 'z') {
        if (e.shiftKey) {
          // Cmd/Ctrl+Shift+Z = Redo
          e.preventDefault()
          redo(getCurrentState())
        } else {
          // Cmd/Ctrl+Z = Undo
          e.preventDefault()
          undo(getCurrentState())
        }
      } else if (e.ctrlKey && e.key === 'y') {
        // Ctrl+Y = Redo (Windows standard)
        e.preventDefault()
        redo(getCurrentState())
      } else if (modifier && e.key === 's') {
        // Cmd/Ctrl+S = Save (override browser save dialog)
        e.preventDefault()
        handleSave()
      } else if (modifier && e.shiftKey && e.key === 'L') {
        // Ctrl/Cmd+Shift+L = Auto-layout
        e.preventDefault()
        handleAutoLayout()
      } else if (e.key === 'p' || e.key === 'P') {
        // P = Toggle parameter nodes (bare key, no modifier)
        if (!modifier) {
          const tag = (e.target as HTMLElement).tagName
          if (!['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(tag)) {
            setShowParameterNodes((v) => !v)
          }
        }
      } else if (e.key === 'Tab' && e.ctrlKey) {
        // Ctrl+Tab = Toggle sidebars (collapse both or expand both)
        const tag = (e.target as HTMLElement).tagName
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(tag)) return
        e.preventDefault()
        const allCollapsed = leftCollapsed && rightCollapsed
        setLeftCollapsed(!allCollapsed)
        setRightCollapsed(!allCollapsed)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, getCurrentState, handleSave, handleAutoLayout, leftCollapsed, rightCollapsed])

  // Save dialog handlers
  const handleSaveConfirm = useCallback(() => {
    setShowSaveDialog(false)
    performSave()
  }, [performSave])

  const handleSaveConfirmAndRemember = useCallback(() => {
    setShowSaveDialog(false)
    setSkipSaveConfirmation(true)
    performSave()
  }, [performSave])

  const handleSaveCancel = useCallback(() => {
    setShowSaveDialog(false)
  }, [])

  const handleExport = useCallback(() => {
    // Build YAML-like structure
    const dataSection: Record<string, DataEntry> = {}
    nodes.forEach((node) => {
      if (node.type === 'data') {
        const data = node.data as DataNodeData
        dataSection[data.key] = {
          type: data.type,
          path: data.path,
          name: data.name,
          description: data.description,
          pattern: data.pattern,
        }
      }
    })

    const pipeline = nodes
      .filter((n) => n.type === 'step')
      .sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x))
      .map((node) => {
        const data = node.data as StepData
        const step: Record<string, unknown> = {
          name: data.name,
          task: data.task,
        }
        if (Object.keys(data.inputs).length) step.inputs = data.inputs
        if (Object.keys(data.outputs).length) step.outputs = data.outputs
        if (Object.keys(data.args).length) step.args = data.args
        if (data.optional) step.optional = true
        return step
      })

    const yamlContent = {
      data: dataSection,
      parameters,
      pipeline,
    }

    // Download as file
    const blob = new Blob([JSON.stringify(yamlContent, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pipeline.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [nodes, parameters])

  const handleAddTask = useCallback((task: TaskInfo, position?: { x: number; y: number }) => {
    // Snapshot before change for undo
    snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

    // Build inputs from task schema - use empty string as placeholder for variable reference
    const inputs: Record<string, string> = {}
    const inputTypes: Record<string, DataType> = {}
    if (task.inputs) {
      Object.entries(task.inputs).forEach(([key, schema]) => {
        inputs[key] = ''
        if (schema.type) {
          inputTypes[key] = schema.type
        }
      })
    }

    // Build outputs from task schema
    const outputs: Record<string, string> = {}
    const outputTypes: Record<string, DataType> = {}
    if (task.outputs) {
      Object.entries(task.outputs).forEach(([key, schema]) => {
        outputs[key] = ''
        if (schema.type) {
          outputTypes[key] = schema.type
        }
      })
    }

    // Build args from task schema with default values
    const args: Record<string, unknown> = {}
    if (task.args) {
      Object.entries(task.args).forEach(([key, schema]) => {
        if (schema.default !== undefined) {
          args[key] = schema.default
        }
      })
    }

    // Generate unique name - avoid duplicates
    const existingNames = new Set(
      nodesRef.current
        .filter((n) => n.type === 'step')
        .map((n) => (n.data as StepData).name)
    )
    let stepName = task.name
    if (existingNames.has(stepName)) {
      let counter = 2
      while (existingNames.has(`${task.name}_${counter}`)) {
        counter++
      }
      stepName = `${task.name}_${counter}`
    }

    const newNode: StepNode = {
      id: `step_${Date.now()}`,
      type: 'step',
      position: position ?? { x: 400, y: 100 + nodes.length * 50 },
      data: {
        name: stepName,
        task: task.path,
        inputs,
        outputs,
        args,
        optional: false,
        disabled: false,
        inputTypes: Object.keys(inputTypes).length > 0 ? inputTypes : undefined,
        outputTypes: Object.keys(outputTypes).length > 0 ? outputTypes : undefined,
      },
    }
    setNodes((nds) => [...nds, newNode])
  }, [nodes.length, setNodes, snapshot])

  const handleAddData = useCallback((dataType: DataType, position?: { x: number; y: number }) => {
    // Snapshot before change for undo
    snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })
    const dataCount = nodes.filter((n) => n.type === 'data').length

    // Generate unique name - avoid duplicates
    const existingNames = new Set(
      nodesRef.current
        .filter((n) => n.type === 'data')
        .map((n) => (n.data as DataNodeData).name)
    )
    let dataName = `new_${dataType}`
    if (existingNames.has(dataName)) {
      let counter = 2
      while (existingNames.has(`new_${dataType}_${counter}`)) {
        counter++
      }
      dataName = `new_${dataType}_${counter}`
    }

    // Generate key from name
    const key = dataName.toLowerCase().replace(/\s+/g, '_')
    const newNode: DataNode = {
      id: `data_${Date.now()}`,
      type: 'data',
      position: position ?? { x: 50, y: 50 + dataCount * 80 },
      data: {
        key,
        name: dataName,
        type: dataType,
        path: '',
      },
    }
    setNodes((nds) => [...nds, newNode])
  }, [nodes, setNodes, snapshot])

  const handleUpdateNode = useCallback((id: string, data: Partial<StepData | DataNodeData>) => {
    // Check if this is a data node path change
    const node = nodesRef.current.find(n => n.id === id)
    const isDataPathChange = node?.type === 'data' && 'path' in data

    // Debounced snapshot to avoid flooding history with keystroke micro-changes
    debouncedSnapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

    // Reset exists to undefined when path changes (shows "checking" state)
    const finalData = isDataPathChange
      ? { ...data, exists: undefined }
      : data

    setNodes((nds) =>
      nds.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...finalData } } : node
      ) as PipelineNode[]
    )

    // Trigger debounced path check for data nodes
    if (isDataPathChange && data.path) {
      debouncedPathCheck(id, data.path as string)
    }
  }, [setNodes, debouncedSnapshot, debouncedPathCheck])

  const handleDeleteNode = useCallback((id: string) => {
    // Snapshot before change for undo
    snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

    // If deleting a parameter node, clear any arg references in connected steps
    const nodeToDelete = nodesRef.current.find((n) => n.id === id)
    if (nodeToDelete?.type === 'parameter') {
      // Find all edges from this parameter to step args
      const paramEdges = edgesRef.current.filter(
        (e) => e.source === id && e.targetHandle
      )

      if (paramEdges.length > 0) {
        // Clear the arg values in affected steps
        setNodes((nds) =>
          nds
            .filter((node) => node.id !== id)
            .map((node) => {
              if (node.type !== 'step') return node

              const affectedEdge = paramEdges.find((e) => e.target === node.id)
              if (!affectedEdge || !affectedEdge.targetHandle) return node

              const stepData = node.data as StepData
              const newArgs = { ...(stepData.args || {}) }
              newArgs[affectedEdge.targetHandle] = ''
              return { ...node, data: { ...stepData, args: newArgs } }
            })
        )
      } else {
        setNodes((nds) => nds.filter((node) => node.id !== id))
      }
    } else {
      setNodes((nds) => nds.filter((node) => node.id !== id))
    }

    setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id))
    setSelectedNodes((sel) => sel.filter((n) => n.id !== id))
  }, [setNodes, setEdges, snapshot])

  // Handle disconnecting a parameter from a step arg
  const handleDisconnectArg = useCallback((stepId: string, argKey: string) => {
    // Snapshot for undo
    snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

    // Remove the edge connecting parameter to this arg
    setEdges((eds) =>
      eds.filter((edge) => !(edge.target === stepId && edge.targetHandle === argKey))
    )

    // Update the step's arg to empty string (user can now edit it)
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === stepId && node.type === 'step') {
          const newArgs = { ...(node.data.args || {}) }
          newArgs[argKey] = '' // Clear the value
          return { ...node, data: { ...node.data, args: newArgs } }
        }
        return node
      })
    )
  }, [snapshot, setEdges, setNodes])

  // Handle trashing variable data
  const handleTrashData = useCallback(async (variableName: string) => {
    const result = await trashData(variableName)
    if (result.success) {
      // Refresh variable status to update the UI
      await refreshVariableStatus()
    } else {
      alert(`Failed to trash data: ${result.message}`)
    }
  }, [trashData, refreshVariableStatus])

  // Handle showing the clean dialog
  const handleShowCleanDialog = useCallback(async () => {
    const preview = await previewClean()
    if (preview) {
      setCleanPreview(preview)
      setShowCleanDialog(true)
    }
  }, [previewClean])

  // Handle cleaning all data
  const handleClean = useCallback(async (mode: 'trash' | 'permanent') => {
    setCleanLoading(true)
    try {
      const result = await cleanAllData(mode)
      if (result) {
        setShowCleanDialog(false)
        setCleanPreview(null)
        // Refresh variable status and freshness to update the UI
        await refreshVariableStatus()
        refreshFreshness()
        if (result.failed_count > 0) {
          alert(`Cleaned ${result.cleaned_count} file(s), but ${result.failed_count} failed.`)
        }
      }
    } finally {
      setCleanLoading(false)
    }
  }, [cleanAllData, refreshVariableStatus, refreshFreshness])

  // Handle closing the clean dialog
  const handleCloseCleanDialog = useCallback(() => {
    setShowCleanDialog(false)
    setCleanPreview(null)
  }, [])

  // Handle refreshing pipeline list
  const handleRefreshPipelines = useCallback(async () => {
    setPipelinesLoading(true)
    const pipelineList = await listPipelines()
    setPipelines(pipelineList)
    setPipelinesLoading(false)
  }, [listPipelines])

  // Perform the actual pipeline switch
  const performOpenPipeline = useCallback(async (pipelinePath: string) => {
    // Check if any step is currently running
    const hasRunningSteps = Object.values(independentStepStatuses).some(
      (status) => status === 'running'
    )
    if (hasRunningSteps) {
      alert('Cannot switch pipelines while steps are running. Please wait for execution to complete.')
      return
    }

    // Call backend to switch pipeline
    const result = await openPipeline(pipelinePath)
    if (!result.success) {
      alert(`Failed to open pipeline: ${result.error}`)
      return
    }

    // Set loading flag to skip change tracking during reload
    isLoadingRef.current = true

    // Clear current state
    skipNextChangeTrackingRef.current = true
    setNodes([])
    setEdges([])
    setParameters({})
    setHasChanges(false)
    clearHistory()
    setValidationWarnings([])
    setTerminalVisible(false)
    setStepTerminalOutputs(new Map())

    // Update config path
    setConfigPath(result.configPath || null)

    // Reload tasks from new directory
    const loadedTasks = await loadTasks()
    setTasks(loadedTasks)

    // Load the new pipeline
    if (result.configPath) {
      const graph = await loadConfig(result.configPath)
      if (graph) {
        // Apply Dagre layout if no saved layout
        let layoutedNodes = graph.hasLayout
          ? graph.nodes
          : applyDagreLayout(graph.nodes as Node[], graph.edges) as PipelineNode[]
        // Enrich step nodes with type information
        layoutedNodes = enrichStepNodesWithTypes(layoutedNodes, loadedTasks)
        setNodes(layoutedNodes)
        setEdges(graph.edges)
        setParameters(graph.parameters)

        // Load editor options
        if (graph.editor) {
          setSkipSaveConfirmation(graph.editor.autoSave ?? false)
        }

        // Load execution options
        if (graph.execution) {
          setParallelEnabled(graph.execution.parallel ?? false)
          setMaxWorkers(graph.execution.maxWorkers ?? null)
        } else {
          setParallelEnabled(false)
          setMaxWorkers(null)
        }

        // Check file existence
        const status = await loadDataStatus()
        if (Object.keys(status).length > 0) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.type === 'data') {
                const data = node.data as DataNodeData
                const exists = status[data.key]
                if (exists !== undefined) {
                  return { ...node, data: { ...data, exists } }
                }
              }
              if (node.type === 'step') {
                const data = node.data as StepData
                const allExist = checkStepCompleted(data, status)
                if (allExist) {
                  return { ...node, data: { ...data, executionState: 'completed' as StepExecutionState } }
                }
              }
              return node
            })
          )
        }

        // Fetch freshness status
        refreshFreshness()

        // Validate the loaded config
        const validationResult = await validateConfig(result.configPath)
        if (validationResult.warnings.length > 0) {
          setValidationWarnings(validationResult.warnings)
          setShowWarnings(true)
        }
      }
    }

    // Update URL hash to reflect the opened pipeline
    const matched = pipelines.find(p => p.path === pipelinePath)
    programmaticHashChangeRef.current = true
    if (matched && matched.relative_path) {
      window.location.hash = `/pipeline/${matched.relative_path}`
    } else {
      window.location.hash = ''
    }

    // Mark loading as complete
    isLoadingRef.current = false
  }, [openPipeline, independentStepStatuses, pipelines, setNodes, setEdges, clearHistory, loadTasks, loadConfig, loadDataStatus, validateConfig, refreshFreshness])

  // Listen for hash changes (browser back/forward) to navigate between pipelines
  useEffect(() => {
    if (!isWorkspaceMode) return

    const handleHashChange = () => {
      // Skip if we triggered this hash change programmatically
      if (programmaticHashChangeRef.current) {
        programmaticHashChangeRef.current = false
        return
      }

      const hash = window.location.hash.replace(/^#\/?/, '')
      const pipelineMatch = hash.match(/^pipeline\/(.+)$/)

      if (pipelineMatch) {
        const relativePath = pipelineMatch[1]
        const matched = pipelines.find(p => p.relative_path === relativePath)
        if (matched) {
          performOpenPipeline(matched.path)
        }
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [isWorkspaceMode, pipelines, performOpenPipeline])

  // Handle pipeline selection from browser (checks for unsaved changes)
  const handleSelectPipeline = useCallback((pipelinePath: string) => {
    // Find the pipeline info for the dialog
    const pipeline = pipelines.find(p => p.path === pipelinePath)
    if (!pipeline) return

    // If current pipeline has unsaved changes, show dialog
    if (hasChanges) {
      setPendingPipeline(pipeline)
      setShowUnsavedDialog(true)
    } else {
      // No unsaved changes, switch directly
      performOpenPipeline(pipelinePath)
    }
  }, [pipelines, hasChanges, performOpenPipeline])

  // Handle unsaved changes dialog actions
  const handleUnsavedSave = useCallback(async () => {
    setShowUnsavedDialog(false)
    if (pendingPipeline) {
      await performSave()
      performOpenPipeline(pendingPipeline.path)
      setPendingPipeline(null)
    }
  }, [pendingPipeline, performSave, performOpenPipeline])

  const handleUnsavedDontSave = useCallback(() => {
    setShowUnsavedDialog(false)
    if (pendingPipeline) {
      performOpenPipeline(pendingPipeline.path)
      setPendingPipeline(null)
    }
  }, [pendingPipeline, performOpenPipeline])

  const handleUnsavedCancel = useCallback(() => {
    setShowUnsavedDialog(false)
    setPendingPipeline(null)
  }, [])

  // Handle step execution state changes
  const handleStepStatusChange = useCallback((stepName: string, state: StepExecutionState) => {
    // Runtime-only change - don't mark document as dirty
    skipNextChangeTrackingRef.current = true
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'step' && (node.data as StepData).name === stepName) {
          return { ...node, data: { ...node.data, executionState: state } }
        }
        return node
      })
    )
  }, [setNodes])

  // Reset all step execution states (kept for future use)
  const _resetStepStates = useCallback(() => {
    // Runtime-only change - don't mark document as dirty
    skipNextChangeTrackingRef.current = true
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'step') {
          return { ...node, data: { ...node.data, executionState: 'idle' as StepExecutionState } }
        }
        return node
      }) as PipelineNode[]
    )
  }, [setNodes])

  // Execution handlers
  const handleRun = useCallback(async (
    mode: RunMode,
    stepName?: string,
    variableName?: string,
    stepNames?: string[],
    groupName?: string,
  ) => {
    // Handle unsaved changes before running
    if (configPath && hasChanges) {
      if (skipSaveConfirmation) {
        // Auto-save enabled - save without prompting
        await performSave()
      } else {
        // Ask user
        const shouldSave = window.confirm('You have unsaved changes. Save before running?')
        if (shouldSave) {
          await performSave()
        } else {
          return // Don't run if user declines to save
        }
      }
    }
    // Don't reset all steps - server sends per-step status updates (RUNNING, SUCCESS, FAILED)
    // Only clear parallel mode outputs
    if (mode === 'parallel') {
      setStepTerminalOutputs(new Map())
    }
    setTerminalVisible(true)
    // Create a new request object to trigger the terminal
    setRunRequest({ mode, step_name: stepName, data_name: variableName, step_names: stepNames, group_name: groupName })
  }, [configPath, hasChanges, skipSaveConfirmation, performSave])

  // Handle per-step terminal output (for parallel execution)
  // Processes carriage returns (\r) to simulate terminal overwrite behavior (for tqdm etc.)
  const handleStepOutput = useCallback((stepName: string, output: string) => {
    setStepTerminalOutputs((prev) => {
      const next = new Map(prev)
      const existing = next.get(stepName) || ''
      const combined = existing + output

      // Process carriage returns: for each line, keep only content after last \r
      const processedLines = combined.split('\n').map(line => {
        const lastCR = line.lastIndexOf('\r')
        return lastCR >= 0 ? line.slice(lastCR + 1) : line
      })

      next.set(stepName, processedLines.join('\n'))
      return next
    })
  }, [])

  const handleToggleTerminal = useCallback(() => {
    setTerminalVisible((v) => !v)
  }, [])

  // Run a single step independently (concurrent execution)
  const handleRunStepIndependent = useCallback(async (stepName: string) => {
    // Handle unsaved changes before running
    if (configPath && hasChanges) {
      if (skipSaveConfirmation) {
        // Auto-save enabled - save without prompting
        await performSave()
      } else {
        // Ask user
        const shouldSave = window.confirm('You have unsaved changes. Save before running?')
        if (shouldSave) {
          await performSave()
        } else {
          return // Don't run if user declines to save
        }
      }
    }
    setActiveTerminalStep(stepName)
    setTerminalVisible(true)
    runStepIndependent(stepName)
  }, [configPath, hasChanges, skipSaveConfirmation, performSave, runStepIndependent])

  // Cancel a specific step
  const handleCancelStepIndependent = useCallback((stepName: string) => {
    cancelStepIndependent(stepName)
  }, [cancelStepIndependent])

  // Handle selection change - set active terminal step when a step is selected
  // Wrap onNodesChange to detect drag start and create snapshot
  const handleNodesChange = useCallback(
    (changes: NodeChange<PipelineNode>[]) => {
      // Filter out changes for synthetic group nodes — they live only in Canvas's
      // displayNodes useMemo and must never be written back to the nodes state
      const realChanges = changes.filter((c) => !('id' in c && c.id.startsWith('_group_')))

      // Check for drag start
      for (const change of realChanges) {
        if (change.type === 'position' && 'dragging' in change) {
          if (change.dragging === true && !isDraggingRef.current) {
            // Drag started - snapshot BEFORE drag begins
            isDraggingRef.current = true
            snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })
          } else if (change.dragging === false && isDraggingRef.current) {
            // Drag ended
            isDraggingRef.current = false
          }
        }
      }

      // Pass through to original handler
      onNodesChange(realChanges)
    },
    [onNodesChange, snapshot]
  )

  const handleSelectionChange = useCallback((nodes: PipelineNode[]) => {
    setSelectedNodes(nodes)
    // If a single step is selected, show its terminal output
    if (nodes.length === 1 && nodes[0].type === 'step') {
      setActiveTerminalStep((nodes[0].data as StepData).name)
    }
  }, [])

  const handleNodeDoubleClick = useCallback((node: PipelineNode) => {
    if (node.type === 'data') {
      const dataNode = node.data as DataNodeData
      if (dataNode.path) {
        // If file doesn't exist, show pulse error animation
        if (dataNode.exists === false) {
          // Runtime-only change - don't mark document as dirty
          skipNextChangeTrackingRef.current = true
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id
                ? { ...n, data: { ...n.data, pulseError: true } }
                : n
            ) as PipelineNode[]
          )
          // Clear the pulse after animation completes (0.4s * 3 = 1.2s)
          setTimeout(() => {
            // Runtime-only change - don't mark document as dirty
            skipNextChangeTrackingRef.current = true
            setNodes((nds) =>
              nds.map((n) =>
                n.id === node.id
                  ? { ...n, data: { ...n.data, pulseError: false } }
                  : n
              ) as PipelineNode[]
            )
          }, 1300)
        } else {
          openPath(dataNode.path)
        }
      }
    }
  }, [openPath, setNodes])

  const handleUpdateParameter = useCallback((name: string, value: unknown) => {
    // Debounced snapshot to avoid flooding history with keystroke micro-changes
    debouncedSnapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

    setParameters((prev) => ({ ...prev, [name]: value }))

    // Also update all parameter nodes with this name to keep them in sync
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'parameter' && node.data.name === name) {
          return {
            ...node,
            data: { ...node.data, value },
          }
        }
        return node
      })
    )
  }, [debouncedSnapshot, setNodes])

  // Handler for dropping parameters from sidebar onto canvas
  const handleParameterDrop = useCallback(
    (name: string, value: unknown, position: { x: number; y: number }) => {
      // Snapshot for undo
      snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })

      // Create a new parameter node at the drop position
      const newNode: ParameterNode = {
        id: `param_${name}_${Date.now()}`,
        type: 'parameter',
        position,
        data: { name, value },
      }

      setNodes((nds) => [...nds, newNode])
      setHasChanges(true)
    },
    [snapshot, setNodes]
  )

  // Sidebar resize handlers
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX
      setSidebarWidth(Math.max(200, Math.min(500, startWidth + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const handlePropertiesResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = propertiesWidth

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX // Reversed because dragging left increases width
      setPropertiesWidth(Math.max(250, Math.min(600, startWidth + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [propertiesWidth])

  // Compute eligibility for selected step(s)
  const selectedStepId = selectedStepNodes.length === 1 ? selectedStepNodes[0].id : null
  const selectedStepEligibility = selectedStepId ? runEligibility.get(selectedStepId) : undefined
  const selectedStepIds = selectedStepNodes.map((n) => n.id)
  const parallelEligibility =
    selectedStepIds.length > 1
      ? getParallelRunEligibility(selectedStepIds, nodes, edges, independentStepStatuses)
      : undefined
  // For group eligibility, use only the group's own member IDs (not neighbor nodes)
  const groupStepIds = useMemo(() => {
    if (!detectedGroupName) return []
    return nodes
      .filter(n => n.type === 'step' && (n.data as StepData).group === detectedGroupName)
      .map(n => n.id)
  }, [detectedGroupName, nodes])
  const groupEligibility =
    groupStepIds.length > 1
      ? getGroupRunEligibility(groupStepIds, nodes, edges, independentStepStatuses)
      : undefined

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Toolbar
        configPath={configPath}
        onSave={handleSave}
        onExport={handleExport}
        onClean={handleShowCleanDialog}
        saving={loading}
        hasChanges={hasChanges}
        selectedStepName={selectedStepName}
        selectedStepNames={selectedStepNames}
        selectedDataKey={selectedDataKey}
        executionStatus={executionStatus}
        onRun={handleRun}
        onRunStep={handleRunStepIndependent}
        onToggleTerminal={handleToggleTerminal}
        onUndo={() => undo(getCurrentState())}
        onRedo={() => redo(getCurrentState())}
        canUndo={canUndo}
        canRedo={canRedo}
        showParameterNodes={showParameterNodes}
        onToggleParameterNodes={() => setShowParameterNodes((v) => !v)}
        onAutoLayout={handleAutoLayout}
        skipSaveConfirmation={skipSaveConfirmation}
        onSkipSaveConfirmationChange={setSkipSaveConfirmation}
        parallelEnabled={parallelEnabled}
        onParallelEnabledChange={setParallelEnabled}
        maxWorkers={maxWorkers}
        onMaxWorkersChange={setMaxWorkers}
        stepEligibility={selectedStepEligibility}
        parallelEligibility={parallelEligibility}
        groupEligibility={groupEligibility}
        detectedGroupName={detectedGroupName}
      />

      {/* Validation suggestions banner */}
      {showWarnings && validationWarnings.length > 0 && (
        <div className="bg-slate-200/80 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-700 px-4 py-2">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-500 dark:text-sky-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-slate-700 dark:text-slate-200 text-sm font-medium">
                  Type Suggestions ({validationWarnings.length})
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-xs">
                  - Consider using typed data nodes for better validation
                </span>
                {validationWarnings.length > 3 && (
                  <button
                    onClick={() => setExpandWarnings(!expandWarnings)}
                    className="text-sky-500 hover:text-sky-400 dark:text-sky-400 dark:hover:text-sky-300 text-xs ml-2"
                  >
                    {expandWarnings ? 'Show less' : 'Show all'}
                  </button>
                )}
                <span className="text-slate-400 dark:text-slate-500 text-xs ml-auto">
                  (Full list in browser console)
                </span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(expandWarnings ? validationWarnings : validationWarnings.slice(0, 3)).map((warning, index) => (
                  <div key={index} className="text-slate-600 dark:text-slate-300 text-xs flex items-start gap-2">
                    {warning.level === 'error' ? (
                      <XCircle className="w-3 h-3 text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    ) : warning.level === 'warning' ? (
                      <AlertTriangle className="w-3 h-3 text-amber-500 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Info className="w-3 h-3 text-sky-500 dark:text-sky-400 mt-0.5 flex-shrink-0" />
                    )}
                    <span>
                      {warning.step && <span className="text-slate-500 dark:text-slate-400 font-medium">[{warning.step}]</span>}{' '}
                      {warning.message}
                    </span>
                  </div>
                ))}
                {!expandWarnings && validationWarnings.length > 3 && (
                  <div className="text-slate-400 dark:text-slate-500 text-xs">
                    ...and {validationWarnings.length - 3} more
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowWarnings(false)}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar with collapsible toggle strip */}
          <div
            style={{ width: leftCollapsed ? 0 : sidebarWidth }}
            className="flex-shrink-0 overflow-hidden transition-[width] duration-150 h-full flex flex-col"
          >
            <Sidebar
              tasks={tasks}
              onAddTask={handleAddTask}
              onAddData={handleAddData}
              parameters={parameters}
              onUpdateParameter={handleUpdateParameter}
              onAddParameter={handleUpdateParameter}
              isWorkspaceMode={isWorkspaceMode}
              pipelines={pipelines}
              currentPipelinePath={configPath}
              onSelectPipeline={handleSelectPipeline}
              onRefreshPipelines={handleRefreshPipelines}
              pipelinesLoading={pipelinesLoading}
            />
          </div>

          {/* Left toggle strip: collapse button + drag-resize handle */}
          <div className="w-3 flex-shrink-0 flex flex-col h-full">
            <button
              onClick={() => setLeftCollapsed((v) => !v)}
              className="h-8 flex items-center justify-center bg-slate-200 dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-600 border-b border-slate-300 dark:border-slate-700 flex-shrink-0 transition-colors text-slate-500 dark:text-slate-400 hover:text-white"
              title={leftCollapsed ? 'Expand sidebar (Ctrl+Tab)' : 'Collapse sidebar (Ctrl+Tab)'}
            >
              {leftCollapsed
                ? <ChevronRight className="w-3 h-3" />
                : <ChevronLeft className="w-3 h-3" />
              }
            </button>
            {!leftCollapsed && (
              <div
                className="flex-1 bg-slate-300 dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-600 cursor-ew-resize transition-colors"
                onMouseDown={handleSidebarResize}
              />
            )}
          </div>

          <Canvas
            nodes={nodes}
            edges={edges}
            tasks={tasks}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onSelectionChange={handleSelectionChange}
            onSnapshot={() => snapshot({ nodes: nodesRef.current, edges: edgesRef.current, parameters: parametersRef.current })}
            onNodeDoubleClick={handleNodeDoubleClick}
            onParameterDrop={handleParameterDrop}
            hideParameterNodes={!showParameterNodes}
            selectedNodes={selectedNodes}
            detectedGroupName={detectedGroupName}
            onAddTask={handleAddTask}
            onAddData={handleAddData}
          />

          {/* Right toggle strip: drag-resize handle + collapse button */}
          <div className="w-3 flex-shrink-0 flex flex-col h-full">
            <button
              onClick={() => setRightCollapsed((v) => !v)}
              className="h-8 flex items-center justify-center bg-slate-200 dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-600 border-b border-slate-300 dark:border-slate-700 flex-shrink-0 transition-colors text-slate-500 dark:text-slate-400 hover:text-white"
              title={rightCollapsed ? 'Expand panel (Ctrl+Tab)' : 'Collapse panel (Ctrl+Tab)'}
            >
              {rightCollapsed
                ? <ChevronLeft className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
            </button>
            {!rightCollapsed && (
              <div
                className="flex-1 bg-slate-300 dark:bg-slate-800 hover:bg-blue-500 dark:hover:bg-blue-600 cursor-ew-resize transition-colors"
                onMouseDown={handlePropertiesResize}
              />
            )}
          </div>

          {/* Right sidebar with collapsible toggle */}
          <div
            style={{ width: rightCollapsed ? 0 : propertiesWidth }}
            className="flex-shrink-0 overflow-hidden transition-[width] duration-150 h-full flex flex-col"
          >
            <PropertiesPanel
              selectedNode={selectedNode}
              edges={edges}
              onUpdateNode={handleUpdateNode}
              onDeleteNode={handleDeleteNode}
              onUpdateParameter={handleUpdateParameter}
              onDisconnectArg={handleDisconnectArg}
              onTrashData={handleTrashData}
              onRunStep={handleRunStepIndependent}
              onCancelStep={handleCancelStepIndependent}
              getStepStatus={getIndependentStepStatus}
              parameters={parameters}
              tasks={tasks}
              runEligibility={selectedStepEligibility}
              freshness={selectedStepName ? freshness.get(selectedStepName) : undefined}
            />
          </div>
        </div>

        <TerminalPanel
          visible={terminalVisible}
          onToggle={handleToggleTerminal}
          onStatusChange={setExecutionStatus}
          onStepStatusChange={handleStepStatusChange}
          onStepOutput={handleStepOutput}
          runRequest={runRequest}
          activeTerminalStep={activeTerminalStep}
          stepOutputs={stepTerminalOutputs}
          stepStatuses={independentStepStatuses}
          onCancelStep={cancelStepIndependent}
          onClearStepOutput={(stepName) => {
            setStepTerminalOutputs((prev) => {
              const next = new Map(prev)
              next.delete(stepName)
              return next
            })
          }}
        />
      </div>

      {/* Auto-layout confirmation dialog */}
      {showAutoLayoutConfirm && (
        <AutoLayoutConfirmDialog
          onConfirm={() => { setShowAutoLayoutConfirm(false); performAutoLayoutAndSave() }}
          onCancel={() => setShowAutoLayoutConfirm(false)}
        />
      )}

      {/* Save confirmation dialog */}
      {showSaveDialog && (
        <ConfirmDialog
          title="Save changes?"
          message="Are you sure you want to save the current pipeline configuration?"
          onYes={handleSaveConfirm}
          onNo={handleSaveCancel}
          onYesAndRemember={handleSaveConfirmAndRemember}
        />
      )}

      {/* Clean data dialog */}
      {showCleanDialog && cleanPreview && (
        <CleanDialog
          preview={cleanPreview}
          loading={cleanLoading}
          onCancel={handleCloseCleanDialog}
          onClean={handleClean}
        />
      )}

      {/* Unsaved changes dialog */}
      {showUnsavedDialog && pendingPipeline && (
        <UnsavedChangesDialog
          pipelineName={pendingPipeline.name}
          onSave={handleUnsavedSave}
          onDontSave={handleUnsavedDontSave}
          onCancel={handleUnsavedCancel}
        />
      )}
    </div>
  )
}
