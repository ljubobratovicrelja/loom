import Dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

/**
 * Apply dagre layout to position nodes in a clean left-to-right flow.
 * Variables on the left, steps flowing right, with output variables between steps.
 */
export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))

  // Configure layout: left-to-right, with spacing
  g.setGraph({
    rankdir: 'LR', // Left to right
    nodesep: 80, // Vertical spacing between nodes
    ranksep: 150, // Horizontal spacing between ranks
    marginx: 50,
    marginy: 50,
  })

  // Add nodes to the graph with their dimensions
  nodes.forEach((node) => {
    // Estimate node dimensions based on type
    const width = node.type === 'variable' ? 180 : 250
    const height = node.type === 'variable' ? 70 : 150
    g.setNode(node.id, { width, height })
  })

  // Add edges to the graph
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  // Run the layout algorithm
  Dagre.layout(g)

  // Apply computed positions to nodes
  return nodes.map((node) => {
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
