import type { Node, Edge } from '@xyflow/react'
import type { StepData, DataNodeData } from '../types/pipeline'

/**
 * Dependency graph for pipeline steps.
 * Tracks which steps depend on which other steps through variable connections.
 */
export interface DependencyGraph {
  /** Get all steps that must complete before this step can run (transitive) */
  getUpstream(stepId: string): Set<string>

  /** Get all steps that depend on this step's outputs (transitive) */
  getDownstream(stepId: string): Set<string>

  /** Get immediate upstream steps (direct dependencies only) */
  getDirectUpstream(stepId: string): Set<string>

  /** Get immediate downstream steps (direct dependents only) */
  getDirectDownstream(stepId: string): Set<string>

  /** Check if two steps have conflicting outputs (produce same variable) */
  hasOutputConflict(stepA: string, stepB: string): boolean

  /** Get all steps blocked by currently running steps (running + their downstream) */
  getBlockedSteps(runningSteps: Set<string>): Set<string>

  /** Get all step IDs in the graph */
  getAllStepIds(): Set<string>

  /** Detect circular dependencies in the graph. Returns set of step IDs involved in cycles. */
  detectCycles(): Set<string>

  /** Check if the graph has any circular dependencies */
  hasCycles(): boolean
}

/**
 * Build a dependency graph from React Flow nodes and edges.
 *
 * The graph is built by analyzing:
 * - step -> variable edges (step produces variable)
 * - variable -> step edges (step consumes variable)
 *
 * This creates implicit step -> step dependencies through shared variables.
 */
