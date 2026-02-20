import { useCallback, useRef, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import StepNode from './StepNode'
import ParameterNode from './ParameterNode'
import DataNode from './DataNode'
import GroupNode from './GroupNode'
import type { PipelineNode, StepData, ParameterData, DataNodeData, TaskInfo, DataNode as DataNodeType, DataType, LoopConfig, GroupNode as GroupNodeType } from '../types/pipeline'
import { buildDependencyGraph } from '../utils/dependencyGraph'
import { HighlightContext } from '../contexts/HighlightContext'

const nodeTypes = {
  step: StepNode,
  parameter: ParameterNode,
  data: DataNode,
  group: GroupNode,
}

// Color palette for group rectangles (in order of appearance)
const GROUP_COLORS = ['#a5b4fc', '#f9a8d4', '#5eead4', '#fdba74', '#c4b5fd', '#67e8f9', '#bef264', '#fda4af']

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

interface CanvasProps {
  nodes: PipelineNode[]
  edges: Edge[]
  tasks: TaskInfo[]
  onNodesChange: OnNodesChange<PipelineNode>
  onEdgesChange: OnEdgesChange<Edge>
  setNodes: Dispatch<SetStateAction<PipelineNode[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  onSelectionChange: (selectedNodes: PipelineNode[]) => void
  onSnapshot?: () => void
  onNodeDoubleClick?: (node: PipelineNode) => void
  onParameterDrop?: (name: string, value: unknown, position: { x: number; y: number }) => void
  hideParameterNodes?: boolean
  selectedNodes?: PipelineNode[]
  detectedGroupName?: string | null
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
  onSnapshot,
  onNodeDoubleClick,
  onParameterDrop,
  hideParameterNodes,
  selectedNodes,
  detectedGroupName,
}: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance<PipelineNode, Edge> | null>(null)

  // Track whether user is zoomed out past threshold for group/node z-swap
  const ZOOM_THRESHOLD = 0.4
  const [isZoomedOut, setIsZoomedOut] = useState(false)
  const onViewportChange = useCallback(
    ({ zoom }: Viewport) => setIsZoomedOut(zoom < ZOOM_THRESHOLD),
    [ZOOM_THRESHOLD]
  )

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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
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
            return (sourceInSelection && !targetInSelection) || (!sourceInSelection && targetInSelection)
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
              currentNodes.map((n) => (n.data as { name?: string }).name).filter(Boolean) as string[]
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

  const onConnect: OnConnect = useCallback(
    (params) => {
      onSnapshot?.()

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
              )
          )
          return addEdge({ ...params, id: `e_${params.source}_${params.target}_${params.targetHandle}` }, filtered)
        })

        // Update the target step's arg value
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === params.target && node.type === 'step') {
              const stepData = node.data as StepData
              const newArgs = { ...(stepData.args || {}), [params.targetHandle!]: `$${paramName}` }
              return { ...node, data: { ...stepData, args: newArgs } }
            }
            return node
          }) as PipelineNode[]
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
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.target && node.type === 'step') {
                const stepData = node.data as StepData
                const loop: LoopConfig = { ...(stepData.loop || { over: '', into: '' }), over: `$${dataKey}` }
                return { ...node, data: { ...stepData, loop } }
              }
              return node
            }) as PipelineNode[]
          )
          setEdges((eds) => {
            // Remove any existing loop-over edge for this step
            const filtered = eds.filter(
              (e) => !(e.target === params.target && e.targetHandle === 'loop-over')
            )
            return addEdge(
              { ...params, id: `e_loop_over_${params.source}_${params.target}` },
              filtered
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
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === params.source && node.type === 'step') {
                const stepData = node.data as StepData
                const loop: LoopConfig = { ...(stepData.loop || { over: '', into: '' }), into: `$${dataKey}` }
                return { ...node, data: { ...stepData, loop } }
              }
              return node
            }) as PipelineNode[]
          )
          setEdges((eds) => {
            // Remove any existing loop-into edge for this step
            const filtered = eds.filter(
              (e) => !(e.source === params.source && e.sourceHandle === 'loop-into')
            )
            return addEdge(
              { ...params, id: `e_loop_into_${params.source}_${params.target}` },
              filtered
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
          const baseKey = `${sourceStepData.name}_${params.sourceHandle}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
          const existingKeys = new Set(
            nodesRef.current.filter((n) => n.type === 'data').map((n) => (n.data as DataNodeData).key)
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

          // Apply changes: add node (with selection), add edges
          setNodes((nds) => {
            const deselected = nds.map((n) => ({ ...n, selected: false }))
            return [...deselected, newDataNode] as PipelineNode[]
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
              alert(`Type mismatch: data node is "${dataType}" but input expects "${inputSchema.type}"`)
              return
            }
          }

          // Step output → Data: Validate type match
          if (sourceNode?.type === 'step' && targetNode?.type === 'data' && params.sourceHandle) {
            const dataType = (targetNode.data as DataNodeData).type
            const stepData = sourceNode.data as StepData
            const task = tasks.find((t) => t.path === stepData.task)
            const outputSchema = task?.outputs[params.sourceHandle]

            if (outputSchema?.type && outputSchema.type !== dataType) {
              alert(`Type mismatch: step output is "${outputSchema.type}" but data node is "${dataType}"`)
              return
            }
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
          // Warn user about circular dependency
          alert('Cannot create connection: this would create a circular dependency in the pipeline.')
          return
        }

        setEdges((eds) => addEdge({ ...params, id: `e_${params.source}_${params.target}` }, eds))
      }
    },
    [setEdges, setNodes, onSnapshot, tasks, onSelectionChangeProp]
  )

  // Track edge being reconnected
  const edgeReconnectSuccessful = useRef(true)

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false
  }, [])

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
            : e
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
      if (newConnection.source && newConnection.source.startsWith('param_') && newConnection.targetHandle) {
        // Use ref to avoid stale closure
        const paramNode = nodesRef.current.find((n) => n.id === newConnection.source)
        if (paramNode && paramNode.type === 'parameter') {
          const name = (paramNode.data as ParameterData).name
          if (name) {
            newParamName = name
          }
        }
      }

      // Handle both clearing old and setting new parameter connections in a single atomic update
      setNodes((nds) =>
        nds.map((node) => {
          if (node.type !== 'step') return node

          const stepData = node.data as StepData
          let newArgs = stepData.args || {}
          let changed = false

          // Clear old connection if it was a parameter to step arg
          if (
            oldEdge.source.startsWith('param_') &&
            node.id === oldEdge.target &&
            oldEdge.targetHandle
          ) {
            newArgs = { ...newArgs }
            newArgs[oldEdge.targetHandle] = ''
            changed = true
          }

          // Set new connection if connecting a parameter to a step arg
          if (newParamName && node.id === newConnection.target && newConnection.targetHandle) {
            newArgs = { ...newArgs, [newConnection.targetHandle]: `$${newParamName}` }
            changed = true
          }

          return changed ? { ...node, data: { ...stepData, args: newArgs } } : node
        }) as PipelineNode[]
      )

      // Mark reconnection as successful only after all operations complete
      edgeReconnectSuccessful.current = true
    },
    [setEdges, setNodes, onSnapshot]
  )

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        // Edge was dropped into empty space - snapshot before delete
        onSnapshot?.()
        setEdges((eds) => eds.filter((e) => e.id !== edge.id))

        // If it was a parameter edge, clear the arg value
        if (edge.source.startsWith('param_') && edge.targetHandle) {
          setNodes((nds) =>
            nds.map((node) => {
              if (node.id === edge.target && node.type === 'step') {
                const stepData = node.data as StepData
                const newArgs = { ...(stepData.args || {}) }
                newArgs[edge.targetHandle!] = '' // Clear the value
                return { ...node, data: { ...stepData, args: newArgs } }
              }
              return node
            }) as PipelineNode[]
          )
        }
      }
      edgeReconnectSuccessful.current = true
    },
    [setEdges, setNodes, onSnapshot]
  )

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: PipelineNode[] }) => {
      selectedNodesRef.current = selectedNodes
      onSelectionChangeProp(selectedNodes)
    },
    [onSelectionChangeProp]
  )

  // Drag and drop handlers for parameters from sidebar
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const paramData = event.dataTransfer.getData('application/loom-parameter')
      if (!paramData || !onParameterDrop || !reactFlowInstance.current) return

      try {
        const { name, value } = JSON.parse(paramData)
        const position = reactFlowInstance.current.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })
        onParameterDrop(name, value, position)
      } catch {
        // Invalid data, ignore
      }
    },
    [onParameterDrop]
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
    if (highlightedEdgeIds.size === 0) return edges
    return edges.map((edge) =>
      highlightedEdgeIds.has(edge.id)
        ? {
            ...edge,
            style: {
              ...edge.style,
              stroke: '#2dd4bf',
              strokeWidth: 3,
              filter: 'drop-shadow(0 0 6px rgba(45, 212, 191, 0.7))',
            },
          }
        : edge
    )
  }, [edges, highlightedEdgeIds])

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
    [onNodesChange]
  )

  // Group double-click: pan to group center and zoom just past the threshold so nodes appear
  const handleGroupDoubleClick = useCallback(
    (centerX: number, centerY: number) => {
      reactFlowInstance.current?.setCenter(centerX, centerY, {
        zoom: ZOOM_THRESHOLD + 0.02,
        duration: 600,
      })
    },
    [ZOOM_THRESHOLD]
  )

  // Build display nodes: regular nodes + computed group rectangle nodes
  const displayNodes = useMemo(() => {
    const NODE_WIDTH = 250
    const NODE_HEIGHT = 150
    const MARGIN = 48
    const TOP_MARGIN = 60 // extra space at the top for the group label

    // Apply parameter visibility
    const regularNodes = hideParameterNodes
      ? nodes.map((n) => (n.type === 'parameter' ? { ...n, hidden: true } : n))
      : nodes

    // Build map from step node id → group name
    const stepGroupMap = new Map<string, string>()
    for (const node of nodes) {
      if (node.type === 'step') {
        const group = (node.data as StepData).group
        if (group) stepGroupMap.set(node.id, group)
      }
    }

    if (stepGroupMap.size === 0) return regularNodes

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
      minX: number; maxX: number; minY: number; maxY: number; avgX: number
    }
    const groupBounds = new Map<string, GroupBounds>()
    for (const [groupName, members] of groupMap.entries()) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumX = 0
      for (const node of members) {
        const x = node.position.x, y = node.position.y
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x + NODE_WIDTH)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y + NODE_HEIGHT)
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

    return [...groupNodes, ...styledRegularNodes]
  }, [nodes, edges, hideParameterNodes, isZoomedOut, handleGroupClick, handleGroupDoubleClick, detectedGroupName])

  return (
    <HighlightContext.Provider value={{ neighborNodeIds }}>
    <div
      ref={reactFlowWrapper}
      className="flex-1 bg-slate-100 dark:bg-slate-950"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={displayNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={(_event, node) => onNodeDoubleClick?.(node)}
        onInit={(instance) => { reactFlowInstance.current = instance }}
        onViewportChange={onViewportChange}
        nodeTypes={nodeTypes}
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
    </div>
    </HighlightContext.Provider>
  )
}
