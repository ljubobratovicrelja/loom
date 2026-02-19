import Dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

// Layout constants for parameter nodes positioned outside dagre
const PARAM_NODE_HEIGHT = 60
const PARAM_GAP = 45 // vertical gap between parameter nodes
const PARAM_STEP_GAP = 120 // horizontal gap between parameter column and step

/**
 * Estimate the rendered width of a parameter node from its name length.
 * Accounts for: padding (24px), $ prefix (12px), name text (~8px/char),
 * type badge (40px), handle (15px).
 */
function estimateParamWidth(data: Record<string, unknown>): number {
  const name = (data.name as string) || ''
  return Math.max(120, 90 + name.length * 8)
}

/**
 * Estimate the rendered height of a step node based on its I/O handle count.
 * Matches the StepNode component structure: header + per-handle rows + optional loop.
 */
function estimateStepHeight(data: Record<string, unknown>): number {
  const inputs = data.inputs as Record<string, string> | undefined
  const outputs = data.outputs as Record<string, string> | undefined
  const args = data.args as Record<string, unknown> | undefined
  const numHandles =
    Object.keys(inputs || {}).length +
    Object.keys(outputs || {}).length +
    Object.keys(args || {}).length
  const hasLoop = !!data.loop
  return 50 + numHandles * 26 + (hasLoop ? 70 : 0)
}

/**
 * Apply dagre layout to position nodes in a clean left-to-right flow.
 * Variables on the left, steps flowing right, with output variables between steps.
 * Supports grouped step nodes via dagre compound graphs.
 *
 * Parameter nodes are excluded from dagre and positioned manually relative to
 * their connected step node to avoid massive vertical stacking.
 */