export function buildDependencyGraph(nodes: Node[], edges: Edge[]): DependencyGraph {
  // Maps for quick lookups
  const stepIds = new Set<string>()
  const variableIds = new Set<string>()
  const dataIds = new Set<string>()

  // variable/data -> step that produces it
  const variableProducers = new Map<string, string>()
  // variable/data -> steps that consume it
  const variableConsumers = new Map<string, Set<string>>()

  // Categorize nodes
  for (const node of nodes) {
    if (node.type === 'step') {
      stepIds.add(node.id)
    } else if (node.type === 'variable') {
      variableIds.add(node.id)
    } else if (node.type === 'data') {
      dataIds.add(node.id)
    }
  }

  // Initialize consumer sets for variables and data nodes
  for (const varId of variableIds) {
    variableConsumers.set(varId, new Set())
  }
  for (const dataId of dataIds) {
    variableConsumers.set(dataId, new Set())
  }

  // Helper to check if a node is a variable or data node (both act as data sources/sinks)
  const isDataSource = (id: string) => variableIds.has(id) || dataIds.has(id)

  // Process edges to build producer/consumer relationships
  for (const edge of edges) {
    const { source, target } = edge

    // Step -> Variable/Data edge (step produces variable/data)
    if (stepIds.has(source) && isDataSource(target)) {
      variableProducers.set(target, source)
    }
    // Variable/Data -> Step edge (step consumes variable/data)
    else if (isDataSource(source) && stepIds.has(target)) {
      const consumers = variableConsumers.get(source)
      if (consumers) {
        consumers.add(target)
      }
    }
  }

  // Direct dependency maps (step -> steps)
  const directUpstream = new Map<string, Set<string>>()
  const directDownstream = new Map<string, Set<string>>()

  // Initialize
  for (const stepId of stepIds) {
    directUpstream.set(stepId, new Set())
    directDownstream.set(stepId, new Set())
  }

  // Build direct dependencies through variables
  for (const [varId, producerStep] of variableProducers) {
    const consumers = variableConsumers.get(varId) ?? new Set()

    for (const consumerStep of consumers) {
      // consumerStep depends on producerStep
      directUpstream.get(consumerStep)?.add(producerStep)
      // producerStep has consumerStep as downstream
      directDownstream.get(producerStep)?.add(consumerStep)
    }
  }

  // Track outputs per step for conflict detection
  // Build directly from edges to handle multiple producers case
  const stepOutputs = new Map<string, Set<string>>()
  for (const stepId of stepIds) {
    stepOutputs.set(stepId, new Set())
  }
  for (const edge of edges) {
    const { source, target } = edge
    // Step -> Variable/Data edge (step produces variable/data)
    if (stepIds.has(source) && isDataSource(target)) {
      stepOutputs.get(source)?.add(target)
    }
  }

  // Memoization caches for transitive closures
  const upstreamCache = new Map<string, Set<string>>()
  const downstreamCache = new Map<string, Set<string>>()

  /** Compute transitive upstream (all ancestors) using BFS */
  function computeUpstream(stepId: string): Set<string> {
    if (upstreamCache.has(stepId)) {
      return upstreamCache.get(stepId)!
    }

    const result = new Set<string>()
    const queue = [...(directUpstream.get(stepId) ?? [])]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      result.add(current)

      for (const upstream of directUpstream.get(current) ?? []) {
        if (!visited.has(upstream)) {
          queue.push(upstream)
        }
      }
    }

    upstreamCache.set(stepId, result)
    return result
  }

  /** Compute transitive downstream (all descendants) using BFS */
  function computeDownstream(stepId: string): Set<string> {
    if (downstreamCache.has(stepId)) {
      return downstreamCache.get(stepId)!
    }

    const result = new Set<string>()
    const queue = [...(directDownstream.get(stepId) ?? [])]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      result.add(current)

      for (const downstream of directDownstream.get(current) ?? []) {
        if (!visited.has(downstream)) {
          queue.push(downstream)
        }
      }
    }

    downstreamCache.set(stepId, result)
    return result
  }

  return {
    getUpstream(stepId: string): Set<string> {
      if (!stepIds.has(stepId)) return new Set()
      return computeUpstream(stepId)
    },

    getDownstream(stepId: string): Set<string> {
      if (!stepIds.has(stepId)) return new Set()
      return computeDownstream(stepId)
    },

    getDirectUpstream(stepId: string): Set<string> {
      return directUpstream.get(stepId) ?? new Set()
    },

    getDirectDownstream(stepId: string): Set<string> {
      return directDownstream.get(stepId) ?? new Set()
    },

    hasOutputConflict(stepA: string, stepB: string): boolean {
      const outputsA = stepOutputs.get(stepA) ?? new Set()
      const outputsB = stepOutputs.get(stepB) ?? new Set()

      for (const output of outputsA) {
        if (outputsB.has(output)) {
          return true
        }
      }
      return false
    },

    getBlockedSteps(runningSteps: Set<string>): Set<string> {
      const blocked = new Set<string>()

      for (const runningStep of runningSteps) {
        // The running step itself is blocked
        blocked.add(runningStep)

        // All upstream steps are blocked (can't re-run something a running step depends on)
        for (const upstream of computeUpstream(runningStep)) {
          blocked.add(upstream)
        }

        // All downstream steps are blocked (their inputs are being produced)
        for (const downstream of computeDownstream(runningStep)) {
          blocked.add(downstream)
        }
      }

      return blocked
    },

    getAllStepIds(): Set<string> {
      return new Set(stepIds)
    },

    detectCycles(): Set<string> {
      const cycleNodes = new Set<string>()
      const visited = new Set<string>()
      const recursionStack = new Set<string>()
      const pathStack: string[] = []

      function dfs(stepId: string): boolean {
        visited.add(stepId)
        recursionStack.add(stepId)
        pathStack.push(stepId)

        for (const downstream of directDownstream.get(stepId) ?? []) {
          if (!visited.has(downstream)) {
            if (dfs(downstream)) {
              return true
            }
          } else if (recursionStack.has(downstream)) {
            // Found a cycle - mark all nodes in the cycle
            const cycleStart = pathStack.indexOf(downstream)
            for (let i = cycleStart; i < pathStack.length; i++) {
              cycleNodes.add(pathStack[i])
            }
            cycleNodes.add(downstream)
          }
        }

        recursionStack.delete(stepId)
        pathStack.pop()
        return false
      }

      // Run DFS from each unvisited node
      for (const stepId of stepIds) {
        if (!visited.has(stepId)) {
          dfs(stepId)
        }
      }

      return cycleNodes
    },

    hasCycles(): boolean {
      const visited = new Set<string>()
      const recursionStack = new Set<string>()

      function dfs(stepId: string): boolean {
        visited.add(stepId)
        recursionStack.add(stepId)

        for (const downstream of directDownstream.get(stepId) ?? []) {
          if (!visited.has(downstream)) {
            if (dfs(downstream)) {
              return true
            }
          } else if (recursionStack.has(downstream)) {
            return true // Cycle detected
          }
        }

        recursionStack.delete(stepId)
        return false
      }

      for (const stepId of stepIds) {
        if (!visited.has(stepId)) {
          if (dfs(stepId)) {
            return true
          }
        }
      }

      return false
    },
  }
}

/**
 * Extract step name from node for cleaner error messages.
 */
export function getStepName(node: Node): string {
  if (node.type === 'step') {
    return (node.data as StepData).name
  }
  if (node.type === 'data') {
    return (node.data as DataNodeData).name
  }
  return node.id
}
