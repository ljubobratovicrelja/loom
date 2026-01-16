/**
 * Test utilities for graph operations testing.
 * Provides helpers to create nodes, edges, and simulate graph operations.
 */

import type { Node, Edge } from '@xyflow/react'
import type { StepData, ParameterData, DataNodeData, DataType } from '../types/pipeline'

// ============================================================================
// Node Factories
// ============================================================================

let nodeIdCounter = 0

export function resetNodeIdCounter(): void {
  nodeIdCounter = 0
}

export function createStepNode(
  name: string,
  options: Partial<StepData> & { id?: string; position?: { x: number; y: number } } = {}
): Node<StepData, 'step'> {
  const id = options.id ?? `step_${name}_${++nodeIdCounter}`
  return {
    id,
    type: 'step',
    position: options.position ?? { x: 0, y: 0 },
    data: {
      name,
      task: options.task ?? `tasks/${name}.py`,
      inputs: options.inputs ?? {},
      outputs: options.outputs ?? {},
      args: options.args ?? {},
      optional: options.optional ?? false,
      executionState: options.executionState,
      freshnessStatus: options.freshnessStatus,
    },
  }
}

export function createParameterNode(
  name: string,
  value: unknown = '',
  options: { id?: string; position?: { x: number; y: number } } = {}
): Node<ParameterData, 'parameter'> {
  const id = options.id ?? `param_${name}_${++nodeIdCounter}`
  return {
    id,
    type: 'parameter',
    position: options.position ?? { x: 0, y: 0 },
    data: {
      name,
      value,
    },
  }
}

export function createDataNode(
  name: string,
  dataType: DataType = 'csv',
  path: string = `data/${name}.${dataType === 'csv' ? 'csv' : dataType === 'json' ? 'json' : dataType === 'video' ? 'mp4' : dataType === 'image' ? 'png' : ''}`,
  options: Partial<DataNodeData> & { id?: string; position?: { x: number; y: number } } = {}
): Node<DataNodeData, 'data'> {
  const id = options.id ?? `data_${name}_${++nodeIdCounter}`
  const key = options.key ?? name.toLowerCase().replace(/\s+/g, '_')
  return {
    id,
    type: 'data',
    position: options.position ?? { x: 0, y: 0 },
    data: {
      key,
      name,
      type: dataType,
      path,
      description: options.description,
      pattern: options.pattern,
      exists: options.exists,
      pulseError: options.pulseError,
    },
  }
}

// ============================================================================
// Edge Factories
// ============================================================================

export function createEdge(
  source: string,
  target: string,
  options: {
    id?: string
    sourceHandle?: string
    targetHandle?: string
  } = {}
): Edge {
  const id = options.id ?? `e_${source}_${target}${options.targetHandle ? `_${options.targetHandle}` : ''}`
  return {
    id,
    source,
    target,
    sourceHandle: options.sourceHandle,
    targetHandle: options.targetHandle,
  }
}

export function createParameterToStepEdge(parameterId: string, stepId: string, argHandle: string): Edge {
  return createEdge(parameterId, stepId, { targetHandle: argHandle })
}

export function createDataToStepEdge(dataId: string, stepId: string, inputHandle?: string): Edge {
  return createEdge(dataId, stepId, { sourceHandle: 'value', targetHandle: inputHandle })
}

export function createStepToDataEdge(stepId: string, dataId: string, outputHandle?: string): Edge {
  return createEdge(stepId, dataId, { sourceHandle: outputHandle, targetHandle: 'input' })
}

// ============================================================================
// Graph State Helpers
// ============================================================================

export interface GraphState {
  nodes: Node[]
  edges: Edge[]
}

export function createGraphState(nodes: Node[] = [], edges: Edge[] = []): GraphState {
  return { nodes, edges }
}

/**
 * Simulates connecting a parameter to a step's arg.
 * Returns the new state after connection.
 */
