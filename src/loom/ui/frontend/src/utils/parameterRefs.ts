import type { Edge } from '@xyflow/react'
import type { ParameterNode, PipelineNode, StepData } from '../types/pipeline'
import { estimateParamWidth } from './layout'

// Layout constants for synthetic parameter reference nodes (match the step node
// component structure so refs align with the target step's handle rows).
const STEP_HEADER_HEIGHT = 50
const LOOP_BLOCK_HEIGHT = 78
const HANDLE_ROW_HEIGHT = 26
const REF_HORIZONTAL_GAP = 140
const REF_NODE_HEIGHT = 60

/** Data flag marking a node as an auto-generated parameter reference. */
export const AUTO_PARAM_REF_FLAG = 'isAutoParamRef'

/** A placed rectangle used to keep refs from overlapping existing nodes. */
type Rect = { x: number; y: number; width: number }

export interface SplitParameterRefsResult {
  nodes: PipelineNode[]
  edges: Edge[]
}

/** True when this node was auto-generated as a parameter reference. */
export function isAutoParamRef(node: PipelineNode): boolean {
  return node.type === 'parameter' && node.data[AUTO_PARAM_REF_FLAG] === true
}

/**
 * Split parameter nodes with multiple outgoing edges into real reference nodes,
 * one per non-primary edge. Returns the SAME `nodes`/`edges` references when no
 * parameter node has more than one outgoing edge (callers rely on this to treat
 * the call as a no-op and avoid render loops).
 */
export function splitParameterRefNodes(
  nodes: PipelineNode[],
  edges: Edge[],
): SplitParameterRefsResult {
  const paramNodes = nodes.filter((n): n is ParameterNode => n.type === 'parameter')

  // Determine which parameters need splitting and their primary edge
  const splitParamIds = new Set<string>()
  const primaryByParam = new Map<string, Edge>()
  for (const param of paramNodes) {
    const outEdges = edges.filter((e) => e.source === param.id)
    if (outEdges.length <= 1) continue
    splitParamIds.add(param.id)
    primaryByParam.set(param.id, selectPrimaryEdge(param, outEdges, nodes))
  }

  if (splitParamIds.size === 0) {
    return { nodes, edges }
  }

  // Rectangles already claimed by the original parameter nodes; refs must not
  // overlap these or any ref placed before them.
  const placedRects: Rect[] = paramNodes.map((p) => ({
    x: p.position.x,
    y: p.position.y,
    width: estimateParamWidth(p.data as Record<string, unknown>),
  }))

  // Build the synthetic refs (node + rewritten edge) per split parameter
  const usedRefIds = new Set<string>()
  const refsByParam = new Map<string, ParameterNode[]>()
  const rewrittenEdgeByRefId = new Map<string, Edge>()
  for (const param of paramNodes) {
    if (!splitParamIds.has(param.id)) continue
    const outEdges = edges.filter((e) => e.source === param.id)
    const primary = primaryByParam.get(param.id)!
    const refs: ParameterNode[] = []
    const refWidth = estimateParamWidth(param.data as Record<string, unknown>)
    outEdges.forEach((edge) => {
      if (edge.id === primary.id) return
      const refId = buildRefId(param, edge, usedRefIds)
      const base = computeRefPosition(param, edge, nodes, refs.length)
      const position = avoidOverlap(base, refWidth, placedRects)
      placedRects.push({ x: position.x, y: position.y, width: refWidth })
      refs.push({
        id: refId,
        type: 'parameter',
        position,
        data: { ...param.data, isAutoParamRef: true },
      })
      rewrittenEdgeByRefId.set(refId, {
        ...edge,
        id: `e_${refId}_${edge.target}_${edge.targetHandle ?? ''}`,
        source: refId,
      })
    })
    refsByParam.set(param.id, refs)
  }

  // Map each split param's non-primary edge position to its rewritten edge
  const rewrittenByIndex = new Map<number, Edge>()
  for (const param of paramNodes) {
    if (!splitParamIds.has(param.id)) continue
    const primary = primaryByParam.get(param.id)!
    const refs = refsByParam.get(param.id)!
    let refIdx = 0
    edges.forEach((edge, i) => {
      if (edge.source === param.id && edge.id !== primary.id) {
        rewrittenByIndex.set(i, rewrittenEdgeByRefId.get(refs[refIdx].id)!)
        refIdx += 1
      }
    })
  }

  // Result nodes: original order with each split param's refs right after it
  const resultNodes: PipelineNode[] = []
  for (const node of nodes) {
    resultNodes.push(node)
    if (node.type === 'parameter') {
      const refs = refsByParam.get(node.id)
      if (refs) resultNodes.push(...refs)
    }
  }

  // Result edges: input order, replacing non-primary edges of split params
  const resultEdges = edges.map((edge, i) => rewrittenByIndex.get(i) ?? edge)

  return { nodes: resultNodes, edges: resultEdges }
}

