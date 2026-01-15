/**
 * Tests for atomic state operations.
 * These tests verify that state updates happen atomically to prevent race conditions.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { StepData, ParameterData } from '../types/pipeline'
import {
  handleConnect,
  handleReconnect,
  handleEdgeDrop,
  handleDeleteNode,
  type ConnectionResult,
} from './connectionOperations'
import {
  resetNodeIdCounter,
  createStepNode,
  createParameterNode,
  createParameterToStepEdge,
} from './graphTestUtils'

// ============================================================================
// CRITICAL ISSUE #2: Atomic State Updates
// ============================================================================

describe('Critical Issue #2: Atomic State Updates', () => {
  beforeEach(() => {
    resetNodeIdCounter()
  })

  /**
   * Verifies that a connection operation returns both nodes and edges in a single result,
   * allowing for atomic state updates.
   */
  function verifyAtomicResult(result: ConnectionResult): void {
    // Both nodes and edges should be present in the result
    expect(result).toHaveProperty('nodes')
    expect(result).toHaveProperty('edges')
    expect(Array.isArray(result.nodes)).toBe(true)
    expect(Array.isArray(result.edges)).toBe(true)
  }

  describe('handleConnect atomic behavior', () => {
    it('should return both nodes and edges in single result', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      const nodes: Node[] = [step, param]
      const edges: Edge[] = []

      const result = handleConnect(nodes, edges, {
        source: 'param_threshold',
        target: 'step1',
        sourceHandle: null,
        targetHandle: 'threshold',
      })

      verifyAtomicResult(result)

      // Verify the edge was added
      expect(result.edges.length).toBe(1)
      expect(result.edges[0].source).toBe('param_threshold')

      // Verify the arg was updated
      const updatedStep = result.nodes.find((n) => n.id === 'step1')
      expect((updatedStep?.data as StepData).args.threshold).toBe('$threshold')
    })

    it('should handle replacement of existing connection atomically', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '$old_param' } })
      const oldParam = createParameterNode('old_param', 0.3, { id: 'param_old_param' })
      const newParam = createParameterNode('new_param', 0.7, { id: 'param_new_param' })
      const existingEdge = createParameterToStepEdge('param_old_param', 'step1', 'threshold')

      const nodes: Node[] = [step, oldParam, newParam]
      const edges: Edge[] = [existingEdge]

      const result = handleConnect(nodes, edges, {
        source: 'param_new_param',
        target: 'step1',
        sourceHandle: null,
        targetHandle: 'threshold',
      })

      verifyAtomicResult(result)

      // Old edge should be removed, new edge added
      expect(result.edges.length).toBe(1)
      expect(result.edges[0].source).toBe('param_new_param')

      // Arg should be updated to new parameter
      const updatedStep = result.nodes.find((n) => n.id === 'step1')
      expect((updatedStep?.data as StepData).args.threshold).toBe('$new_param')
    })
  })

  describe('handleReconnect atomic behavior', () => {
    it('should clear old target and set new target atomically', () => {
      const step1 = createStepNode('process1', { id: 'step1', args: { value: '$param' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')

      const nodes: Node[] = [step1, step2, param]
      const edges: Edge[] = [edge]

      const result = handleReconnect(nodes, edges, edge, {
        source: 'param_param',
        target: 'step2',
        sourceHandle: null,
        targetHandle: 'value',
      })

      verifyAtomicResult(result)

      // Both targets should be updated in the same result
      const updatedStep1 = result.nodes.find((n) => n.id === 'step1')
      const updatedStep2 = result.nodes.find((n) => n.id === 'step2')

      // Old target cleared
      expect((updatedStep1?.data as StepData).args.value).toBe('')
      // New target set
      expect((updatedStep2?.data as StepData).args.value).toBe('$param')

      // Edge should point to new target
      const reconnectedEdge = result.edges.find((e) => e.source === 'param_param')
      expect(reconnectedEdge?.target).toBe('step2')
    })
  })

  describe('handleEdgeDrop atomic behavior', () => {
    it('should remove edge and clear arg atomically', () => {
      const step = createStepNode('process', { id: 'step1', args: { value: '$param' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')

      const nodes: Node[] = [step, param]
      const edges: Edge[] = [edge]

      const result = handleEdgeDrop(nodes, edges, edge)

      verifyAtomicResult(result)

      // Edge should be removed
      expect(result.edges.length).toBe(0)

      // Arg should be cleared
      const updatedStep = result.nodes.find((n) => n.id === 'step1')
      expect((updatedStep?.data as StepData).args.value).toBe('')
    })
  })

  describe('handleDeleteNode atomic behavior', () => {
    it('should delete node, edges, and clear args atomically', () => {
      const step = createStepNode('process', { id: 'step1', args: { value: '$param' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')

      const nodes: Node[] = [step, param]
      const edges: Edge[] = [edge]

      const result = handleDeleteNode(nodes, edges, 'param_param')

      verifyAtomicResult(result)

      // Parameter node should be deleted
      expect(result.nodes.find((n) => n.id === 'param_param')).toBeUndefined()

      // Edge should be removed
      expect(result.edges.length).toBe(0)

      // Arg should be cleared
      const updatedStep = result.nodes.find((n) => n.id === 'step1')
      expect((updatedStep?.data as StepData).args.value).toBe('')
    })
  })

  /**
   * This test demonstrates the problem with non-atomic updates.
   * When setNodes and setEdges are called separately, intermediate states can occur.
   */
  describe('Non-atomic update problems', () => {
    it('demonstrates intermediate state with separate updates', () => {
      // Simulate what happens with separate setEdges/setNodes calls
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      let nodes: Node[] = [step, param]
      let edges: Edge[] = []

      // In the current Canvas.tsx onConnect, this happens:
      // 1. setEdges is called first - adds the edge
      const newEdge: Edge = {
        id: 'e_param_threshold_step1_threshold',
        source: 'param_threshold',
        target: 'step1',
        targetHandle: 'threshold',
      }
      edges = [...edges, newEdge]

      // INTERMEDIATE STATE: Edge exists but arg is not yet updated
      // If a render happens here, the UI shows connection but arg is empty
      const intermediateStep = nodes.find((n) => n.id === 'step1')
      expect((intermediateStep?.data as StepData).args.threshold).toBe('')
      expect(edges.some((e) => e.source === 'param_threshold')).toBe(true)

      // 2. setNodes is called second - updates the arg
      nodes = nodes.map((node) => {
        if (node.id === 'step1') {
          return {
            ...node,
            data: { ...node.data, args: { threshold: '$threshold' } },
          }
        }
        return node
      })

      // Now state is consistent
      const finalStep = nodes.find((n) => n.id === 'step1')
      expect((finalStep?.data as StepData).args.threshold).toBe('$threshold')
    })

    it('atomic update prevents intermediate state', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })

      // Using handleConnect, both are updated together
      const result = handleConnect([step, param], [], {
        source: 'param_threshold',
        target: 'step1',
        sourceHandle: null,
        targetHandle: 'threshold',
      })

      // State is immediately consistent - no intermediate state possible
      const updatedStep = result.nodes.find((n) => n.id === 'step1')
      expect((updatedStep?.data as StepData).args.threshold).toBe('$threshold')
      expect(result.edges.some((e) => e.source === 'param_threshold')).toBe(true)
    })
  })
})
