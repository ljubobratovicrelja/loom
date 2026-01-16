import { useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import StepNode from './StepNode'
import VariableNode from './VariableNode'
import ParameterNode from './ParameterNode'
import DataNode from './DataNode'
import type { PipelineNode, StepData, VariableData, ParameterData, DataNodeData, TaskInfo } from '../types/pipeline'
import { buildDependencyGraph } from '../utils/dependencyGraph'

const nodeTypes = {
  step: StepNode,
  variable: VariableNode,
  parameter: ParameterNode,
  data: DataNode,
}

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
}: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance<PipelineNode, Edge> | null>(null)

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
    [setEdges, setNodes, onSnapshot, tasks]
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

  return (
    <div
      ref={reactFlowWrapper}
      className="flex-1 bg-slate-950"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={(_event, node) => onNodeDoubleClick?.(node)}
        onInit={(instance) => { reactFlowInstance.current = instance }}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnScroll={false}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          style: { stroke: '#64748b', strokeWidth: 2 },
          type: 'bezier',
          reconnectable: true,
        }}
      >
        <Background color="#334155" gap={20} />
        <Controls className="!bg-slate-800 !border-slate-700 !rounded-lg [&>button]:!bg-slate-700 [&>button]:!border-slate-600 [&>button:hover]:!bg-slate-600" />
        <MiniMap
          className="!bg-slate-900 !border-slate-700"
          nodeColor={(node) => {
            if (node.type === 'variable') {
              const varData = node.data as VariableData
              if (varData.exists === true) return '#22c55e' // green
              if (varData.exists === false) return '#64748b' // grey
              return '#4f46e5' // indigo (unknown)
            }
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
              if (stepData.executionState === 'running') return '#22d3ee' // cyan
              if (stepData.executionState === 'completed') return '#22c55e' // green
              if (stepData.executionState === 'failed') return '#ef4444' // red
              return '#334155'
            }
            return '#64748b'
          }}
        />
      </ReactFlow>
    </div>
  )
}
