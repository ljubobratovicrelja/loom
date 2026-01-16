import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useRunEligibility,
  getBlockReasonMessage,
  getParallelRunEligibility,
  type RunEligibility,
} from './useRunEligibility'
import type { Node, Edge } from '@xyflow/react'
import type { StepExecutionState } from '../types/pipeline'

// =============================================================================
// Test Utilities
// =============================================================================

const createStepNode = (id: string, name: string): Node => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: { name, task: 'tasks/test.py', inputs: {}, outputs: {}, args: {}, optional: false },
})

const createVariableNode = (id: string, name: string): Node => ({
  id,
  type: 'variable',
  position: { x: 0, y: 0 },
  data: { name, value: 'data/test.csv' },
})

const createEdge = (source: string, target: string): Edge => ({
  id: `e_${source}_${target}`,
  source,
  target,
})

// =============================================================================
// useRunEligibility Hook Tests
// =============================================================================

describe('useRunEligibility', () => {
  describe('basic eligibility', () => {
    it('should return canRun=true for step with no running dependencies', () => {
      const nodes = [createStepNode('step1', 'extract')]
      const edges: Edge[] = []
      const stepStatuses = new Map<string, StepExecutionState>()

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      const eligibility = result.current.get('step1')
      expect(eligibility?.canRun).toBe(true)
    })

    it('should return canRun=false when step is running', () => {
      const nodes = [createStepNode('step1', 'extract')]
      const edges: Edge[] = []
      const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      const eligibility = result.current.get('step1')
      expect(eligibility?.canRun).toBe(false)
      expect(eligibility?.reason).toBe('running')
    })

    it('should return empty map for no step nodes', () => {
      const nodes = [createVariableNode('var1', 'data')]
      const edges: Edge[] = []
      const stepStatuses = new Map<string, StepExecutionState>()

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      expect(result.current.size).toBe(0)
    })
  })

  describe('upstream blocking', () => {
    it('should block step when upstream step is running', () => {
      // step1 -> var1 -> step2 (step2 depends on step1)
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createVariableNode('var1', 'data'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]
      const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      const eligibility = result.current.get('step2')
      expect(eligibility?.canRun).toBe(false)
      expect(eligibility?.reason).toBe('upstream_running')
      expect(eligibility?.blockedBy).toContain('extract')
    })

    it('should block step when transitive upstream is running', () => {
      // step1 -> var1 -> step2 -> var2 -> step3
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createStepNode('step3', 'classify'),
        createVariableNode('var1', 'data1'),
        createVariableNode('var2', 'data2'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step3'),
      ]
      const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      // step3's transitive upstream includes step1
      const eligibility = result.current.get('step3')
      expect(eligibility?.canRun).toBe(false)
      expect(eligibility?.reason).toBe('upstream_running')
    })
  })

  describe('downstream blocking', () => {
    it('should block step when downstream step is running', () => {
      // step1 -> var1 -> step2 (step1 should be blocked if step2 is running)
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createVariableNode('var1', 'data'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]
      const stepStatuses = new Map<string, StepExecutionState>([['step2', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      const eligibility = result.current.get('step1')
      expect(eligibility?.canRun).toBe(false)
      expect(eligibility?.reason).toBe('downstream_running')
      expect(eligibility?.blockedBy).toContain('process')
    })
  })

  describe('output conflict blocking', () => {
    it('should block step when running step produces same output', () => {
      // Both step1 and step2 produce var1
      const nodes = [
        createStepNode('step1', 'extract_v1'),
        createStepNode('step2', 'extract_v2'),
        createVariableNode('var1', 'output'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step2', 'var1'),
      ]
      const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      const eligibility = result.current.get('step2')
      expect(eligibility?.canRun).toBe(false)
      expect(eligibility?.reason).toBe('output_conflict')
      expect(eligibility?.blockedBy).toContain('extract_v1')
    })
  })

  describe('independent steps', () => {
    it('should allow independent step to run when other branch is running', () => {
      // Two independent pipelines: step1 -> var1 and step2 -> var2
      const nodes = [
        createStepNode('step1', 'extract_a'),
        createStepNode('step2', 'extract_b'),
        createVariableNode('var1', 'data_a'),
        createVariableNode('var2', 'data_b'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step2', 'var2'),
      ]
      const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

      const { result } = renderHook(() => useRunEligibility(nodes, edges, stepStatuses))

      // step2 should be runnable since it's independent of step1
      const eligibility = result.current.get('step2')
      expect(eligibility?.canRun).toBe(true)
    })
  })
})

// =============================================================================
// getBlockReasonMessage Tests
// =============================================================================

describe('getBlockReasonMessage', () => {
  it('should return null for runnable step', () => {
    const eligibility: RunEligibility = { canRun: true }
    expect(getBlockReasonMessage(eligibility)).toBeNull()
  })

  it('should return message for running step', () => {
    const eligibility: RunEligibility = { canRun: false, reason: 'running' }
    expect(getBlockReasonMessage(eligibility)).toBe('This step is already running')
  })

  it('should return message with blocked-by names for upstream_running', () => {
    const eligibility: RunEligibility = {
      canRun: false,
      reason: 'upstream_running',
      blockedBy: ['extract', 'process'],
    }
    const message = getBlockReasonMessage(eligibility)
    expect(message).toBe('Waiting for: extract, process')
  })

  it('should return message with blocked-by names for downstream_running', () => {
    const eligibility: RunEligibility = {
      canRun: false,
      reason: 'downstream_running',
      blockedBy: ['classify'],
    }
    const message = getBlockReasonMessage(eligibility)
    expect(message).toBe('Downstream step running: classify')
  })

  it('should return message with blocked-by names for output_conflict', () => {
    const eligibility: RunEligibility = {
      canRun: false,
      reason: 'output_conflict',
      blockedBy: ['alternative_extract'],
    }
    const message = getBlockReasonMessage(eligibility)
    expect(message).toBe('Output conflict with: alternative_extract')
  })

  it('should return default message for unknown reason', () => {
    const eligibility: RunEligibility = { canRun: false }
    expect(getBlockReasonMessage(eligibility)).toBe('Cannot run at this time')
  })
})

// =============================================================================
// getParallelRunEligibility Tests
// =============================================================================

describe('getParallelRunEligibility', () => {
  it('should return canRun=false for empty step list', () => {
    const result = getParallelRunEligibility([], [], [], new Map())
    expect(result.canRun).toBe(false)
  })

  it('should allow running independent steps in parallel', () => {
    const nodes = [
      createStepNode('step1', 'extract_a'),
      createStepNode('step2', 'extract_b'),
      createVariableNode('var1', 'data_a'),
      createVariableNode('var2', 'data_b'),
    ]
    const edges = [
      createEdge('step1', 'var1'),
      createEdge('step2', 'var2'),
    ]

    const result = getParallelRunEligibility(['step1', 'step2'], nodes, edges, new Map())
    expect(result.canRun).toBe(true)
  })

  it('should block parallel run if one step depends on another', () => {
    // step1 -> var1 -> step2
    const nodes = [
      createStepNode('step1', 'extract'),
      createStepNode('step2', 'process'),
      createVariableNode('var1', 'data'),
    ]
    const edges = [
      createEdge('step1', 'var1'),
      createEdge('var1', 'step2'),
    ]

    const result = getParallelRunEligibility(['step1', 'step2'], nodes, edges, new Map())
    expect(result.canRun).toBe(false)
    expect(result.reason).toBe('upstream_running')
  })

  it('should block parallel run if steps have output conflict', () => {
    // Both step1 and step2 produce var1
    const nodes = [
      createStepNode('step1', 'extract_v1'),
      createStepNode('step2', 'extract_v2'),
      createVariableNode('var1', 'output'),
    ]
    const edges = [
      createEdge('step1', 'var1'),
      createEdge('step2', 'var1'),
    ]

    const result = getParallelRunEligibility(['step1', 'step2'], nodes, edges, new Map())
    expect(result.canRun).toBe(false)
    expect(result.reason).toBe('output_conflict')
  })

  it('should block if selected step is already running', () => {
    const nodes = [createStepNode('step1', 'extract')]
    const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

    const result = getParallelRunEligibility(['step1'], nodes, [], stepStatuses)
    expect(result.canRun).toBe(false)
    expect(result.reason).toBe('running')
  })

  it('should block if upstream of selected step is running', () => {
    // step1 -> var1 -> step2
    const nodes = [
      createStepNode('step1', 'extract'),
      createStepNode('step2', 'process'),
      createVariableNode('var1', 'data'),
    ]
    const edges = [
      createEdge('step1', 'var1'),
      createEdge('var1', 'step2'),
    ]
    const stepStatuses = new Map<string, StepExecutionState>([['step1', 'running']])

    // Trying to run step2 while step1 (upstream) is running
    const result = getParallelRunEligibility(['step2'], nodes, edges, stepStatuses)
    expect(result.canRun).toBe(false)
    expect(result.reason).toBe('upstream_running')
  })

  it('should block if downstream of selected step is running', () => {
    // step1 -> var1 -> step2
    const nodes = [
      createStepNode('step1', 'extract'),
      createStepNode('step2', 'process'),
      createVariableNode('var1', 'data'),
    ]
    const edges = [
      createEdge('step1', 'var1'),
      createEdge('var1', 'step2'),
    ]
    const stepStatuses = new Map<string, StepExecutionState>([['step2', 'running']])

    // Trying to run step1 while step2 (downstream) is running
    const result = getParallelRunEligibility(['step1'], nodes, edges, stepStatuses)
    expect(result.canRun).toBe(false)
    expect(result.reason).toBe('downstream_running')
  })
})
