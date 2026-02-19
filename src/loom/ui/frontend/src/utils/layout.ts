import Dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

/**
 * Apply dagre layout to position nodes in a clean left-to-right flow.
 * Variables on the left, steps flowing right, with output variables between steps.
 * Supports grouped step nodes via dagre compound graphs.
 */
export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  // compound: true is required for setParent() to work
  const g = new Dagre.graphlib.Graph({ compound: true }).setDefaultEdgeLabel(() => ({}))

  // Configure layout: left-to-right, with spacing
  g.setGraph({
    rankdir: 'LR', // Left to right
    nodesep: 40, // Vertical spacing between nodes
    ranksep: 40, // Horizontal spacing between ranks
    marginx: 20,
    marginy: 20,
  })

  // Collect unique group names from step nodes before adding them
  const groupNames = new Set<string>()
  nodes.forEach((node) => {
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
  nodes.forEach((node) => {
    const group = (node.data as Record<string, unknown>)?.group
    if (typeof group === 'string' && group) {
      nodeGroupMap.set(node.id, group)
    }
  })

  // Build adjacency: for each node, collect the groups of its step neighbors
  const nodeNeighborGroups = new Map<string, Set<string>>()
  edges.forEach((edge) => {
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

  // Add nodes to the graph with their dimensions
  nodes.forEach((node) => {
    // Estimate node dimensions based on type
    const width = node.type === 'variable' ? 180 : 250
    const height = node.type === 'variable' ? 70 : 150
    g.setNode(node.id, { width, height })

    // Assign grouped step nodes to their virtual cluster parent
    const group = nodeGroupMap.get(node.id)
    if (group) {
      g.setParent(node.id, `_group_${group}`)
    } else {
      // For non-step nodes (data, parameter): if all connected step neighbors
      // belong to the same group, parent this node to that group too
      const neighborGroups = nodeNeighborGroups.get(node.id)
      if (neighborGroups && neighborGroups.size === 1) {
        const soleGroup = [...neighborGroups][0]
        g.setParent(node.id, `_group_${soleGroup}`)
      }
    }
  })

  // Add edges to the graph
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  // Run the layout algorithm
  Dagre.layout(g)

  // Build a set of original node IDs to filter out virtual cluster nodes
  const originalIds = new Set(nodes.map((n) => n.id))

  // Apply computed positions to nodes (exclude virtual _group_ cluster nodes)
  return nodes
    .filter((node) => originalIds.has(node.id))
    .map((node) => {
      const layoutNode = g.node(node.id)
      return {
        ...node,
        position: {
          // Dagre returns center position, adjust to top-left
          x: layoutNode.x - (layoutNode.width ?? 0) / 2,
          y: layoutNode.y - (layoutNode.height ?? 0) / 2,
        },
      }
    })
}