export function connectParameterToStep(
  state: GraphState,
  parameterId: string,
  stepId: string,
  argKey: string
): GraphState {
  const paramNode = state.nodes.find((n) => n.id === parameterId)
  if (!paramNode || paramNode.type !== 'parameter') {
    throw new Error(`Parameter node ${parameterId} not found`)
  }

  const stepNode = state.nodes.find((n) => n.id === stepId)
  if (!stepNode || stepNode.type !== 'step') {
    throw new Error(`Step node ${stepId} not found`)
  }

  const paramName = (paramNode.data as ParameterData).name

  // Remove any existing parameter connection to this arg
  const newEdges = state.edges.filter(
    (e) => !(e.target === stepId && e.targetHandle === argKey && e.source.startsWith('param_'))
  )

  // Add new edge
  const newEdge = createParameterToStepEdge(parameterId, stepId, argKey)
  newEdges.push(newEdge)

  // Update step's args
  const newNodes = state.nodes.map((node) => {
    if (node.id === stepId && node.type === 'step') {
      const stepData = node.data as StepData
      return {
        ...node,
        data: {
          ...stepData,
          args: { ...stepData.args, [argKey]: `$${paramName}` },
        },
      }
    }
    return node
  })

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Simulates disconnecting a parameter from a step's arg.
 * Returns the new state after disconnection.
 */
export function disconnectParameterFromStep(
  state: GraphState,
  stepId: string,
  argKey: string
): GraphState {
  // Remove edge
  const newEdges = state.edges.filter(
    (e) => !(e.target === stepId && e.targetHandle === argKey && e.source.startsWith('param_'))
  )

  // Clear step's arg
  const newNodes = state.nodes.map((node) => {
    if (node.id === stepId && node.type === 'step') {
      const stepData = node.data as StepData
      return {
        ...node,
        data: {
          ...stepData,
          args: { ...stepData.args, [argKey]: '' },
        },
      }
    }
    return node
  })

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Simulates deleting a node and its connected edges.
 * If deleting a parameter node, also clears arg values in connected steps.
 */
export function deleteNode(state: GraphState, nodeId: string): GraphState {
  const nodeToDelete = state.nodes.find((n) => n.id === nodeId)
  if (!nodeToDelete) {
    return state
  }

  // Find edges to remove
  const edgesToRemove = state.edges.filter((e) => e.source === nodeId || e.target === nodeId)

  // If deleting a parameter node, clear arg values in connected steps
  let newNodes = state.nodes.filter((n) => n.id !== nodeId)

  if (nodeToDelete.type === 'parameter') {
    const paramEdges = edgesToRemove.filter((e) => e.source === nodeId && e.targetHandle)
    newNodes = newNodes.map((node) => {
      if (node.type !== 'step') return node

      // Find ALL edges from this parameter to this step
      const affectedEdges = paramEdges.filter((e) => e.target === node.id)
      if (affectedEdges.length === 0) return node

      const stepData = node.data as StepData
      const newArgs = { ...stepData.args }

      // Clear all affected arg values
      for (const edge of affectedEdges) {
        if (edge.targetHandle) {
          newArgs[edge.targetHandle] = ''
        }
      }

      return {
        ...node,
        data: {
          ...stepData,
          args: newArgs,
        },
      }
    })
  }

  const newEdges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Simulates reconnecting an edge from one target to another.
 */
export function reconnectEdge(
  state: GraphState,
  oldEdge: Edge,
  newTarget: string,
  newTargetHandle?: string
): GraphState {
  // For parameter edges, handle arg updates
  const isParamEdge = oldEdge.source.startsWith('param_')
  let newNodes = state.nodes

  if (isParamEdge) {
    const paramNode = state.nodes.find((n) => n.id === oldEdge.source)
    const paramName = paramNode?.type === 'parameter' ? (paramNode.data as ParameterData).name : ''

    newNodes = state.nodes.map((node) => {
      if (node.type !== 'step') return node

      const stepData = node.data as StepData
      const newArgs = { ...stepData.args }
      let changed = false

      // Clear old target's arg
      if (node.id === oldEdge.target && oldEdge.targetHandle) {
        newArgs[oldEdge.targetHandle] = ''
        changed = true
      }

      // Set new target's arg
      if (node.id === newTarget && newTargetHandle && paramName) {
        newArgs[newTargetHandle] = `$${paramName}`
        changed = true
      }

      return changed ? { ...node, data: { ...stepData, args: newArgs } } : node
    })
  }

  // Update edge
  const newEdges = state.edges.map((e) => {
    if (e.id === oldEdge.id) {
      return {
        ...e,
        target: newTarget,
        targetHandle: newTargetHandle,
      }
    }
    return e
  })

  return { nodes: newNodes, edges: newEdges }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Gets the arg value for a step.
 */
export function getStepArg(state: GraphState, stepId: string, argKey: string): unknown {
  const step = state.nodes.find((n) => n.id === stepId && n.type === 'step')
  if (!step) return undefined
  return (step.data as StepData).args[argKey]
}

/**
 * Gets all edges connected to a node (as source or target).
 */
export function getNodeEdges(state: GraphState, nodeId: string): Edge[] {
  return state.edges.filter((e) => e.source === nodeId || e.target === nodeId)
}

/**
 * Gets edges where the node is the source.
 */
export function getOutgoingEdges(state: GraphState, nodeId: string): Edge[] {
  return state.edges.filter((e) => e.source === nodeId)
}

/**
 * Gets edges where the node is the target.
 */
export function getIncomingEdges(state: GraphState, nodeId: string): Edge[] {
  return state.edges.filter((e) => e.target === nodeId)
}

/**
 * Checks if a parameter is connected to a step's arg.
 */
export function isParameterConnected(
  state: GraphState,
  parameterId: string,
  stepId: string,
  argKey: string
): boolean {
  return state.edges.some(
    (e) => e.source === parameterId && e.target === stepId && e.targetHandle === argKey
  )
}

/**
 * Gets the parameter name from an arg value (e.g., "$threshold" -> "threshold").
 */
export function getParameterNameFromArg(argValue: unknown): string | null {
  if (typeof argValue === 'string' && argValue.startsWith('$')) {
    return argValue.slice(1)
  }
  return null
}

// ============================================================================
// Complex Graph Factories
// ============================================================================

/**
 * Creates a simple linear pipeline: step1 -> data1 -> step2 -> data2 -> step3
 */
export function createLinearPipeline(): GraphState {
  resetNodeIdCounter()
  const step1 = createStepNode('extract', { id: 'step1' })
  const step2 = createStepNode('process', { id: 'step2' })
  const step3 = createStepNode('classify', { id: 'step3' })
  const data1 = createDataNode('raw_data', 'csv', 'data/raw.csv', { id: 'data1' })
  const data2 = createDataNode('processed_data', 'csv', 'data/processed.csv', { id: 'data2' })

  const edges = [
    createStepToDataEdge('step1', 'data1'),
    createDataToStepEdge('data1', 'step2'),
    createStepToDataEdge('step2', 'data2'),
    createDataToStepEdge('data2', 'step3'),
  ]

  return { nodes: [step1, step2, step3, data1, data2], edges }
}

/**
 * Creates a diamond pipeline:
 *           -> step2 ->
 * step1 -> data1      data3 -> step4
 *           -> step3 ->
 */
export function createDiamondPipeline(): GraphState {
  resetNodeIdCounter()
  const step1 = createStepNode('split', { id: 'step1' })
  const step2 = createStepNode('branch_a', { id: 'step2' })
  const step3 = createStepNode('branch_b', { id: 'step3' })
  const step4 = createStepNode('merge', { id: 'step4' })
  const data1 = createDataNode('input', 'csv', 'data/input.csv', { id: 'data1' })
  const data2 = createDataNode('result_a', 'csv', 'data/result_a.csv', { id: 'data2' })
  const data3 = createDataNode('result_b', 'csv', 'data/result_b.csv', { id: 'data3' })

  const edges = [
    createStepToDataEdge('step1', 'data1'),
    createDataToStepEdge('data1', 'step2'),
    createDataToStepEdge('data1', 'step3'),
    createStepToDataEdge('step2', 'data2'),
    createStepToDataEdge('step3', 'data3'),
    createDataToStepEdge('data2', 'step4'),
    createDataToStepEdge('data3', 'step4'),
  ]

  return { nodes: [step1, step2, step3, step4, data1, data2, data3], edges }
}

/**
 * Creates a pipeline with parameters connected to steps.
 */
export function createPipelineWithParameters(): GraphState {
  resetNodeIdCounter()
  const step1 = createStepNode('process', {
    id: 'step1',
    args: { threshold: '$threshold', window_size: '$window_size' },
  })
  const data1 = createDataNode('output', 'csv', 'data/output.csv', { id: 'data1' })
  const param1 = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
  const param2 = createParameterNode('window_size', 100, { id: 'param_window_size' })

  const edges = [
    createStepToDataEdge('step1', 'data1'),
    createParameterToStepEdge('param_threshold', 'step1', 'threshold'),
    createParameterToStepEdge('param_window_size', 'step1', 'window_size'),
  ]

  return { nodes: [step1, data1, param1, param2], edges }
}
