import {
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  SelectionMode,
  type OnConnect,
  type OnReconnect,
  type OnNodesChange,
  type OnEdgesChange,
  type Edge,
  type ReactFlowInstance,
  type Viewport,
  type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import StepNode from './StepNode'
import ParameterNode from './ParameterNode'
import DataNode from './DataNode'
import GroupNode from './GroupNode'
import ConditionNode from './ConditionNode'
import SwitchNode from './SwitchNode'
import FeedbackEdge from './FeedbackEdge'
import ContainmentEdge from './ContainmentEdge'
import NodeHotbox from './NodeHotbox'
import FilePickerPopup from './FilePickerPopup'
import NewFileConfirmDialog from './NewFileConfirmDialog'
import type {
  PipelineNode,
  StepData,
  ParameterData,
  DataNodeData,
  ConditionData,
  SwitchData,
  LogicStatus,
  TaskInfo,
  DataNode as DataNodeType,
  DataType,
  LoopConfig,
  GroupNode as GroupNodeType,
  FeedbackEdgeData,
  DataFileEntry,
} from '../types/pipeline'
import { buildDependencyGraph } from '../utils/dependencyGraph'
import { conditionInputsAvailable, resolvedSwitchBranches } from '../utils/logicBranches'
import { estimateParamWidth, estimateStepHeight } from '../utils/layout'
import {
  clearDataRefsForEdges,
  clearStepRef,
  createNestedDataNode,
  createOutputDataNode,
  setStepRef,
} from '../utils/dataNodeCreation'
import { HighlightContext } from '../contexts/HighlightContext'

const nodeTypes = {
  step: StepNode,
  parameter: ParameterNode,
  data: DataNode,
  group: GroupNode,
  condition: ConditionNode,
  switch: SwitchNode,
}

const edgeTypes = {
  feedback: FeedbackEdge,
  containment: ContainmentEdge,
}

// Color palette for group rectangles (in order of appearance)
const GROUP_COLORS = [
  '#a5b4fc',
  '#f9a8d4',
  '#5eead4',
  '#fdba74',
  '#c4b5fd',
  '#67e8f9',
  '#bef264',
  '#fda4af',
]

/**
 * Deep clones a node, including nested data objects.
 * Uses structuredClone for proper deep copying.
 */
function deepCloneNode(node: PipelineNode): PipelineNode {
  try {
    return structuredClone(node)
  } catch {
    // Fallback for environments without structuredClone
    return JSON.parse(JSON.stringify(node))
  }
}

/**
 * Fallback dimensions used before React Flow has measured a node. These are only
 * needed for the very first render; once measured, the real rendered size is used.
 */
const FALLBACK_NODE_WIDTH = 250
const FALLBACK_NODE_HEIGHT = 150
const FALLBACK_PARAM_WIDTH = 160
const FALLBACK_PARAM_HEIGHT = 70
const FALLBACK_DATA_WIDTH = 180
const FALLBACK_DATA_HEIGHT = 90

/**
 * Resolve the rendered size of a node for group bounding-box math. React Flow
 * writes the measured size back onto each node after the first layout pass, so
 * prefer that; fall back to per-type estimates only until measurement lands.
 * Using a fixed 250x150 for every node is what made group rectangles clip tall
 * step nodes and parameters.
 */
function getNodeDimensions(node: PipelineNode): { width: number; height: number } {
  const measuredWidth = node.measured?.width
  const measuredHeight = node.measured?.height
  if (measuredWidth != null && measuredHeight != null) {
    return { width: measuredWidth, height: measuredHeight }
  }
  if (node.width != null && node.height != null) {
    return { width: node.width, height: node.height }
  }
  if (node.type === 'parameter') {
    const data = node.data as Record<string, unknown>
    return {
      width: Math.max(FALLBACK_PARAM_WIDTH, estimateParamWidth(data)),
      height: FALLBACK_PARAM_HEIGHT,
    }
  }
  if (node.type === 'data') {
    return { width: FALLBACK_DATA_WIDTH, height: FALLBACK_DATA_HEIGHT }
  }
  const data = node.data as Record<string, unknown>
  return {
    width: FALLBACK_NODE_WIDTH,
    height: Math.max(FALLBACK_NODE_HEIGHT, estimateStepHeight(data)),
  }
}

interface CanvasProps {
  nodes: PipelineNode[]
  edges: Edge[]
  tasks: TaskInfo[]
  onNodesChange: OnNodesChange<PipelineNode>
  onEdgesChange: OnEdgesChange<Edge>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  onSelectionChange: (selectedNodes: PipelineNode[]) => void
  onEdgeSelect?: (edge: Edge | null) => void
  onSnapshot?: () => void
  onNodeDoubleClick?: (node: PipelineNode) => void
  onParameterDrop?: (name: string, value: unknown, position: { x: number; y: number }) => void
  hideParameterNodes?: boolean
  selectedNodes?: PipelineNode[]
  detectedGroupName?: string | null
  onAddTask?: (task: TaskInfo, position: { x: number; y: number }) => void
  onAddData?: (dataType: DataType, position: { x: number; y: number }) => void
  onAddCondition?: (predicate: string, position: { x: number; y: number }) => void
  onAddSwitch?: (position: { x: number; y: number }) => void
  parameters?: Record<string, unknown>
  multiPassGroups?: Record<string, unknown>
  setMultiPassGroups?: Dispatch<SetStateAction<Record<string, unknown>>>
  onEdgesDelete?: (edges: Edge[]) => void
  onCanvasInit?: (api: CanvasApi) => void
  inactiveNodeIds?: Set<string>
  inactiveEdgeIds?: Set<string>
  logicStatus?: LogicStatus
}

/**
 * Imperative helpers exposed to the parent so it can place sidebar-created
 * nodes in the middle of the current viewport instead of a fixed coordinate.
 */
export interface CanvasApi {
  getViewportCenter: () => { x: number; y: number }
}

export default function Canvas({
  nodes,
  edges,
  tasks,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectionChange: onSelectionChangeProp,
  onEdgeSelect,
  onSnapshot,
  onNodeDoubleClick,
  onParameterDrop,
  hideParameterNodes,
  selectedNodes,
  detectedGroupName,
  onAddTask,
  onAddData,
  onAddCondition,
  onAddSwitch,
  parameters,
  multiPassGroups,
  setMultiPassGroups,
  onEdgesDelete,
  onCanvasInit,
  inactiveNodeIds,
  inactiveEdgeIds,
  logicStatus,
}: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance<PipelineNode, Edge> | null>(null)

  // Track whether user is zoomed out past threshold for group/node z-swap
  const ZOOM_THRESHOLD = 0.4
  const [isZoomedOut, setIsZoomedOut] = useState(false)
  const onViewportChange = useCallback(
    ({ zoom }: Viewport) => setIsZoomedOut(zoom < ZOOM_THRESHOLD),
    [ZOOM_THRESHOLD],
  )

  // Mouse position tracking for hotbox placement
  const mousePositionRef = useRef({ x: 0, y: 0 })

  // Hotbox state
  const [hotbox, setHotbox] = useState<{
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
  } | null>(null)

  // Directory file-picker state: opened by dropping a directory data node's
  // output plug on empty canvas.
  const [filePicker, setFilePicker] = useState<{
    screenPosition: { x: number; y: number }
    flowPosition: { x: number; y: number }
    dirNodeId: string
  } | null>(null)

  // A file name the user typed that does not exist yet; awaits confirmation.
  const [pendingNewFile, setPendingNewFile] = useState<{
    name: string
    path: string
    dirNodeId: string
    dirKey: string
    flowPosition: { x: number; y: number }
  } | null>(null)

  // Store copied nodes and their edges for paste operation
  const copiedNodesRef = useRef<PipelineNode[]>([])
  const copiedEdgesRef = useRef<Edge[]>([])
  const selectedNodesRef = useRef<PipelineNode[]>([])
  const nodesRef = useRef<PipelineNode[]>(nodes)
  const edgesRef = useRef<Edge[]>(edges)

  // Keep refs updated to avoid stale closures in callbacks
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  // Copy/paste keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modifier = isMac ? e.metaKey : e.ctrlKey

      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (modifier && e.key === 'c') {
        // Copy selected nodes and their connected edges
        if (selectedNodesRef.current.length > 0) {
          const selectedIds = new Set(selectedNodesRef.current.map((n) => n.id))

          // Deep clone nodes to avoid sharing nested objects
          copiedNodesRef.current = selectedNodesRef.current.map(deepCloneNode)

          // Store edges connected to copied nodes (to external nodes only)
          // These will be recreated on paste to connect new nodes to same variables
          copiedEdgesRef.current = edgesRef.current.filter((edge) => {
            const sourceInSelection = selectedIds.has(edge.source)
            const targetInSelection = selectedIds.has(edge.target)
            // Keep edges that connect a selected node to an external node
            return (
              (sourceInSelection && !targetInSelection) || (!sourceInSelection && targetInSelection)
            )
          })
        }
      } else if (modifier && e.key === 'v') {
        // Paste copied nodes with edges
        if (copiedNodesRef.current.length > 0) {
          e.preventDefault()

          // Snapshot before paste for undo
          onSnapshot?.()

          // Create mapping from old node IDs to new node IDs
          const idMapping = new Map<string, string>()

          // Helper to generate unique name with suffix
          const getUniqueName = (baseName: string, existingNames: Set<string>): string => {
            if (!existingNames.has(baseName)) {
              return baseName
            }
            // Strip existing suffix like _2, _3 to get base
            const baseWithoutSuffix = baseName.replace(/_\d+$/, '')
            let counter = 2
            let newName = `${baseWithoutSuffix}_${counter}`
            while (existingNames.has(newName)) {
              counter++
              newName = `${baseWithoutSuffix}_${counter}`
            }
            return newName
          }

          // Collect existing names from current nodes
          setNodes((currentNodes) => {
            const existingNames = new Set(
              currentNodes
                .map((n) => (n.data as { name?: string }).name)
                .filter(Boolean) as string[],
            )

            const newNodes = copiedNodesRef.current.map((node): PipelineNode => {
              const timestamp = Date.now()
              const randomSuffix = Math.random().toString(36).substring(2, 6)
              const newId = `${node.type}_${timestamp}_${randomSuffix}`
              idMapping.set(node.id, newId)

              // Generate unique name
              const originalName = (node.data as { name?: string }).name || ''
              const uniqueName = getUniqueName(originalName, existingNames)
              existingNames.add(uniqueName) // Track for subsequent nodes in this paste

              return {
                ...node,
                id: newId,
                position: {
                  x: node.position.x + 50,
                  y: node.position.y + 50,
                },
                selected: false,
                data: { ...node.data, name: uniqueName },
              } as PipelineNode
            })

            // Recreate edges connecting new nodes to same external nodes
            const newEdges = copiedEdgesRef.current.map((edge) => {
              const newSource = idMapping.get(edge.source) || edge.source
              const newTarget = idMapping.get(edge.target) || edge.target
              return {
                ...edge,
                id: `e_${newSource}_${newTarget}`,
                source: newSource,
                target: newTarget,
              }
            })

            setEdges((eds) => [...eds, ...newEdges])

            // Update copied nodes positions and IDs for subsequent pastes (deep clone)
            copiedNodesRef.current = newNodes.map(deepCloneNode)

            // Update copied edges to reference new node IDs
            copiedEdgesRef.current = newEdges

            return [...currentNodes, ...newNodes]
          })
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [setNodes, setEdges, onSnapshot])

  // Tab key handler for hotbox toggle
  useEffect(() => {
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return

      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT'].includes(tag)) return

      e.preventDefault()

      if (hotbox) {
        setHotbox(null)
        return
      }

      // Check handlers are available and mouse is within canvas bounds
      if (!onAddTask || !onAddData) return
      if (!reactFlowWrapper.current || !reactFlowInstance.current) return
      const rect = reactFlowWrapper.current.getBoundingClientRect()
      const { x, y } = mousePositionRef.current
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return

      const flowPos = reactFlowInstance.current.screenToFlowPosition({ x, y })
      setHotbox({ screenPosition: { x, y }, flowPosition: flowPos })
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [hotbox, onAddTask, onAddData])

  const onConnect: OnConnect = useCallback(
    (params) => {
      onSnapshot?.()

      const srcNode = nodesRef.current.find((n) => n.id === params.source)
      const tgtNode = nodesRef.current.find((n) => n.id === params.target)

      // Ref carried by a source node's value/bool output.
      const sourceRef = (node: PipelineNode | undefined): string | null => {
        if (!node) return null
        if (node.type === 'data') return `$${(node.data as DataNodeData).key}`
        if (node.type === 'parameter') return `$${(node.data as ParameterData).name}`
        if (node.type === 'condition') return `$${(node.data as ConditionData).name}`
        return null
      }

      // --- Logic-board wiring (condition / switch) ---
      if (
        tgtNode?.type === 'condition' ||
        tgtNode?.type === 'switch' ||
        srcNode?.type === 'switch'
      ) {
        const addUniqueEdge = (edge: Edge) => {
          setEdges((eds) =>
            addEdge(
              edge,
              eds.filter(
                (e) => !(e.target === edge.target && e.targetHandle === edge.targetHandle),
              ),
            ),
          )
        }

        // Condition input <- data / parameter
        if (tgtNode?.type === 'condition' && params.targetHandle) {
          const ref = sourceRef(srcNode)
          if (!ref || !(srcNode?.type === 'data' || srcNode?.type === 'parameter')) {
            alert('Conditions can only take data or parameter inputs.')
            return
          }
          setNodes(
            (nds) =>
              nds.map((n) =>
                n.id === params.target && n.type === 'condition'
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        inputs: {
                          ...(n.data as ConditionData).inputs,
                          [params.targetHandle!]: ref,
                        },
                      },
                    }
                  : n,
              ) as PipelineNode[],
          )
          addUniqueEdge({
            id: `e_${params.source}_${params.target}_${params.targetHandle}`,
            source: params.source!,
            target: params.target!,
            sourceHandle: params.sourceHandle ?? undefined,
            targetHandle: params.targetHandle,
          })
          return
        }

        // Switch inputs: boolean condition + data payload
        if (tgtNode?.type === 'switch') {
          if (params.targetHandle === 'condition') {
            const ref = sourceRef(srcNode)
            if (!ref || !(srcNode?.type === 'condition' || srcNode?.type === 'parameter')) {
              alert('A switch condition must come from a condition node or a parameter.')
              return
            }
            setNodes(
              (nds) =>
                nds.map((n) =>
                  n.id === params.target && n.type === 'switch'
                    ? { ...n, data: { ...n.data, condition: ref } }
                    : n,
                ) as PipelineNode[],
            )
            addUniqueEdge({
              id: `e_${params.source}_${params.target}_condition`,
              source: params.source!,
              target: params.target!,
              sourceHandle: params.sourceHandle ?? undefined,
              targetHandle: 'condition',
            })
            return
          }
          if (params.targetHandle === 'data') {
            const ref = sourceRef(srcNode)
            if (!ref || srcNode?.type !== 'data') {
              alert('A switch payload must come from a data node.')
              return
            }
            setNodes(
              (nds) =>
                nds.map((n) =>
                  n.id === params.target && n.type === 'switch'
                    ? { ...n, data: { ...n.data, data: ref } }
                    : n,
                ) as PipelineNode[],
            )
            addUniqueEdge({
              id: `e_${params.source}_${params.target}_data`,
              source: params.source!,
              target: params.target!,
              sourceHandle: params.sourceHandle ?? undefined,
              targetHandle: 'data',
            })
            return
          }
        }

        // Switch branch -> step handle (gated execution)
        if (
          srcNode?.type === 'switch' &&
          (params.sourceHandle === 'then' || params.sourceHandle === 'else')
        ) {
          if (tgtNode?.type !== 'step' || !params.targetHandle) {
            alert('Switch branches can only connect to a step input or arg.')
            return
          }
          const ref = `$${(srcNode.data as SwitchData).name}.${params.sourceHandle}`
          setNodes(
            (nds) =>
              nds.map((n) => {
                if (n.id !== params.target || n.type !== 'step') return n
                const sd = n.data as StepData
                const isInput = params.targetHandle! in (sd.inputs || {})
                return {
                  ...n,
                  data: {
                    ...sd,
                    inputs: isInput ? { ...sd.inputs, [params.targetHandle!]: ref } : sd.inputs,
                    args: !isInput ? { ...sd.args, [params.targetHandle!]: ref } : sd.args,
                  },
                }
              }) as PipelineNode[],
          )
          addUniqueEdge({
            id: `e_${params.source}_${params.target}_${params.targetHandle}`,
            source: params.source!,
            target: params.target!,
            sourceHandle: params.sourceHandle,
            targetHandle: params.targetHandle,
          })
          return
        }

        alert('Invalid connection involving a condition or switch.')
        return
      }

      // If connecting a parameter to a step arg, validate and handle existing connections
      if (params.source && params.source.startsWith('param_') && params.targetHandle) {
        // Find the parameter node to get its name (use ref to avoid stale closure)
        const paramNode = nodesRef.current.find((n) => n.id === params.source)
        if (!paramNode || paramNode.type !== 'parameter') {
          // Invalid parameter node, don't create edge
          return
        }

        const paramName = (paramNode.data as ParameterData).name
        if (!paramName) {
          // Parameter has no name, don't create edge
          return
        }

        // Remove any existing parameter connection to this target handle
        setEdges((eds) => {
          const filtered = eds.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle &&
                e.source.startsWith('param_')
              ),
          )
          return addEdge(
            { ...params, id: `e_${params.source}_${params.target}_${params.targetHandle}` },
            filtered,
          )
        })

        // Update the target step's arg value
        setNodes(
          (nds) =>
            nds.map((node) => {
              if (node.id === params.target && node.type === 'step') {
                const stepData = node.data as StepData
                const newArgs = {
                  ...(stepData.args || {}),
                  [params.targetHandle!]: `$${paramName}`,
                }
                return { ...node, data: { ...stepData, args: newArgs } }
              }
              return node
            }) as PipelineNode[],
        )
      } else {
        // Get source and target nodes for validation
        const sourceNode = nodesRef.current.find((n) => n.id === params.source)
        const targetNode = nodesRef.current.find((n) => n.id === params.target)

        // Loop-over connection: data node → step (targetHandle = 'loop-over')
        if (params.targetHandle === 'loop-over' && targetNode?.type === 'step') {
          if (sourceNode?.type !== 'data') {
            alert('Loop "over" connections must come from a data node.')
            return
          }
          const dataKey = (sourceNode.data as DataNodeData).key
          setNodes(
            (nds) =>
              nds.map((node) => {
                if (node.id === params.target && node.type === 'step') {
                  const stepData = node.data as StepData
                  const loop: LoopConfig = {
                    ...(stepData.loop || { over: '', into: '' }),
                    over: `$${dataKey}`,
                  }
                  return { ...node, data: { ...stepData, loop } }
                }
                return node
              }) as PipelineNode[],
          )
          setEdges((eds) => {
            // Remove any existing loop-over edge for this step
            const filtered = eds.filter(
              (e) => !(e.target === params.target && e.targetHandle === 'loop-over'),
            )
            return addEdge(
              { ...params, id: `e_loop_over_${params.source}_${params.target}` },
              filtered,
            )
          })
          return
        }

        // Loop-into connection: step → data node (sourceHandle = 'loop-into')
        if (params.sourceHandle === 'loop-into' && sourceNode?.type === 'step') {
          if (targetNode?.type !== 'data') {
            alert('Loop "into" connections must go to a data node.')
            return
          }
          const dataKey = (targetNode.data as DataNodeData).key
          setNodes(
            (nds) =>
              nds.map((node) => {
                if (node.id === params.source && node.type === 'step') {
                  const stepData = node.data as StepData
                  const loop: LoopConfig = {
                    ...(stepData.loop || { over: '', into: '' }),
                    into: `$${dataKey}`,
                  }
                  return { ...node, data: { ...stepData, loop } }
                }
                return node
              }) as PipelineNode[],
          )
          setEdges((eds) => {
            // Remove any existing loop-into edge for this step
            const filtered = eds.filter(
              (e) => !(e.source === params.source && e.sourceHandle === 'loop-into'),
            )
            return addEdge(
              { ...params, id: `e_loop_into_${params.source}_${params.target}` },
              filtered,
            )
          })
          return
        }

        // Auto-create data node for step-to-step connections
        if (sourceNode?.type === 'step' && targetNode?.type === 'step') {
          // Require handles for proper connection
          if (!params.sourceHandle || !params.targetHandle) {
            return
          }

          // Infer data type from source output schema
          const sourceStepData = sourceNode.data as StepData
          const task = tasks.find((t) => t.path === sourceStepData.task)
          const outputSchema = task?.outputs[params.sourceHandle]
          const inferredType: DataType = outputSchema?.type || 'data_folder'

          // Generate unique key based on step name and output
          const baseKey = `${sourceStepData.name}_${params.sourceHandle}`
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
          const existingKeys = new Set(
            nodesRef.current
              .filter((n) => n.type === 'data')
              .map((n) => (n.data as DataNodeData).key),
          )
          let finalKey = baseKey
          let counter = 2
          while (existingKeys.has(finalKey)) {
            finalKey = `${baseKey}_${counter++}`
          }

          // Position at midpoint between source and target
          const midX = (sourceNode.position.x + targetNode.position.x) / 2
          const midY = (sourceNode.position.y + targetNode.position.y) / 2

          // Create the data node
          const dataNodeId = `data_${Date.now()}`
          const newDataNode: DataNodeType = {
            id: dataNodeId,
            type: 'data',
            position: { x: midX, y: midY },
            selected: true,
            data: {
              key: finalKey,
              name: finalKey,
              type: inferredType,
              path: '',
            },
          }

          // Create edges: source -> data, data -> target
          const edge1: Edge = {
            id: `e_${params.source}_${dataNodeId}_${params.sourceHandle}`,
            source: params.source!,
            target: dataNodeId,
            sourceHandle: params.sourceHandle,
            targetHandle: 'input',
          }
          const edge2: Edge = {
            id: `e_${dataNodeId}_${params.target}`,
            source: dataNodeId,
            target: params.target!,
            sourceHandle: 'value',
            targetHandle: params.targetHandle,
          }

          // Cycle detection with new node and edges
          const tempEdges = [...edgesRef.current, edge1, edge2]
          const graph = buildDependencyGraph([...nodesRef.current, newDataNode], tempEdges)
          if (graph.hasCycles()) {
            alert('Cannot create connection: this would create a circular dependency.')
            return
          }

          // Apply changes: add node (with selection), wire step refs, add edges
          setNodes((nds) => {
            const updated = nds.map((n): PipelineNode => {
              if (n.id === params.source && n.type === 'step') {
                return {
                  ...n,
                  selected: false,
                  data: setStepRef(n.data as StepData, params.sourceHandle!, finalKey, 'output'),
                }
              }
              if (n.id === params.target && n.type === 'step') {
                return {
                  ...n,
                  selected: false,
                  data: setStepRef(n.data as StepData, params.targetHandle!, finalKey, 'input'),
                }
              }
              return n.selected ? { ...n, selected: false } : n
            })
            return [...updated, newDataNode] as PipelineNode[]
          })
          setEdges((eds) => [...eds, edge1, edge2])

          // Notify App of selection change
          onSelectionChangeProp([newDataNode])
          return
        }

        // Data node connection validation
        if (sourceNode?.type === 'data' || targetNode?.type === 'data') {
          // Data → Data: Not allowed
          if (sourceNode?.type === 'data' && targetNode?.type === 'data') {
            alert('Cannot connect data nodes directly to each other.')
            return
          }

          // Parameter → Data: Not allowed
          if (sourceNode?.type === 'parameter' && targetNode?.type === 'data') {
            alert('Cannot connect parameters to data nodes.')
            return
          }

          // Data → Step input: Validate type match
          if (sourceNode?.type === 'data' && targetNode?.type === 'step' && params.targetHandle) {
            const dataType = (sourceNode.data as DataNodeData).type
            const stepData = targetNode.data as StepData
            const task = tasks.find((t) => t.path === stepData.task)
            const inputSchema = task?.inputs[params.targetHandle]

            if (inputSchema?.type && inputSchema.type !== dataType) {
              alert(
                `Type mismatch: data node is "${dataType}" but input expects "${inputSchema.type}"`,
              )
              return
            }

            // Write the $reference into the step's inputs/args so it persists
            const dataKey = (sourceNode.data as DataNodeData).key
            setNodes(
              (nds) =>
                nds.map((n) =>
                  n.id === params.target && n.type === 'step'
                    ? {
                        ...n,
                        data: setStepRef(
                          n.data as StepData,
                          params.targetHandle!,
                          dataKey,
                          'input',
                        ),
                      }
                    : n,
                ) as PipelineNode[],
            )
          }

          // Step output → Data: Validate type match
          if (sourceNode?.type === 'step' && targetNode?.type === 'data' && params.sourceHandle) {
            const dataType = (targetNode.data as DataNodeData).type
            const stepData = sourceNode.data as StepData
            const task = tasks.find((t) => t.path === stepData.task)
            const outputSchema = task?.outputs[params.sourceHandle]

            if (outputSchema?.type && outputSchema.type !== dataType) {
              alert(
                `Type mismatch: step output is "${outputSchema.type}" but data node is "${dataType}"`,
              )
              return
            }

            // Write the $reference into the step's outputs so it persists
            const dataKey = (targetNode.data as DataNodeData).key
            setNodes(
              (nds) =>
                nds.map((n) =>
                  n.id === params.source && n.type === 'step'
                    ? {
                        ...n,
                        data: setStepRef(
                          n.data as StepData,
                          params.sourceHandle!,
                          dataKey,
                          'output',
                        ),
                      }
                    : n,
                ) as PipelineNode[],
            )
          }
        }

        // Non-parameter connection - check for cycles before adding
        const tempEdge: Edge = {
          id: `e_${params.source}_${params.target}`,
          source: params.source!,
          target: params.target!,
          sourceHandle: params.sourceHandle ?? undefined,
          targetHandle: params.targetHandle ?? undefined,
        }
        const tempEdges = [...edgesRef.current, tempEdge]
        const graph = buildDependencyGraph(nodesRef.current, tempEdges)

        if (graph.hasCycles()) {
          // Check if this is a valid feedback edge within a multi_pass group.
          // Also resolve the producing step + its output flag for the mapping key.
          let producerStep: PipelineNode | null = null
          let sourceOutputFlag: string | undefined
          if (sourceNode?.type === 'data') {
            const producerEdge = edgesRef.current.find((e) => e.target === params.source)
            producerStep = producerEdge
              ? (nodesRef.current.find((n) => n.id === producerEdge.source) ?? null)
              : null
            sourceOutputFlag = producerEdge?.sourceHandle ?? undefined
          } else if (sourceNode?.type === 'step') {
            producerStep = sourceNode
            sourceOutputFlag = params.sourceHandle ?? undefined
          }
          const sourceGroup =
            producerStep?.type === 'step' ? (producerStep.data as StepData).group : undefined
          const targetGroup =
            targetNode?.type === 'step' ? (targetNode.data as StepData).group : undefined

          if (
            sourceGroup &&
            targetGroup &&
            sourceGroup === targetGroup &&
            multiPassGroups?.[sourceGroup]
          ) {
            const sourceStepName = (producerStep!.data as StepData).name
            const targetStepName = (targetNode!.data as StepData).name
            const targetInputFlag = params.targetHandle ?? undefined

            // Refuse if we can't construct a complete mapping
            if (!sourceOutputFlag || !targetInputFlag) {
              alert('Cannot create feedback connection: missing source or target handle.')
              return
            }

            const sourceSpec = `${sourceStepName}.${sourceOutputFlag}`
            const targetSpec = `${targetStepName}.${targetInputFlag}`

            const mpInfo = multiPassGroups[sourceGroup] as Record<string, unknown>
            const mpConfig = (mpInfo.multi_pass || {}) as Record<string, unknown>
            const existingFeedback = (mpConfig.feedback as Record<string, string> | undefined) || {}

            // Reject collision with a different existing target
            if (existingFeedback[sourceSpec] && existingFeedback[sourceSpec] !== targetSpec) {
              alert(
                `feedback from ${sourceSpec} is already wired to ${existingFeedback[sourceSpec]}; delete that first.`,
              )
              return
            }

            onSnapshot?.()

            const updatedMultiPass = {
              ...mpConfig,
              feedback: { ...existingFeedback, [sourceSpec]: targetSpec },
            }

            setMultiPassGroups?.((prev) => ({
              ...prev,
              [sourceGroup]: {
                ...(prev[sourceGroup] as Record<string, unknown> | undefined),
                multi_pass: updatedMultiPass,
              },
            }))

            const feedbackEdge: Edge = {
              ...tempEdge,
              type: 'feedback',
              data: {
                feedback: true,
                groupName: sourceGroup,
                multiPass: updatedMultiPass as FeedbackEdgeData['multiPass'],
              } satisfies FeedbackEdgeData,
            }
            // Refresh sibling feedback edges in the same group so their data stays in sync
            setEdges((eds) =>
              addEdge(
                feedbackEdge,
                eds.map((e) =>
                  e.type === 'feedback' &&
                  (e.data as Record<string, unknown> | undefined)?.groupName === sourceGroup
                    ? {
                        ...e,
                        data: {
                          ...e.data,
                          multiPass: updatedMultiPass as FeedbackEdgeData['multiPass'],
                        },
                      }
                    : e,
                ),
              ),
            )
            return
          }

          // Warn user about circular dependency
          alert(
            'Cannot create connection: this would create a circular dependency in the pipeline.',
          )
          return
        }

        setEdges((eds) => addEdge({ ...params, id: `e_${params.source}_${params.target}` }, eds))
      }
    },
    [
      setEdges,
      setNodes,
      onSnapshot,
      tasks,
      onSelectionChangeProp,
      multiPassGroups,
      setMultiPassGroups,
    ],
  )

  // Track edge being reconnected
  const edgeReconnectSuccessful = useRef(true)
  // True while an existing edge is being dragged (so onConnectEnd can ignore it)
  const reconnectingRef = useRef(false)

  const onReconnectStart = useCallback(() => {
    reconnectingRef.current = true
    edgeReconnectSuccessful.current = false
  }, [])

  // Dropping a connection on empty space from a step output creates a typed data
  // node at the drop point and wires it to that output. Dropping from a
  // directory data node's output opens a file picker for that directory.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (reconnectingRef.current) return
      if (connectionState.isValid) return
      if (connectionState.toNode) return

      const fromNode = connectionState.fromNode
      const fromHandle = connectionState.fromHandle
      if (!fromNode) return
      if (!fromHandle || fromHandle.type !== 'source' || !fromHandle.id) return

      const instance = reactFlowInstance.current
      if (!instance) return

      let clientX: number
      let clientY: number
      if ('clientX' in event) {
        clientX = event.clientX
        clientY = event.clientY
      } else {
        const touch = event.changedTouches[0]
        if (!touch) return
        clientX = touch.clientX
        clientY = touch.clientY
      }

      const position = instance.screenToFlowPosition({ x: clientX, y: clientY })

      // Dragging from a directory data node: offer its files to nest.
      if (fromNode.type === 'data') {
        const dirData = fromNode.data as DataNodeData
        if (dirData.type !== 'data_folder' && dirData.type !== 'image_directory') return
        setFilePicker({
          screenPosition: { x: clientX, y: clientY },
          flowPosition: position,
          dirNodeId: fromNode.id,
        })
        return
      }

      if (fromNode.type !== 'step') return

      const result = createOutputDataNode({
        nodes: nodesRef.current,
        edges: edgesRef.current,
        stepId: fromNode.id,
        handleId: fromHandle.id,
        position,
        tasks,
      })
      if (!result) return

      onSnapshot?.()
      setNodes(result.nodes)
      setEdges(result.edges)
      onSelectionChangeProp([result.newNode])
    },
    [tasks, setNodes, setEdges, onSnapshot, onSelectionChangeProp],
  )

  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      // Check for cycles before reconnecting (for non-parameter edges)
      if (!oldEdge.source.startsWith('param_') && newConnection.source && newConnection.target) {
        // Build temporary edges with the reconnected edge
        const tempEdges = edgesRef.current.map((e) =>
          e.id === oldEdge.id
            ? {
                ...e,
                source: newConnection.source!,
                target: newConnection.target!,
                sourceHandle: newConnection.sourceHandle ?? undefined,
                targetHandle: newConnection.targetHandle ?? undefined,
              }
            : e,
        )
        const graph = buildDependencyGraph(nodesRef.current, tempEdges)

        if (graph.hasCycles()) {
          alert('Cannot reconnect: this would create a circular dependency in the pipeline.')
          edgeReconnectSuccessful.current = true // Prevent edge deletion
          return
        }
      }

      // Snapshot before reconnecting edge
      onSnapshot?.()
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds))

      // Determine if we need to set a new parameter connection
      let newParamName: string | null = null
      if (
        newConnection.source &&
        newConnection.source.startsWith('param_') &&
        newConnection.targetHandle
      ) {
        // Use ref to avoid stale closure
        const paramNode = nodesRef.current.find((n) => n.id === newConnection.source)
        if (paramNode && paramNode.type === 'parameter') {
          const name = (paramNode.data as ParameterData).name
          if (name) {
            newParamName = name
          }
        }
      }

      // Resolve nodes involved (by ref to avoid stale closure) for data-edge refs
      const oldSourceNode = nodesRef.current.find((n) => n.id === oldEdge.source)
      const oldTargetNode = nodesRef.current.find((n) => n.id === oldEdge.target)
      const newSourceNode = newConnection.source
        ? nodesRef.current.find((n) => n.id === newConnection.source)
        : undefined
      const newTargetNode = newConnection.target
        ? nodesRef.current.find((n) => n.id === newConnection.target)
        : undefined

      // Handle clearing old and setting new references in a single atomic update
      setNodes(
        (nds) =>
          nds.map((node) => {
            if (node.type !== 'step') return node

            let stepData = node.data as StepData
            let changed = false

            // Parameter → arg handling
            if (
              oldEdge.source.startsWith('param_') &&
              node.id === oldEdge.target &&
              oldEdge.targetHandle
            ) {
              stepData = {
                ...stepData,
                args: { ...(stepData.args || {}), [oldEdge.targetHandle]: '' },
              }
              changed = true
            }
            if (newParamName && node.id === newConnection.target && newConnection.targetHandle) {
              stepData = {
                ...stepData,
                args: {
                  ...(stepData.args || {}),
                  [newConnection.targetHandle]: `$${newParamName}`,
                },
              }
              changed = true
            }

            // Data edge handling: clear the old reference, set the new one
            if (!oldEdge.source.startsWith('param_')) {
              if (
                node.id === oldEdge.source &&
                oldEdge.sourceHandle &&
                oldTargetNode?.type === 'data'
              ) {
                stepData = clearStepRef(stepData, oldEdge.sourceHandle, 'output')
                changed = true
              }
              if (
                node.id === oldEdge.target &&
                oldEdge.targetHandle &&
                oldSourceNode?.type === 'data'
              ) {
                stepData = clearStepRef(stepData, oldEdge.targetHandle, 'input')
                changed = true
              }
              if (
                node.id === newConnection.source &&
                newConnection.sourceHandle &&
                newTargetNode?.type === 'data'
              ) {
                stepData = setStepRef(
                  stepData,
                  newConnection.sourceHandle,
                  (newTargetNode.data as DataNodeData).key,
                  'output',
                )
                changed = true
              }
              if (
                node.id === newConnection.target &&
                newConnection.targetHandle &&
                newSourceNode?.type === 'data'
              ) {
                stepData = setStepRef(
                  stepData,
                  newConnection.targetHandle,
                  (newSourceNode.data as DataNodeData).key,
                  'input',
                )
                changed = true
              }
            }

            return changed ? { ...node, data: stepData } : node
          }) as PipelineNode[],
      )

      // Mark reconnection as successful only after all operations complete
      edgeReconnectSuccessful.current = true
    },
    [setEdges, setNodes, onSnapshot],
  )

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        // Edge was dropped into empty space - snapshot before delete
        onSnapshot?.()
        setEdges((eds) => eds.filter((e) => e.id !== edge.id))

        // If it was a parameter edge, clear the arg value
        if (edge.source.startsWith('param_') && edge.targetHandle) {
          setNodes(
            (nds) =>
              nds.map((node) => {
                if (node.id === edge.target && node.type === 'step') {
                  const stepData = node.data as StepData
                  const newArgs = { ...(stepData.args || {}) }
                  newArgs[edge.targetHandle!] = '' // Clear the value
                  return { ...node, data: { ...stepData, args: newArgs } }
                }
                return node
              }) as PipelineNode[],
          )
        } else {
          // Data edge dropped into empty space - clear the step reference it carried
          setNodes((nds) => clearDataRefsForEdges(nds, [edge]))
        }
      }
      reconnectingRef.current = false
      edgeReconnectSuccessful.current = true
    },
    [setEdges, setNodes, onSnapshot],
  )

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: PipelineNode[] }) => {
      selectedNodesRef.current = selectedNodes
      onSelectionChangeProp(selectedNodes)
    },
    [onSelectionChangeProp],
  )

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      onEdgeSelect?.(edge)
    },
    [onEdgeSelect],
  )

  // Drag and drop handlers for parameters from sidebar
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const instance = reactFlowInstance.current
      if (!instance) return
      const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })

      // Data type from the sidebar palette
      const dataTypeData = event.dataTransfer.getData('application/loom-data')
      if (dataTypeData) {
        try {
          const { type } = JSON.parse(dataTypeData) as { type: DataType }
          onAddData?.(type, position)
        } catch {
          // Invalid data, ignore
        }
        return
      }

      // Task from the sidebar
      const taskData = event.dataTransfer.getData('application/loom-task')
      if (taskData) {
        try {
          const { path } = JSON.parse(taskData) as { path: string }
          const task = tasks.find((t) => t.path === path)
          if (task) onAddTask?.(task, position)
        } catch {
          // Invalid data, ignore
        }
        return
      }

      // Parameter from the sidebar
      const paramData = event.dataTransfer.getData('application/loom-parameter')
      if (!paramData || !onParameterDrop) return

      try {
        const { name, value } = JSON.parse(paramData)
        onParameterDrop(name, value, position)
      } catch {
        // Invalid data, ignore
      }
    },
    [onParameterDrop, onAddData, onAddTask, tasks],
  )

  const { highlightedEdgeIds, neighborNodeIds } = useMemo(() => {
    if (!selectedNodes || selectedNodes.length === 0)
      return { highlightedEdgeIds: new Set<string>(), neighborNodeIds: new Set<string>() }
    const selectedIds = new Set(selectedNodes.map((n) => n.id))
    const highlightedEdgeIds = new Set<string>()
    const neighborNodeIds = new Set<string>()
    for (const edge of edges) {
      if (selectedIds.has(edge.source) || selectedIds.has(edge.target)) {
        highlightedEdgeIds.add(edge.id)
        if (selectedIds.has(edge.source)) neighborNodeIds.add(edge.target)
        else neighborNodeIds.add(edge.source)
      }
    }
    for (const id of selectedIds) neighborNodeIds.delete(id)
    return { highlightedEdgeIds, neighborNodeIds }
  }, [selectedNodes, edges])

  const styledEdges = useMemo(() => {
    const inactive = inactiveEdgeIds ?? new Set<string>()
    if (highlightedEdgeIds.size === 0 && inactive.size === 0) return edges
    return edges.map((edge) => {
      let next = edge
      if (inactive.has(edge.id)) {
        next = {
          ...next,
          style: { ...next.style, opacity: 0.2, strokeDasharray: '4 4' },
        }
      }
      if (highlightedEdgeIds.has(edge.id)) {
        next = {
          ...next,
          style: {
            ...next.style,
            stroke: '#2dd4bf',
            strokeWidth: 3,
            filter: 'drop-shadow(0 0 6px rgba(45, 212, 191, 0.7))',
          },
        }
      }
      return next
    })
  }, [edges, highlightedEdgeIds, inactiveEdgeIds])

  // Group click: select all member nodes + their 1st-degree neighbors
  const handleGroupClick = useCallback(
    (memberIds: string[]) => {
      const memberSet = new Set(memberIds)
      // Collect 1st-degree neighbors of members
      const neighborIds = new Set<string>()
      for (const edge of edgesRef.current) {
        if (memberSet.has(edge.source)) neighborIds.add(edge.target)
        if (memberSet.has(edge.target)) neighborIds.add(edge.source)
      }
      const selectIds = new Set([...memberIds, ...neighborIds])
      // Mark nodes as selected via onNodesChange
      const changes = nodesRef.current.map((n) => ({
        id: n.id,
        type: 'select' as const,
        selected: selectIds.has(n.id),
      }))
      onNodesChange(changes)
    },
    [onNodesChange],
  )

  // Group double-click: pan to group center and zoom just past the threshold so nodes appear
  const handleGroupDoubleClick = useCallback(
    (centerX: number, centerY: number) => {
      reactFlowInstance.current?.setCenter(centerX, centerY, {
        zoom: ZOOM_THRESHOLD + 0.02,
        duration: 600,
      })
    },
    [ZOOM_THRESHOLD],
  )

  // Build display nodes: regular nodes + computed group rectangle nodes
  const displayNodes = useMemo(() => {
    const MARGIN = 48
    const TOP_MARGIN = 60 // extra space at the top for the group label

    // Apply parameter visibility, logic-board runtime flags and inactive-branch
    // fading. These are view-only copies; the persisted `nodes` stay untouched.
    const inactive = inactiveNodeIds ?? new Set<string>()
    // Same gate as the fade: a switch only shows a taken branch (and only fades
    // the other) when its data input is present.
    const resolvedBranches = resolvedSwitchBranches(nodes, edges, logicStatus)
    // Nodes in a non-taken branch recede into the background: desaturated and
    // lightened (plus a touch of transparency). Applied last so it wins over
    // the zoom-out opacity handling below.
    const INACTIVE_NODE_STYLE: React.CSSProperties = {
      opacity: 0.6,
      filter: 'saturate(0.3) brightness(1.12)',
    }
    const withInactive = (arr: PipelineNode[]): PipelineNode[] =>
      inactive.size
        ? arr.map((n) =>
            inactive.has(n.id) ? { ...n, style: { ...n.style, ...INACTIVE_NODE_STYLE } } : n,
          )
        : arr
    const regularNodes = nodes.map((n) => {
      let next: PipelineNode = n
      if (hideParameterNodes && n.type === 'parameter') {
        next = { ...n, hidden: true }
      }
      if (n.type === 'condition') {
        const cd = n.data as ConditionData
        const result = logicStatus?.conditions[cd.name]
        // Only show a boolean when the condition's data actually exists.
        if (result !== undefined && conditionInputsAvailable(n, nodes, edges)) {
          next = { ...n, data: { ...cd, result } }
        }
      } else if (n.type === 'switch') {
        const sd = n.data as SwitchData
        const taken = resolvedBranches.get(n.id)
        if (taken) {
          next = { ...n, data: { ...sd, taken } }
        }
      }
      return next
    })

    // Build map from step node id → group name
    const stepGroupMap = new Map<string, string>()
    for (const node of nodes) {
      if (node.type === 'step') {
        const group = (node.data as StepData).group
        if (group) stepGroupMap.set(node.id, group)
      }
    }

    if (stepGroupMap.size === 0) return withInactive(regularNodes)

    // For non-step nodes, check if all connected step neighbors share the same group
    const nodeNeighborGroups = new Map<string, Set<string>>()
    for (const edge of edges) {
      const srcGroup = stepGroupMap.get(edge.source)
      const tgtGroup = stepGroupMap.get(edge.target)
      if (srcGroup) {
        if (!nodeNeighborGroups.has(edge.target)) nodeNeighborGroups.set(edge.target, new Set())
        nodeNeighborGroups.get(edge.target)!.add(srcGroup)
      }
      if (tgtGroup) {
        if (!nodeNeighborGroups.has(edge.source)) nodeNeighborGroups.set(edge.source, new Set())
        nodeNeighborGroups.get(edge.source)!.add(tgtGroup)
      }
    }

    // Collect all nodes belonging to each group (step nodes + adopted non-step nodes)
    const groupMap = new Map<string, PipelineNode[]>()
    for (const node of nodes) {
      let group: string | undefined
      if (node.type === 'step') {
        group = stepGroupMap.get(node.id)
      } else {
        const neighborGroups = nodeNeighborGroups.get(node.id)
        if (neighborGroups && neighborGroups.size === 1) {
          group = [...neighborGroups][0]
        }
      }
      if (group) {
        if (!groupMap.has(group)) groupMap.set(group, [])
        groupMap.get(group)!.push(node)
      }
    }

    // Assign colors in order of first appearance
    const groupColorMap = new Map<string, string>()
    let colorIdx = 0
    for (const groupName of groupMap.keys()) {
      groupColorMap.set(groupName, GROUP_COLORS[colorIdx % GROUP_COLORS.length])
      colorIdx++
    }

    // Compute bounding boxes and average x-positions for each group
    interface GroupBounds {
      minX: number
      maxX: number
      minY: number
      maxY: number
      avgX: number
    }
    const groupBounds = new Map<string, GroupBounds>()
    for (const [groupName, members] of groupMap.entries()) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        sumX = 0
      for (const node of members) {
        const x = node.position.x,
          y = node.position.y
        const { width: nodeWidth, height: nodeHeight } = getNodeDimensions(node)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x + nodeWidth)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y + nodeHeight)
        sumX += x
      }
      groupBounds.set(groupName, { minX, maxX, minY, maxY, avgX: sumX / members.length })
    }

    // Sort groups by average x-position; assign z-index so leftmost is furthest back
    const sortedGroups = [...groupBounds.entries()].sort((a, b) => a[1].avgX - b[1].avgX)
    const n = sortedGroups.length

    const groupNodes: GroupNodeType[] = sortedGroups.map(([groupName, bounds], idx) => {
      const color = groupColorMap.get(groupName)!
      // When zoomed out: groups in front (positive z); when zoomed in: behind (negative z)
      const zIndex = isZoomedOut ? 1000 + idx : idx - n
      const width = bounds.maxX - bounds.minX + 2 * MARGIN
      const height = bounds.maxY - bounds.minY + TOP_MARGIN + MARGIN

      const memberIds = groupMap.get(groupName)!.map((node) => node.id)
      const groupX = bounds.minX - MARGIN
      const groupY = bounds.minY - TOP_MARGIN
      const centerX = groupX + width / 2
      const centerY = groupY + height / 2

      return {
        id: `_group_${groupName}`,
        type: 'group' as const,
        position: { x: groupX, y: groupY },
        width,
        height,
        zIndex,
        selectable: false,
        draggable: false,
        deletable: false,
        data: {
          groupName,
          memberIds,
          color,
          isZoomedOut,
          isSelected: detectedGroupName === groupName,
          anyGroupSelected: detectedGroupName != null,
          onGroupClick: () => handleGroupClick(memberIds),
          onGroupDoubleClick: () => handleGroupDoubleClick(centerX, centerY),
        },
      }
    })

    // When zoomed out, fade regular nodes
    const styledRegularNodes = isZoomedOut
      ? regularNodes.map((n) => ({ ...n, style: { ...n.style, opacity: 0.3 } }))
      : regularNodes.map((n) => {
          // Clear opacity when zooming back in (avoid stale opacity from zoom-out)
          if (n.style?.opacity === 0.3) {
            const { opacity: _, ...rest } = n.style
            return { ...n, style: Object.keys(rest).length > 0 ? rest : undefined }
          }
          return n
        })

    // Fade nodes belonging to a switch branch that is not evaluated. Applied
    // last so it is not stripped by the zoom-out opacity handling above.
    return [...groupNodes, ...withInactive(styledRegularNodes)]
  }, [
    nodes,
    edges,
    hideParameterNodes,
    isZoomedOut,
    handleGroupClick,
    handleGroupDoubleClick,
    detectedGroupName,
    inactiveNodeIds,
    logicStatus,
  ])

  // Hotbox handlers
  const handleHotboxAddTask = useCallback(
    (task: TaskInfo, position: { x: number; y: number }) => {
      onAddTask?.(task, position)
    },
    [onAddTask],
  )

  const handleHotboxAddData = useCallback(
    (dataType: DataType, position: { x: number; y: number }) => {
      onAddData?.(dataType, position)
    },
    [onAddData],
  )

  const handleHotboxAddParameter = useCallback(
    (name: string, value: unknown, position: { x: number; y: number }) => {
      onParameterDrop?.(name, value, position)
    },
    [onParameterDrop],
  )

  const handleHotboxAddCondition = useCallback(
    (predicate: string, position: { x: number; y: number }) => {
      onAddCondition?.(predicate, position)
    },
    [onAddCondition],
  )

  const handleHotboxAddSwitch = useCallback(
    (position: { x: number; y: number }) => {
      onAddSwitch?.(position)
    },
    [onAddSwitch],
  )

  const handleHotboxClose = useCallback(() => {
    setHotbox(null)
  }, [])

  // Directory file-picker handlers
  const filePickerDir = useMemo(() => {
    if (!filePicker) return null
    const node = nodes.find((n) => n.id === filePicker.dirNodeId)
    if (!node || node.type !== 'data') return null
    return node.data as DataNodeData
  }, [filePicker, nodes])

  const handleFileSelect = useCallback(
    (entry: DataFileEntry) => {
      if (!filePicker) return
      const result = createNestedDataNode({
        nodes: nodesRef.current,
        edges: edgesRef.current,
        dirNodeId: filePicker.dirNodeId,
        entry,
        position: filePicker.flowPosition,
      })
      if (!result) return
      onSnapshot?.()
      setNodes(result.nodes)
      setEdges(result.edges)
      onSelectionChangeProp([result.newNode])
    },
    [filePicker, setNodes, setEdges, onSnapshot, onSelectionChangeProp],
  )

  const handleFilePickerClose = useCallback(() => {
    setFilePicker(null)
  }, [])

  // A typed name that isn't in the directory: confirm before adding it as an
  // expected (unverified) output file.
  const handleFileCreateRequest = useCallback(
    (path: string) => {
      if (!filePicker) return
      const name = path.split('/').pop() || path
      setPendingNewFile({
        name,
        path,
        dirNodeId: filePicker.dirNodeId,
        dirKey:
          (
            nodesRef.current.find((n) => n.id === filePicker.dirNodeId)?.data as
              | DataNodeData
              | undefined
          )?.key ?? '',
        flowPosition: filePicker.flowPosition,
      })
      setFilePicker(null)
    },
    [filePicker],
  )

  const handleNewFileConfirm = useCallback(() => {
    if (!pendingNewFile) return
    const result = createNestedDataNode({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      dirNodeId: pendingNewFile.dirNodeId,
      entry: { name: pendingNewFile.name, path: pendingNewFile.path, size: 0 },
      position: pendingNewFile.flowPosition,
    })
    setPendingNewFile(null)
    if (!result) return
    onSnapshot?.()
    setNodes(result.nodes)
    setEdges(result.edges)
    onSelectionChangeProp([result.newNode])
  }, [pendingNewFile, setNodes, setEdges, onSnapshot, onSelectionChangeProp])

  const handleNewFileCancel = useCallback(() => {
    setPendingNewFile(null)
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mousePositionRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  return (
    <HighlightContext.Provider value={{ neighborNodeIds }}>
      <div
        ref={reactFlowWrapper}
        className="flex-1 bg-slate-100 dark:bg-slate-950"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseMove={handleMouseMove}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={(_event, node) => onNodeDoubleClick?.(node)}
          onEdgeClick={onEdgeClick}
          onBeforeDelete={async ({ nodes: nodesToDelete, edges: edgesToDelete }) => {
            // Snapshot once, before any node/edge deletion, so Del is undoable.
            // React Flow calls this even with nothing selected, so skip empties.
            if (nodesToDelete.length === 0 && edgesToDelete.length === 0) return true
            onSnapshot?.()
            return true
          }}
          onInit={(instance) => {
            reactFlowInstance.current = instance
            onCanvasInit?.({
              getViewportCenter: () => {
                const rect = reactFlowWrapper.current?.getBoundingClientRect()
                const point = rect
                  ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                  : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
                return instance.screenToFlowPosition(point)
              },
            })
          }}
          onViewportChange={onViewportChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          minZoom={0.05}
          panOnDrag={[1, 2]}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={!isZoomedOut}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            style: { stroke: '#475569', strokeWidth: 2 },
            type: 'bezier',
            reconnectable: true,
          }}
        >
          <Background className="!bg-slate-100 dark:[&]:!bg-slate-950" color="#94a3b8" gap={20} />
          <Controls className="!bg-white dark:!bg-slate-800 !border-slate-300 dark:!border-slate-700 !rounded-lg [&>button]:!bg-slate-100 dark:[&>button]:!bg-slate-700 [&>button]:!border-slate-300 dark:[&>button]:!border-slate-600 [&>button:hover]:!bg-slate-200 dark:[&>button:hover]:!bg-slate-600 [&>button]:!text-slate-700 dark:[&>button]:!text-white" />
          <MiniMap
            className="!bg-slate-200 dark:!bg-slate-900 !border-slate-300 dark:!border-slate-700"
            nodeColor={(node) => {
              if (node.type === 'group') return 'transparent'
              if (node.type === 'data') {
                const dataData = node.data as DataNodeData
                if (dataData.exists === true) return '#14b8a6' // teal
                if (dataData.exists === false) return '#64748b' // grey
                return '#0d9488' // teal (unknown)
              }
              if (node.type === 'parameter') {
                return '#a855f7' // purple
              }
              if (node.type === 'step') {
                const stepData = node.data as StepData
                if (stepData.disabled) return '#4b5563' // gray-600 for disabled
                if (stepData.executionState === 'running') return '#22d3ee' // cyan
                if (stepData.executionState === 'completed') return '#22c55e' // green
                if (stepData.executionState === 'failed') return '#ef4444' // red
                return '#475569' // slate-600 (darker for better visibility on light bg)
              }
              return '#64748b'
            }}
          />
        </ReactFlow>
        {hotbox && onAddTask && onAddData && (
          <NodeHotbox
            position={hotbox.screenPosition}
            flowPosition={hotbox.flowPosition}
            tasks={tasks}
            parameters={parameters ?? {}}
            onAddTask={handleHotboxAddTask}
            onAddData={handleHotboxAddData}
            onAddParameter={handleHotboxAddParameter}
            onAddCondition={handleHotboxAddCondition}
            onAddSwitch={handleHotboxAddSwitch}
            onClose={handleHotboxClose}
          />
        )}
        {filePicker && filePickerDir && (
          <FilePickerPopup
            position={filePicker.screenPosition}
            directoryKey={filePickerDir.key}
            directoryPath={filePickerDir.path}
            directoryNestedIn={filePickerDir.nested_in}
            onSelect={handleFileSelect}
            onCreateNew={handleFileCreateRequest}
            onClose={handleFilePickerClose}
          />
        )}
        {pendingNewFile && (
          <NewFileConfirmDialog
            fileName={pendingNewFile.path}
            directoryKey={pendingNewFile.dirKey}
            onConfirm={handleNewFileConfirm}
            onCancel={handleNewFileCancel}
          />
        )}
      </div>
    </HighlightContext.Provider>
  )
}
