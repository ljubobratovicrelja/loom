import type { Node, Edge } from '@xyflow/react'
import type { ConditionData, DataNodeData, LogicStatus, SwitchData } from '../types/pipeline'
import { buildDependencyGraph } from './dependencyGraph'

export interface BranchActivity {
  /** Node IDs (steps and data) that belong to a branch that was not taken. */
  inactiveNodeIds: Set<string>
  /** Edge IDs incident to an inactive node or leaving a non-taken branch. */
  inactiveEdgeIds: Set<string>
}

const EMPTY_STATUS: LogicStatus = { conditions: {}, branches: {}, errors: {} }

function dataNodeForKey(nodes: Node[], key: string): Node | undefined {
  return nodes.find((n) => n.type === 'data' && (n.data as DataNodeData).key === key)
}

/**
 * Whether a `$ref` used by a condition is backed by data that actually exists.
 *
 * Data refs require the matching data node to report `exists === true`; anything
 * else (parameters, literals, unknown refs) is considered available. This is the
 * "no data -> no decision" rule: a condition whose input file is gone yields no
 * result, so its switch does not pick a branch.
 */
function refAvailable(nodes: Node[], ref: unknown): boolean {
  if (typeof ref !== 'string' || !ref.startsWith('$')) return true
  const name = ref.slice(1)
  if (name.includes('.')) return true // branch alias
  const node = dataNodeForKey(nodes, name)
  if (!node) return true // parameter or unknown -> don't block
  return (node.data as DataNodeData).exists === true
}

/** True when every declared input of a condition node is wired and has data. */
export function conditionInputsAvailable(
  conditionNode: Node,
  nodes: Node[],
  edges: Edge[],
): boolean {
  const inputs = (conditionNode.data as ConditionData).inputs ?? {}
  return Object.entries(inputs).every(
    ([name, ref]) =>
      edges.some((e) => e.target === conditionNode.id && e.targetHandle === name) &&
      refAvailable(nodes, ref),
  )
}

/**
 * A switch's branch is only meaningful when its condition and payload are wired
 * in the editor graph *and* the underlying data exists:
 *
 * - the switch has `condition` and `data` edges;
 * - the payload data node reports `exists === true`;
 * - when driven by a condition node, every declared input of that condition has
 *   available data.
 *
 * Otherwise the branch is *unknown* and must not fade anything.
 */
function isSwitchConditionKnown(
  switchId: string,
  switchData: SwitchData,
  nodes: Node[],
  edges: Edge[],
): boolean {
  const ref = switchData.condition
  if (typeof ref !== 'string' || ref.trim() === '') return false

  // Payload must be connected and exist.
  const payloadEdge = edges.find((e) => e.target === switchId && e.targetHandle === 'data')
  if (!payloadEdge) return false
  const payloadNode = nodes.find((n) => n.id === payloadEdge.source)
  if (!payloadNode || payloadNode.type !== 'data') return false
  if ((payloadNode.data as DataNodeData).exists !== true) return false

  const incoming = edges.find((e) => e.target === switchId && e.targetHandle === 'condition')
  if (!incoming) return false

  const source = nodes.find((n) => n.id === incoming.source)
  if (!source) return false
  if (source.type === 'parameter') return true
  if (source.type !== 'condition') return false

  return conditionInputsAvailable(source, nodes, edges)
}

/**
 * The branches that actually apply, i.e. switches whose decision is "known":
 * condition and payload wired, and the underlying data present. Anything not in
 * this map must be treated as undecided (no fade, no taken-branch highlight).
 */
export function resolvedSwitchBranches(
  nodes: Node[],
  edges: Edge[],
  status: LogicStatus | null | undefined,
): Map<string, 'then' | 'else'> {
  const resolved = new Map<string, 'then' | 'else'>()
  const logic = status ?? EMPTY_STATUS
  if (Object.keys(logic.branches).length === 0) {
    return resolved
  }
  for (const node of nodes) {
    if (node.type !== 'switch') continue
    const sd = node.data as SwitchData
    const taken = logic.branches[sd.name]
    if (taken !== 'then' && taken !== 'else') continue
    if (!isSwitchConditionKnown(node.id, sd, nodes, edges)) continue
    resolved.set(node.id, taken)
  }
  return resolved
}

/**
 * Compute which nodes/edges belong to a switch branch that was not taken,
 * based on the evaluated logic status.
 *
 * A step is inactive if it is directly wired from a non-taken switch branch, or
 * is downstream of such a step. Edges are inactive if incident to an inactive
 * node. Data nodes whose every incident edge is inactive are inactive too.
 */
export function computeBranchActivity(
  nodes: Node[],
  edges: Edge[],
  status: LogicStatus | null | undefined,
): BranchActivity {
  const inactiveNodeIds = new Set<string>()
  const inactiveEdgeIds = new Set<string>()

  const switchTaken = resolvedSwitchBranches(nodes, edges, status)
  if (switchTaken.size === 0) {
    return { inactiveNodeIds, inactiveEdgeIds }
  }

  // Seed: steps wired from a non-taken branch handle.
  for (const edge of edges) {
    const taken = switchTaken.get(edge.source)
    if (!taken) continue
    if (edge.sourceHandle !== 'then' && edge.sourceHandle !== 'else') continue
    if (edge.sourceHandle !== taken && edge.target) {
      inactiveNodeIds.add(edge.target)
    }
  }

  // Propagate downstream (a skipped step's outputs are unavailable).
  if (inactiveNodeIds.size > 0) {
    const graph = buildDependencyGraph(nodes, edges)
    for (const seed of [...inactiveNodeIds]) {
      for (const downstream of graph.getDownstream(seed)) {
        inactiveNodeIds.add(downstream)
      }
    }
  }

  // Edges incident to an inactive node are inactive.
  for (const edge of edges) {
    if (inactiveNodeIds.has(edge.source) || inactiveNodeIds.has(edge.target)) {
      inactiveEdgeIds.add(edge.id)
    }
  }

  // A data node is inactive when all of its incident edges are inactive.
  for (const node of nodes) {
    if (node.type !== 'data') continue
    const incident = edges.filter((e) => e.source === node.id || e.target === node.id)
    if (incident.length > 0 && incident.every((e) => inactiveEdgeIds.has(e.id))) {
      inactiveNodeIds.add(node.id)
    }
  }

  return { inactiveNodeIds, inactiveEdgeIds }
}
