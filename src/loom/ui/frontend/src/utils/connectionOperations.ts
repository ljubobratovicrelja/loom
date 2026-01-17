/**
 * Pure utility functions for graph connection operations.
 * These are extracted from Canvas.tsx handlers for testability.
 */

import type { Node, Edge, Connection } from '@xyflow/react'
import type { StepData, ParameterData } from '../types/pipeline'

export interface ConnectionResult {
  nodes: Node[]
  edges: Edge[]
  success: boolean
}

/**
 * Validates if a parameter node is valid for connection.
 */
export function isValidParameterNode(nodes: Node[], sourceId: string): boolean {
  const paramNode = nodes.find((n) => n.id === sourceId)
  if (!paramNode || paramNode.type !== 'parameter') {
    return false
  }
  const paramName = (paramNode.data as ParameterData).name
  return Boolean(paramName)
}

/**
 * Gets the parameter name from a parameter node.
 */
export function getParameterName(nodes: Node[], sourceId: string): string | null {
  const paramNode = nodes.find((n) => n.id === sourceId)
  if (!paramNode || paramNode.type !== 'parameter') {
    return null
  }
  return (paramNode.data as ParameterData).name || null
}

/**
 * Checks if a source ID represents a parameter node (by ID convention).
 */
export function isParameterSource(sourceId: string): boolean {
  return sourceId.startsWith('param_')
}

/**
 * Creates a new edge ID for a connection.
 */
export function createEdgeId(source: string, target: string, targetHandle?: string | null): string {
  if (targetHandle) {
    return `e_${source}_${target}_${targetHandle}`
  }
  return `e_${source}_${target}`
}

/**
 * Handles creating a new connection (edge) between nodes.
 *
 * For parameter → step connections:
 * - Validates parameter node exists and has a name
 * - Removes any existing parameter connection to the same arg
 * - Updates the step's arg value to reference the parameter
 *
 * For other connections:
 * - Simply adds the edge
 */
export function handleConnect(
  nodes: Node[],
  edges: Edge[],
  connection: Connection
): ConnectionResult {
  const { source, target, sourceHandle, targetHandle } = connection

  if (!source || !target) {
    return { nodes, edges, success: false }
  }

  // Check if this is a parameter → step connection
  if (isParameterSource(source) && targetHandle) {
    const paramName = getParameterName(nodes, source)
    if (!paramName) {
      // Invalid parameter node, don't create edge
      return { nodes, edges, success: false }
    }

    // Remove any existing parameter connection to this target handle
    const filteredEdges = edges.filter(
      (e) =>
        !(
          e.target === target &&
          e.targetHandle === targetHandle &&
          isParameterSource(e.source)
        )
    )

    // Add new edge
    const newEdge: Edge = {
      id: createEdgeId(source, target, targetHandle),
      source,
      target,
      sourceHandle: sourceHandle ?? undefined,
      targetHandle,
    }
    const newEdges = [...filteredEdges, newEdge]

    // Update the target step's arg value
    const newNodes = nodes.map((node) => {
      if (node.id === target && node.type === 'step') {
        const stepData = node.data as StepData
        const newArgs = { ...(stepData.args || {}), [targetHandle]: `$${paramName}` }
        return { ...node, data: { ...stepData, args: newArgs } }
      }
      return node
    })

    return { nodes: newNodes, edges: newEdges, success: true }
  }

  // Non-parameter connection, just add the edge
  const newEdge: Edge = {
    id: createEdgeId(source, target),
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    targetHandle: targetHandle ?? undefined,
  }
  return { nodes, edges: [...edges, newEdge], success: true }
}

/**
 * Handles reconnecting an existing edge to a new target.
 *
 * - Updates the edge's target
 * - If old edge was parameter → step, clears the old arg value
 * - If new connection is parameter → step, sets the new arg value
 */
