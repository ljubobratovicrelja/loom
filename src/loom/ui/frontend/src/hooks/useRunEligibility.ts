import { useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { StepExecutionState, StepData } from '../types/pipeline'
import { buildDependencyGraph } from '../utils/dependencyGraph'

export type BlockReason = 'running' | 'upstream_running' | 'downstream_running' | 'output_conflict' | 'disabled' | 'incomplete'

export interface RunEligibility {
  canRun: boolean
  reason?: BlockReason
  blockedBy?: string[] // Step names that are causing the block
}

/**
 * Hook that computes which steps can currently run based on:
 * - Which steps are currently running
 * - Dependency relationships between steps
 * - Output conflicts
 */
export function useRunEligibility(
  nodes: Node[],
  edges: Edge[],
  stepStatuses: Map<string, StepExecutionState>
): Map<string, RunEligibility> {
  // Build dependency graph (memoized)
  const graph = useMemo(() => buildDependencyGraph(nodes, edges), [nodes, edges])

  // Compute eligibility for each step
  const eligibility = useMemo(() => {
    const result = new Map<string, RunEligibility>()

    // Get set of running steps
    const runningSteps = new Set<string>()
    for (const [stepId, status] of stepStatuses) {
      if (status === 'running') {
        runningSteps.add(stepId)
      }
    }

    // Get all step nodes
    const stepNodes = nodes.filter((n) => n.type === 'step')

    for (const node of stepNodes) {
      const stepId = node.id
      const stepData = node.data as StepData
      const _stepName = stepData.name  // Kept for debugging

      // Check if step is disabled
      if (stepData.disabled) {
        result.set(stepId, {
          canRun: false,
          reason: 'disabled',
        })
        continue
      }

      // Check if step is incomplete (missing required connections)
      const hasInputTypes = stepData.inputTypes && Object.keys(stepData.inputTypes).length > 0
      const hasOutputTypes = stepData.outputTypes && Object.keys(stepData.outputTypes).length > 0
      const hasInputs = Object.keys(stepData.inputs).length > 0
      const hasOutputs = Object.keys(stepData.outputs).length > 0

      if ((hasInputTypes && !hasInputs) || (hasOutputTypes && !hasOutputs)) {
        result.set(stepId, {
          canRun: false,
          reason: 'incomplete',
        })
        continue
      }

      // Check if this step is currently running
      if (runningSteps.has(stepId)) {
        result.set(stepId, {
          canRun: false,
          reason: 'running',
        })
        continue
      }

      // Check if any upstream step is running
      const upstream = graph.getUpstream(stepId)
      const runningUpstream: string[] = []
      for (const upstreamId of upstream) {
        if (runningSteps.has(upstreamId)) {
          const upstreamNode = nodes.find((n) => n.id === upstreamId)
          if (upstreamNode?.type === 'step') {
            runningUpstream.push((upstreamNode.data as StepData).name)
          }
        }
      }
      if (runningUpstream.length > 0) {
        result.set(stepId, {
          canRun: false,
          reason: 'upstream_running',
          blockedBy: runningUpstream,
        })
        continue
      }

      // Check if any downstream step is running (would invalidate our outputs)
      const downstream = graph.getDownstream(stepId)
      const runningDownstream: string[] = []
      for (const downstreamId of downstream) {
        if (runningSteps.has(downstreamId)) {
          const downstreamNode = nodes.find((n) => n.id === downstreamId)
          if (downstreamNode?.type === 'step') {
            runningDownstream.push((downstreamNode.data as StepData).name)
          }
        }
      }
      if (runningDownstream.length > 0) {
        result.set(stepId, {
          canRun: false,
          reason: 'downstream_running',
          blockedBy: runningDownstream,
        })
        continue
      }

      // Check for output conflicts with running steps
      const conflictingSteps: string[] = []
      for (const runningStepId of runningSteps) {
        if (graph.hasOutputConflict(stepId, runningStepId)) {
          const runningNode = nodes.find((n) => n.id === runningStepId)
          if (runningNode?.type === 'step') {
            conflictingSteps.push((runningNode.data as StepData).name)
          }
        }
      }
      if (conflictingSteps.length > 0) {
        result.set(stepId, {
          canRun: false,
          reason: 'output_conflict',
          blockedBy: conflictingSteps,
        })
        continue
      }

      // Step can run
      result.set(stepId, { canRun: true })
    }

    return result
  }, [nodes, stepStatuses, graph])

  return eligibility
}

/**
 * Get a human-readable message for why a step can't run.
 */
export function getBlockReasonMessage(eligibility: RunEligibility): string | null {
  if (eligibility.canRun) return null

  switch (eligibility.reason) {
    case 'running':
      return 'This step is already running'
    case 'upstream_running':
      return `Waiting for: ${eligibility.blockedBy?.join(', ')}`
    case 'downstream_running':
      return `Downstream step running: ${eligibility.blockedBy?.join(', ')}`
    case 'output_conflict':
      return `Output conflict with: ${eligibility.blockedBy?.join(', ')}`
    case 'disabled':
      return 'This step is disabled'
    case 'incomplete':
      return 'This step has unconnected inputs or outputs'
    default:
      return 'Cannot run at this time'
  }
}

/**
 * Compute eligibility for running multiple steps in parallel.
 */
export function getParallelRunEligibility(
  stepIds: string[],
  nodes: Node[],
  edges: Edge[],
  stepStatuses: Map<string, StepExecutionState>
): RunEligibility {
  if (stepIds.length === 0) {
    return { canRun: false, reason: 'running' }
  }

  const graph = buildDependencyGraph(nodes, edges)

  // Check each step individually first
  const runningSteps = new Set<string>()
  for (const [stepId, status] of stepStatuses) {
    if (status === 'running') {
      runningSteps.add(stepId)
    }
  }

  // Any selected step already running?
  for (const stepId of stepIds) {
    if (runningSteps.has(stepId)) {
      const node = nodes.find((n) => n.id === stepId)
      const stepName = node?.type === 'step' ? (node.data as StepData).name : stepId
      return {
        canRun: false,
        reason: 'running',
        blockedBy: [stepName],
      }
    }
  }

  // Check for conflicts within selected steps
  for (let i = 0; i < stepIds.length; i++) {
    for (let j = i + 1; j < stepIds.length; j++) {
      // Check if one depends on the other
      const upstream = graph.getUpstream(stepIds[i])
      const downstream = graph.getDownstream(stepIds[i])

      if (upstream.has(stepIds[j]) || downstream.has(stepIds[j])) {
        const nodeJ = nodes.find((n) => n.id === stepIds[j])
        const stepNameJ = nodeJ?.type === 'step' ? (nodeJ.data as StepData).name : stepIds[j]
        return {
          canRun: false,
          reason: 'upstream_running',
          blockedBy: [stepNameJ],
        }
      }

      // Check for output conflicts
      if (graph.hasOutputConflict(stepIds[i], stepIds[j])) {
        const nodeJ = nodes.find((n) => n.id === stepIds[j])
        const stepNameJ = nodeJ?.type === 'step' ? (nodeJ.data as StepData).name : stepIds[j]
        return {
          canRun: false,
          reason: 'output_conflict',
          blockedBy: [stepNameJ],
        }
      }
    }
  }

  // Check against currently running steps
  for (const stepId of stepIds) {
    const upstream = graph.getUpstream(stepId)
    const downstream = graph.getDownstream(stepId)

    for (const runningId of runningSteps) {
      if (upstream.has(runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'upstream_running',
          blockedBy: [stepName],
        }
      }
      if (downstream.has(runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'downstream_running',
          blockedBy: [stepName],
        }
      }
      if (graph.hasOutputConflict(stepId, runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'output_conflict',
          blockedBy: [stepName],
        }
      }
    }
  }

  return { canRun: true }
}

/**
 * Compute eligibility for running a group of steps.
 *
 * Unlike parallel eligibility, this does NOT block when group members
 * depend on each other — the backend orchestrator handles dependency
 * ordering within the group.
 */
export function getGroupRunEligibility(
  stepIds: string[],
  nodes: Node[],
  edges: Edge[],
  stepStatuses: Map<string, StepExecutionState>
): RunEligibility {
  if (stepIds.length === 0) {
    return { canRun: false, reason: 'running' }
  }

  const graph = buildDependencyGraph(nodes, edges)
  const stepIdSet = new Set(stepIds)

  const runningSteps = new Set<string>()
  for (const [stepId, status] of stepStatuses) {
    if (status === 'running') {
      runningSteps.add(stepId)
    }
  }

  // Any group step already running?
  for (const stepId of stepIds) {
    if (runningSteps.has(stepId)) {
      const node = nodes.find((n) => n.id === stepId)
      const stepName = node?.type === 'step' ? (node.data as StepData).name : stepId
      return {
        canRun: false,
        reason: 'running',
        blockedBy: [stepName],
      }
    }
  }

  // Check against currently running steps (external only)
  for (const stepId of stepIds) {
    const upstream = graph.getUpstream(stepId)
    const downstream = graph.getDownstream(stepId)

    for (const runningId of runningSteps) {
      // Skip group members — the orchestrator handles in-group ordering
      if (stepIdSet.has(runningId)) continue

      if (upstream.has(runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'upstream_running',
          blockedBy: [stepName],
        }
      }
      if (downstream.has(runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'downstream_running',
          blockedBy: [stepName],
        }
      }
      if (graph.hasOutputConflict(stepId, runningId)) {
        const node = nodes.find((n) => n.id === runningId)
        const stepName = node?.type === 'step' ? (node.data as StepData).name : runningId
        return {
          canRun: false,
          reason: 'output_conflict',
          blockedBy: [stepName],
        }
      }
    }
  }

  return { canRun: true }
}