export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  // --- Separate parameter nodes (positioned manually after dagre) ---
  const parameterNodes = nodes.filter((n) => n.type === 'parameter')
  const layoutNodes = nodes.filter((n) => n.type !== 'parameter')
  const layoutNodeIds = new Set(layoutNodes.map((n) => n.id))

  // Map each parameter to the step node it connects to
  const paramToStep = new Map<string, string>()
  edges.forEach((edge) => {
    if (!layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target)) {
      paramToStep.set(edge.source, edge.target)
    }
  })

  // Count parameters per step
  const stepParamCount = new Map<string, number>()
  paramToStep.forEach((stepId) => {
    stepParamCount.set(stepId, (stepParamCount.get(stepId) || 0) + 1)
  })

  // Estimate width per parameter and max width per step
  const paramWidths = new Map<string, number>()
  parameterNodes.forEach((p) => {
    paramWidths.set(p.id, estimateParamWidth(p.data as Record<string, unknown>))
  })

  const stepMaxParamWidth = new Map<string, number>()
  paramToStep.forEach((stepId, paramId) => {
    const w = paramWidths.get(paramId) || 120
    const current = stepMaxParamWidth.get(stepId) || 0
    if (w > current) stepMaxParamWidth.set(stepId, w)
  })

  // Filter edges to only those between layout nodes
  const layoutEdges = edges.filter(
    (e) => layoutNodeIds.has(e.source) && layoutNodeIds.has(e.target),
  )

  // --- Build dagre graph with layout nodes only ---
  // compound: true is required for setParent() to work
  const g = new Dagre.graphlib.Graph({ compound: true }).setDefaultEdgeLabel(() => ({}))

  // Configure layout: left-to-right, with spacing
  g.setGraph({
    rankdir: 'LR', // Left to right
    nodesep: 180, // Vertical spacing between nodes
    ranksep: 240, // Horizontal spacing between ranks
    marginx: 50,
    marginy: 50,
  })

  // Collect unique group names from step nodes before adding them
  const groupNames = new Set<string>()
  layoutNodes.forEach((node) => {
    const group = (node.data as Record<string, unknown>)?.group
    if (typeof group === 'string' && group) {
      groupNames.add(group)
    }
  })

  // Register virtual cluster nodes for each group (must exist before setParent).
  // paddingTop reserves space for the group label so external nodes don't overlap it.
  groupNames.forEach((name) => {
    g.setNode(`_group_${name}`, { paddingTop: 50, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 })
  })

  // Build a map from node id to group for step nodes
  const nodeGroupMap = new Map<string, string>()
  layoutNodes.forEach((node) => {
    const group = (node.data as Record<string, unknown>)?.group
    if (typeof group === 'string' && group) {
      nodeGroupMap.set(node.id, group)
    }
  })

  // Build adjacency: for each layout node, collect the groups of its step neighbors
  const nodeNeighborGroups = new Map<string, Set<string>>()
  layoutEdges.forEach((edge) => {
    const srcGroup = nodeGroupMap.get(edge.source)
    const tgtGroup = nodeGroupMap.get(edge.target)
    if (srcGroup) {
      if (!nodeNeighborGroups.has(edge.target)) nodeNeighborGroups.set(edge.target, new Set())
      nodeNeighborGroups.get(edge.target)!.add(srcGroup)
    }
    if (tgtGroup) {
      if (!nodeNeighborGroups.has(edge.source)) nodeNeighborGroups.set(edge.source, new Set())
      nodeNeighborGroups.get(edge.source)!.add(tgtGroup)
    }
  })

  // Add layout nodes to the graph with their dimensions
  layoutNodes.forEach((node) => {
    let width: number, height: number
    if (node.type === 'data') {
      width = 180
      height = 70
    } else {
      // Step node: estimate rendered height from I/O count
      const data = node.data as Record<string, unknown>
      height = estimateStepHeight(data)

      // If this step has parameter inputs, widen the dagre node to reserve
      // horizontal space for the parameter column to the left of the step
      const paramCount = stepParamCount.get(node.id) || 0
      const maxParamW = stepMaxParamWidth.get(node.id) || 0
      width = 250 + (paramCount > 0 ? maxParamW + PARAM_STEP_GAP : 0)
    }
    g.setNode(node.id, { width, height })

    // Assign grouped step nodes to their virtual cluster parent
    const group = nodeGroupMap.get(node.id)
    if (group) {
      g.setParent(node.id, `_group_${group}`)
    } else {
      // For non-step nodes (data): if all connected step neighbors
      // belong to the same group, parent this node to that group too
      const neighborGroups = nodeNeighborGroups.get(node.id)
      if (neighborGroups && neighborGroups.size === 1) {
        const soleGroup = [...neighborGroups][0]
        g.setParent(node.id, `_group_${soleGroup}`)
      }
    }
  })

  // Add edges to the graph
  layoutEdges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  // Run the layout algorithm
  Dagre.layout(g)

  // --- Position layout nodes ---
  // For step nodes with parameters, shift the step to the right within
  // the dagre-allocated width to leave room for the parameter column.
  const layoutResult = layoutNodes.map((node) => {
    const layoutNode = g.node(node.id)
    const paramCount = stepParamCount.get(node.id) || 0
    const maxParamW = stepMaxParamWidth.get(node.id) || 0
    const paramOffset = paramCount > 0 ? maxParamW + PARAM_STEP_GAP : 0
    return {
      ...node,
      position: {
        // Dagre returns center position, adjust to top-left
        // For steps with params, shift right to leave room for param column
        x: layoutNode.x - (layoutNode.width ?? 0) / 2 + paramOffset,
        y: layoutNode.y - (layoutNode.height ?? 0) / 2,
      },
    }
  })

  // --- Position parameter nodes relative to their connected step ---
  const stepToParams = new Map<string, Node[]>()
  parameterNodes.forEach((p) => {
    const stepId = paramToStep.get(p.id)
    if (stepId) {
      if (!stepToParams.has(stepId)) stepToParams.set(stepId, [])
      stepToParams.get(stepId)!.push(p)
    }
  })

  const positionedParams: Node[] = []
  stepToParams.forEach((params, stepId) => {
    const stepLayout = g.node(stepId)
    if (!stepLayout) return

    const maxParamW = stepMaxParamWidth.get(stepId) || 200

    // Step's top-left x after the param offset shift
    const stepX = stepLayout.x - (stepLayout.width ?? 0) / 2 + maxParamW + PARAM_STEP_GAP

    // Center of the parameter column (horizontally)
    const columnCenterX = stepX - PARAM_STEP_GAP - maxParamW / 2

    // Center the parameter stack vertically relative to the step's center
    const paramStackHeight = params.length * (PARAM_NODE_HEIGHT + PARAM_GAP) - PARAM_GAP
    const startY = stepLayout.y - paramStackHeight / 2

    params.forEach((param, i) => {
      // Center each parameter horizontally based on its estimated width
      const paramW = paramWidths.get(param.id) || 120
      positionedParams.push({
        ...param,
        position: {
          x: columnCenterX - paramW / 2,
          y: startY + i * (PARAM_NODE_HEIGHT + PARAM_GAP),
        },
      })
    })
  })

  // Handle orphan parameters (not connected to any step)
  const orphanParams = parameterNodes.filter((p) => !paramToStep.has(p.id))
  if (orphanParams.length > 0) {
    const allPositioned = [...layoutResult, ...positionedParams]
    const maxY = allPositioned.length > 0 ? Math.max(...allPositioned.map((n) => n.position.y)) : 0
    orphanParams.forEach((param, i) => {
      positionedParams.push({
        ...param,
        position: {
          x: 20,
          y: maxY + 100 + i * (PARAM_NODE_HEIGHT + PARAM_GAP),
        },
      })
    })
  }

  return [...layoutResult, ...positionedParams]
}