export function handleReconnect(
  nodes: Node[],
  edges: Edge[],
  oldEdge: Edge,
  newConnection: Connection
): ConnectionResult {
  const { source, target, targetHandle } = newConnection

  if (!source || !target) {
    return { nodes, edges, success: false }
  }

  // Update edge
  const newEdges = edges.map((e) => {
    if (e.id === oldEdge.id) {
      return {
        ...e,
        source,
        target,
        sourceHandle: newConnection.sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
      }
    }
    return e
  })

  // Determine if we need to set a new parameter connection
  let newParamName: string | null = null
  if (isParameterSource(source) && targetHandle) {
    newParamName = getParameterName(nodes, source)
  }

  // Handle both clearing old and setting new parameter connections atomically
  const newNodes = nodes.map((node) => {
    if (node.type !== 'step') return node

    const stepData = node.data as StepData
    let newArgs = stepData.args || {}
    let changed = false

    // Clear old connection if it was a parameter to step arg
    if (
      isParameterSource(oldEdge.source) &&
      node.id === oldEdge.target &&
      oldEdge.targetHandle
    ) {
      newArgs = { ...newArgs }
      newArgs[oldEdge.targetHandle] = ''
      changed = true
    }

    // Set new connection if connecting a parameter to a step arg
    if (newParamName && node.id === target && targetHandle) {
      newArgs = { ...newArgs, [targetHandle]: `$${newParamName}` }
      changed = true
    }

    return changed ? { ...node, data: { ...stepData, args: newArgs } } : node
  })

  return { nodes: newNodes, edges: newEdges, success: true }
}

/**
 * Handles dropping an edge into empty space (deletes the edge).
 *
 * - Removes the edge
 * - If it was a parameter edge, clears the arg value
 */
export function handleEdgeDrop(
  nodes: Node[],
  edges: Edge[],
  droppedEdge: Edge
): ConnectionResult {
  // Remove the edge
  const newEdges = edges.filter((e) => e.id !== droppedEdge.id)

  // If it was a parameter edge, clear the arg value
  let newNodes = nodes
  if (isParameterSource(droppedEdge.source) && droppedEdge.targetHandle) {
    newNodes = nodes.map((node) => {
      if (node.id === droppedEdge.target && node.type === 'step') {
        const stepData = node.data as StepData
        const newArgs = { ...(stepData.args || {}) }
        newArgs[droppedEdge.targetHandle!] = ''
        return { ...node, data: { ...stepData, args: newArgs } }
      }
      return node
    })
  }

  return { nodes: newNodes, edges: newEdges, success: true }
}

/**
 * Handles disconnecting a parameter from a step arg.
 *
 * - Removes the edge connecting parameter to arg
 * - Clears the step's arg value
 */
export function handleDisconnectArg(
  nodes: Node[],
  edges: Edge[],
  stepId: string,
  argKey: string
): ConnectionResult {
  // Remove the edge
  const newEdges = edges.filter(
    (edge) => !(edge.target === stepId && edge.targetHandle === argKey)
  )

  // Clear the arg value
  const newNodes = nodes.map((node) => {
    if (node.id === stepId && node.type === 'step') {
      const stepData = node.data as StepData
      const newArgs = { ...(stepData.args || {}) }
      newArgs[argKey] = ''
      return { ...node, data: { ...stepData, args: newArgs } }
    }
    return node
  })

  return { nodes: newNodes, edges: newEdges, success: true }
}

/**
 * Handles deleting a node and cleaning up related edges and references.
 *
 * - Removes the node
 * - Removes all edges connected to the node
 * - If deleting a parameter node, clears arg values in connected steps
 */
export function handleDeleteNode(
  nodes: Node[],
  edges: Edge[],
  nodeId: string
): ConnectionResult {
  const nodeToDelete = nodes.find((n) => n.id === nodeId)
  if (!nodeToDelete) {
    return { nodes, edges, success: false }
  }

  // Remove edges connected to this node
  const newEdges = edges.filter(
    (edge) => edge.source !== nodeId && edge.target !== nodeId
  )

  // If deleting a parameter node, clear arg references in connected steps
  let newNodes: Node[]
  if (nodeToDelete.type === 'parameter') {
    // Find all edges from this parameter to step args
    const paramEdges = edges.filter(
      (e) => e.source === nodeId && e.targetHandle
    )

    newNodes = nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => {
        if (node.type !== 'step') return node

        const affectedEdge = paramEdges.find((e) => e.target === node.id)
        if (!affectedEdge || !affectedEdge.targetHandle) return node

        const stepData = node.data as StepData
        const newArgs = { ...(stepData.args || {}) }
        newArgs[affectedEdge.targetHandle] = ''
        return { ...node, data: { ...stepData, args: newArgs } }
      })
  } else {
    newNodes = nodes.filter((node) => node.id !== nodeId)
  }

  return { nodes: newNodes, edges: newEdges, success: true }
}