/**
 * Inverse of splitParameterRefNodes for persistence: removes auto-ref nodes and
 * re-points their edges at the canonical `param_<name>` node. Returns the SAME
 * references when there are no auto-ref nodes.
 */
export function collapseParameterRefs(
  nodes: PipelineNode[],
  edges: Edge[],
): SplitParameterRefsResult {
  const autoRefById = new Map<string, ParameterNode>()
  for (const node of nodes) {
    if (node.type === 'parameter' && node.data[AUTO_PARAM_REF_FLAG] === true) {
      autoRefById.set(node.id, node)
    }
  }

  if (autoRefById.size === 0) {
    return { nodes, edges }
  }

  const resultNodes = nodes.filter((n) => !autoRefById.has(n.id))
  const resultEdges = edges.map((edge) => {
    const refNode = autoRefById.get(edge.source)
    if (!refNode) return edge
    const canonical = `param_${refNode.data.name}`
    return {
      ...edge,
      id: `e_${canonical}_${edge.target}_${edge.targetHandle ?? ''}`,
      source: canonical,
    }
  })

  return { nodes: resultNodes, edges: resultEdges }
}

/**
 * Pick the primary edge of a split parameter: the one whose target node
 * position is nearest (squared Euclidean distance) to the parameter node.
 * Ties are broken by edge id (lexicographically ascending). Missing target
 * nodes count as infinitely far away.
 */
function selectPrimaryEdge(param: ParameterNode, outEdges: Edge[], nodes: PipelineNode[]): Edge {
  let primary = outEdges[0]
  let primaryDist = Infinity
  for (const edge of outEdges) {
    const target = nodes.find((n) => n.id === edge.target)
    const dist = target ? squaredDistance(param.position, target.position) : Infinity
    if (dist < primaryDist || (dist === primaryDist && edge.id < primary.id)) {
      primary = edge
      primaryDist = dist
    }
  }
  return primary
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Compute a synthetic ref's node id. Sanitizes the target and handle into
 * id-safe segments, guarding against duplicate ids with an incrementing `__k`.
 */
function buildRefId(param: ParameterNode, edge: Edge, usedRefIds: Set<string>): string {
  const name = String(param.data.name)
  const target = String(edge.target)
  const handle = String(edge.targetHandle ?? 'value')
  const base = `param_${name}__autoref__${sanitize(target)}__${sanitize(handle)}`
  let refId = base
  let k = 1
  while (usedRefIds.has(refId)) {
    refId = `${base}__${k}`
    k += 1
  }
  usedRefIds.add(refId)
  return refId
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]+/g, '_')
}

/**
 * Base position for a synthetic ref: to the left of its target step, vertically
 * centered on the handle row the edge connects to. Falls back to a spot below
 * the original parameter node when the target is missing or not a step node.
 * Overlap avoidance with already-placed nodes happens in the caller.
 */
function computeRefPosition(
  param: ParameterNode,
  edge: Edge,
  nodes: PipelineNode[],
  indexAmongRefs: number,
): { x: number; y: number } {
  const target = nodes.find((n) => n.id === edge.target)
  if (!target || target.type !== 'step') {
    return {
      x: param.position.x + 260,
      y: param.position.y + 80 * (indexAmongRefs + 1),
    }
  }

  const data = target.data as StepData
  const handleOrder = [
    ...Object.keys(data.inputs || {}),
    ...Object.keys(data.args || {}),
    ...Object.keys(data.outputs || {}),
  ]
  let idx = handleOrder.indexOf(String(edge.targetHandle))
  if (idx < 0) idx = 0

  const yOffset =
    STEP_HEADER_HEIGHT +
    (data.loop ? LOOP_BLOCK_HEIGHT : 0) +
    idx * HANDLE_ROW_HEIGHT +
    HANDLE_ROW_HEIGHT / 2
  const refWidth = estimateParamWidth(param.data as Record<string, unknown>)

  return {
    x: target.position.x - REF_HORIZONTAL_GAP - refWidth,
    y: target.position.y + yOffset - REF_NODE_HEIGHT / 2,
  }
}

/**
 * Shift the candidate position down in REF_NODE_HEIGHT + 8 steps until it no
 * longer overlaps any placed rectangle. Deterministic: refs are placed in a
 * fixed order, so the result is stable for a given input.
 */
function avoidOverlap(
  base: { x: number; y: number },
  refWidth: number,
  placedRects: Rect[],
): { x: number; y: number } {
  const candidate = { ...base }
  while (placedRects.some((rect) => refOverlaps(candidate, refWidth, rect))) {
    candidate.y += REF_NODE_HEIGHT + 8
  }
  return candidate
}

function refOverlaps(candidate: { x: number; y: number }, refWidth: number, rect: Rect): boolean {
  return (
    candidate.x < rect.x + rect.width &&
    candidate.x + refWidth > rect.x &&
    candidate.y < rect.y + REF_NODE_HEIGHT + 8 &&
    candidate.y + REF_NODE_HEIGHT + 8 > rect.y
  )
}
