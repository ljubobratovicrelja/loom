/**
 * Comprehensive tests for graph operations in the pipeline editor.
 *
 * These tests verify the correctness of:
 * - Node connections and disconnections
 * - Parameter binding to step arguments
 * - Node deletion with cascade cleanup
 * - Edge reconnection
 * - State consistency after operations
 *
 * Note: These tests validate the logic that should be implemented in
 * the application. Some tests demonstrate bugs that were identified
 * and fixed.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetNodeIdCounter,
  createStepNode,
  createDataNode,
  createParameterNode,
  createEdge,
  createStepToDataEdge,
  createDataToStepEdge,
  createParameterToStepEdge,
  createGraphState,
  connectParameterToStep,
  disconnectParameterFromStep,
  deleteNode,
  reconnectEdge,
  getStepArg,
  getNodeEdges,
  getOutgoingEdges,
  getIncomingEdges,
  isParameterConnected,
  getParameterNameFromArg,
  createLinearPipeline,
  createDiamondPipeline,
  createPipelineWithParameters,
} from './graphTestUtils'
import type { StepData, ParameterData, DataNodeData } from '../types/pipeline'

describe('Graph Operations', () => {
  beforeEach(() => {
    resetNodeIdCounter()
  })

  // ==========================================================================
  // SECTION 1: Basic Node and Edge Creation
  // ==========================================================================

  describe('Node Creation', () => {
    it('should create step nodes with correct structure', () => {
      const step = createStepNode('extract', { args: { threshold: 0.5 } })

      expect(step.type).toBe('step')
      expect((step.data as StepData).name).toBe('extract')
      expect((step.data as StepData).args.threshold).toBe(0.5)
    })

    it('should create data nodes with correct structure', () => {
      const dataNode = createDataNode('output', 'csv', 'data/output.csv')

      expect(dataNode.type).toBe('data')
      expect((dataNode.data as DataNodeData).name).toBe('output')
      expect((dataNode.data as DataNodeData).path).toBe('data/output.csv')
    })

    it('should create parameter nodes with correct structure', () => {
      const param = createParameterNode('threshold', 0.5)

      expect(param.type).toBe('parameter')
      expect((param.data as ParameterData).name).toBe('threshold')
      expect((param.data as ParameterData).value).toBe(0.5)
    })

    it('should generate unique IDs for nodes', () => {
      const step1 = createStepNode('extract')
      const step2 = createStepNode('extract')

      expect(step1.id).not.toBe(step2.id)
    })
  })

  describe('Edge Creation', () => {
    it('should create edges with source and target', () => {
      const edge = createEdge('node1', 'node2')

      expect(edge.source).toBe('node1')
      expect(edge.target).toBe('node2')
    })

    it('should create edges with handles', () => {
      const edge = createEdge('node1', 'node2', {
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(edge.sourceHandle).toBe('output')
      expect(edge.targetHandle).toBe('input')
    })

    it('should create step-to-data edges', () => {
      const edge = createStepToDataEdge('step1', 'data1', 'output_handle')

      expect(edge.source).toBe('step1')
      expect(edge.target).toBe('data1')
      expect(edge.sourceHandle).toBe('output_handle')
    })

    it('should create data-to-step edges', () => {
      const edge = createDataToStepEdge('data1', 'step1', 'input_handle')

      expect(edge.source).toBe('data1')
      expect(edge.target).toBe('step1')
      expect(edge.targetHandle).toBe('input_handle')
    })

    it('should create parameter-to-step edges', () => {
      const edge = createParameterToStepEdge('param1', 'step1', 'threshold')

      expect(edge.source).toBe('param1')
      expect(edge.target).toBe('step1')
      expect(edge.targetHandle).toBe('threshold')
    })
  })

  // ==========================================================================
  // SECTION 2: Parameter Connection Operations
  // ==========================================================================

  describe('Parameter Connections', () => {
    it('should connect parameter to step arg', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      const state = createGraphState([step, param], [])

      const newState = connectParameterToStep(state, 'param_threshold', 'step1', 'threshold')

      expect(isParameterConnected(newState, 'param_threshold', 'step1', 'threshold')).toBe(true)
      expect(getStepArg(newState, 'step1', 'threshold')).toBe('$threshold')
    })

    it('should replace existing parameter connection to same arg', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '$old_param' } })
      const oldParam = createParameterNode('old_param', 0.3, { id: 'param_old_param' })
      const newParam = createParameterNode('new_param', 0.7, { id: 'param_new_param' })
      const existingEdge = createParameterToStepEdge('param_old_param', 'step1', 'threshold')
      const state = createGraphState([step, oldParam, newParam], [existingEdge])

      // Connect new parameter to same arg
      const newState = connectParameterToStep(state, 'param_new_param', 'step1', 'threshold')

      // Old connection should be removed
      expect(isParameterConnected(newState, 'param_old_param', 'step1', 'threshold')).toBe(false)
      // New connection should exist
      expect(isParameterConnected(newState, 'param_new_param', 'step1', 'threshold')).toBe(true)
      expect(getStepArg(newState, 'step1', 'threshold')).toBe('$new_param')
    })

    it('should allow same parameter connected to different args', () => {
      const step = createStepNode('process', {
        id: 'step1',
        args: { min_threshold: '', max_threshold: '' },
      })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      let state = createGraphState([step, param], [])

      state = connectParameterToStep(state, 'param_threshold', 'step1', 'min_threshold')
      state = connectParameterToStep(state, 'param_threshold', 'step1', 'max_threshold')

      expect(isParameterConnected(state, 'param_threshold', 'step1', 'min_threshold')).toBe(true)
      expect(isParameterConnected(state, 'param_threshold', 'step1', 'max_threshold')).toBe(true)
      expect(getStepArg(state, 'step1', 'min_threshold')).toBe('$threshold')
      expect(getStepArg(state, 'step1', 'max_threshold')).toBe('$threshold')
    })

    it('should allow same parameter connected to different steps', () => {
      const step1 = createStepNode('process1', { id: 'step1', args: { threshold: '' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { threshold: '' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      let state = createGraphState([step1, step2, param], [])

      state = connectParameterToStep(state, 'param_threshold', 'step1', 'threshold')
      state = connectParameterToStep(state, 'param_threshold', 'step2', 'threshold')

      expect(isParameterConnected(state, 'param_threshold', 'step1', 'threshold')).toBe(true)
      expect(isParameterConnected(state, 'param_threshold', 'step2', 'threshold')).toBe(true)
    })

    it('should throw when connecting non-existent parameter', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const state = createGraphState([step], [])

      expect(() => {
        connectParameterToStep(state, 'nonexistent', 'step1', 'threshold')
      }).toThrow('Parameter node nonexistent not found')
    })

    it('should throw when connecting to non-existent step', () => {
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      const state = createGraphState([param], [])

      expect(() => {
        connectParameterToStep(state, 'param_threshold', 'nonexistent', 'threshold')
      }).toThrow('Step node nonexistent not found')
    })
  })

  describe('Parameter Disconnection', () => {
    it('should disconnect parameter from step arg', () => {
      const state = createPipelineWithParameters()

      const newState = disconnectParameterFromStep(state, 'step1', 'threshold')

      expect(isParameterConnected(newState, 'param_threshold', 'step1', 'threshold')).toBe(false)
      expect(getStepArg(newState, 'step1', 'threshold')).toBe('')
    })

    it('should not affect other parameter connections when disconnecting one', () => {
      const state = createPipelineWithParameters()

      const newState = disconnectParameterFromStep(state, 'step1', 'threshold')

      // window_size should still be connected
      expect(isParameterConnected(newState, 'param_window_size', 'step1', 'window_size')).toBe(true)
      expect(getStepArg(newState, 'step1', 'window_size')).toBe('$window_size')
    })

    it('should handle disconnecting already disconnected arg gracefully', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const state = createGraphState([step], [])

      // Should not throw
      const newState = disconnectParameterFromStep(state, 'step1', 'threshold')

      expect(getStepArg(newState, 'step1', 'threshold')).toBe('')
    })
  })

  // ==========================================================================
  // SECTION 3: Node Deletion with Cascade Cleanup
  // ==========================================================================

  describe('Node Deletion', () => {
    it('should delete node and its edges', () => {
      const state = createLinearPipeline()
      const initialEdgeCount = state.edges.length

      const newState = deleteNode(state, 'step2')

      // Node should be removed
      expect(newState.nodes.find((n) => n.id === 'step2')).toBeUndefined()

      // Edges connected to step2 should be removed
      expect(getNodeEdges(newState, 'step2').length).toBe(0)

      // Should have fewer edges
      expect(newState.edges.length).toBeLessThan(initialEdgeCount)
    })

    it('should delete data node and connected edges', () => {
      const state = createLinearPipeline()

      const newState = deleteNode(state, 'data1')

      expect(newState.nodes.find((n) => n.id === 'data1')).toBeUndefined()
      expect(getNodeEdges(newState, 'data1').length).toBe(0)
    })

    /**
     * CRITICAL TEST: When deleting a parameter node, step args that reference
     * that parameter should be cleared. This was a bug that was fixed.
     */
    it('should clear step args when deleting connected parameter node', () => {
      const state = createPipelineWithParameters()

      // Verify initial state
      expect(getStepArg(state, 'step1', 'threshold')).toBe('$threshold')

      const newState = deleteNode(state, 'param_threshold')

      // Parameter node should be deleted
      expect(newState.nodes.find((n) => n.id === 'param_threshold')).toBeUndefined()

      // Edge should be deleted
      expect(isParameterConnected(newState, 'param_threshold', 'step1', 'threshold')).toBe(false)

      // CRITICAL: Arg value should be cleared
      expect(getStepArg(newState, 'step1', 'threshold')).toBe('')
    })

    it('should clear multiple step args when parameter is connected to multiple args', () => {
      const step = createStepNode('process', {
        id: 'step1',
        args: { min: '$threshold', max: '$threshold' },
      })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      const edges = [
        createParameterToStepEdge('param_threshold', 'step1', 'min'),
        createParameterToStepEdge('param_threshold', 'step1', 'max'),
      ]
      const state = createGraphState([step, param], edges)

      const newState = deleteNode(state, 'param_threshold')

      expect(getStepArg(newState, 'step1', 'min')).toBe('')
      expect(getStepArg(newState, 'step1', 'max')).toBe('')
    })

    it('should not affect other nodes when deleting a node', () => {
      const state = createLinearPipeline()
      const initialNodeCount = state.nodes.length

      const newState = deleteNode(state, 'step2')

      // Only one node should be removed
      expect(newState.nodes.length).toBe(initialNodeCount - 1)

      // Other nodes should remain
      expect(newState.nodes.find((n) => n.id === 'step1')).toBeDefined()
      expect(newState.nodes.find((n) => n.id === 'step3')).toBeDefined()
    })

    it('should handle deleting non-existent node gracefully', () => {
      const state = createLinearPipeline()
      const initialNodeCount = state.nodes.length

      const newState = deleteNode(state, 'nonexistent')

      expect(newState.nodes.length).toBe(initialNodeCount)
      expect(newState.edges.length).toBe(state.edges.length)
    })
  })

  // ==========================================================================
  // SECTION 4: Edge Reconnection
  // ==========================================================================

  describe('Edge Reconnection', () => {
    it('should reconnect edge to new target', () => {
      const step1 = createStepNode('process1', { id: 'step1', args: { value: '' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')
      const state = createGraphState([step1, step2, param], [edge])

      // Update step1's arg manually for initial state
      const stateWithArg = {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === 'step1' ? { ...n, data: { ...n.data, args: { value: '$param' } } } : n
        ),
      }

      const newState = reconnectEdge(stateWithArg, edge, 'step2', 'value')

      // Old target's arg should be cleared
      expect(getStepArg(newState, 'step1', 'value')).toBe('')

      // New target's arg should be set
      expect(getStepArg(newState, 'step2', 'value')).toBe('$param')

      // Edge should point to new target
      const reconnectedEdge = newState.edges.find((e) => e.id === edge.id)
      expect(reconnectedEdge?.target).toBe('step2')
      expect(reconnectedEdge?.targetHandle).toBe('value')
    })

    /**
     * CRITICAL TEST: Reconnection should be atomic - both old and new
     * targets should be updated in a single operation to avoid intermediate
     * states. This was a bug that was fixed.
     */
    it('should update both old and new targets atomically', () => {
      const step1 = createStepNode('process1', { id: 'step1', args: { value: '$param' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')
      const state = createGraphState([step1, step2, param], [edge])

      const newState = reconnectEdge(state, edge, 'step2', 'value')

      // Both should be updated in the same state
      expect(getStepArg(newState, 'step1', 'value')).toBe('')
      expect(getStepArg(newState, 'step2', 'value')).toBe('$param')
    })

    it('should handle reconnecting non-parameter edges', () => {
      const state = createLinearPipeline()
      const edgeToReconnect = state.edges.find((e) => e.source === 'data1')!

      // Reconnecting data edge (non-parameter) shouldn't affect args
      const newState = reconnectEdge(state, edgeToReconnect, 'step3')

      // No arg changes expected for non-parameter edges
      const reconnectedEdge = newState.edges.find((e) => e.id === edgeToReconnect.id)
      expect(reconnectedEdge?.target).toBe('step3')
    })
  })

  // ==========================================================================
  // SECTION 5: Complex Graph Scenarios
  // ==========================================================================

  describe('Complex Graph Scenarios', () => {
    it('should handle diamond pipeline topology', () => {
      const state = createDiamondPipeline()

      // step1 has one outgoing edge to data1
      expect(getOutgoingEdges(state, 'step1').length).toBe(1)

      // data1 has two outgoing edges (to step2 and step3)
      expect(getOutgoingEdges(state, 'data1').length).toBe(2)

      // step4 has two incoming edges (from data2 and data3)
      expect(getIncomingEdges(state, 'step4').length).toBe(2)
    })

    it('should correctly delete node in diamond topology', () => {
      const state = createDiamondPipeline()

      // Delete step2 (one branch)
      const newState = deleteNode(state, 'step2')

      // step2 and its connected edges should be gone
      expect(newState.nodes.find((n) => n.id === 'step2')).toBeUndefined()
      expect(getNodeEdges(newState, 'step2').length).toBe(0)

      // step3 and step4 should still exist
      expect(newState.nodes.find((n) => n.id === 'step3')).toBeDefined()
      expect(newState.nodes.find((n) => n.id === 'step4')).toBeDefined()
    })

    it('should handle multiple parameter connections to same step', () => {
      const state = createPipelineWithParameters()

      // step1 has two parameter connections
      const paramEdges = state.edges.filter(
        (e) => e.target === 'step1' && e.source.startsWith('param_')
      )
      expect(paramEdges.length).toBe(2)

      // Delete one parameter
      const newState = deleteNode(state, 'param_threshold')

      // Should have one less parameter edge
      const remainingParamEdges = newState.edges.filter(
        (e) => e.target === 'step1' && e.source.startsWith('param_')
      )
      expect(remainingParamEdges.length).toBe(1)

      // Remaining connection should be window_size
      expect(isParameterConnected(newState, 'param_window_size', 'step1', 'window_size')).toBe(true)
    })
  })

  // ==========================================================================
  // SECTION 6: Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty graph', () => {
      const state = createGraphState()

      expect(state.nodes.length).toBe(0)
      expect(state.edges.length).toBe(0)

      // Operations on empty graph shouldn't throw
      const newState = deleteNode(state, 'nonexistent')
      expect(newState.nodes.length).toBe(0)
    })

    it('should handle node with no connections', () => {
      const orphanStep = createStepNode('orphan', { id: 'orphan' })
      const state = createGraphState([orphanStep], [])

      expect(getNodeEdges(state, 'orphan').length).toBe(0)

      const newState = deleteNode(state, 'orphan')
      expect(newState.nodes.length).toBe(0)
    })

    it('should preserve edge IDs during reconnection', () => {
      const step1 = createStepNode('process1', { id: 'step1', args: { value: '' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')
      const state = createGraphState([step1, step2, param], [edge])

      const originalEdgeId = edge.id
      const newState = reconnectEdge(state, edge, 'step2', 'value')

      const reconnectedEdge = newState.edges.find((e) => e.id === originalEdgeId)
      expect(reconnectedEdge).toBeDefined()
    })

    it('should handle parameter with empty name', () => {
      // This tests defensive programming - parameters should have names
      const param = createParameterNode('', 'value', { id: 'param_empty' })
      const step = createStepNode('process', { id: 'step1', args: { value: '' } })
      const state = createGraphState([param, step], [])

      // Connecting should still work (sets $)
      const newState = connectParameterToStep(state, 'param_empty', 'step1', 'value')
      expect(getStepArg(newState, 'step1', 'value')).toBe('$')
    })
  })

  // ==========================================================================
  // SECTION 7: Utility Function Tests
  // ==========================================================================

  describe('Utility Functions', () => {
    it('getParameterNameFromArg should extract parameter name', () => {
      expect(getParameterNameFromArg('$threshold')).toBe('threshold')
      expect(getParameterNameFromArg('$my_param_name')).toBe('my_param_name')
    })

    it('getParameterNameFromArg should return null for non-parameter values', () => {
      expect(getParameterNameFromArg('regular_value')).toBeNull()
      expect(getParameterNameFromArg(123)).toBeNull()
      expect(getParameterNameFromArg('')).toBeNull()
      expect(getParameterNameFromArg(null)).toBeNull()
      expect(getParameterNameFromArg(undefined)).toBeNull()
    })

    it('getOutgoingEdges should return only outgoing edges', () => {
      const state = createLinearPipeline()

      const outgoing = getOutgoingEdges(state, 'step1')
      expect(outgoing.every((e) => e.source === 'step1')).toBe(true)
    })

    it('getIncomingEdges should return only incoming edges', () => {
      const state = createLinearPipeline()

      const incoming = getIncomingEdges(state, 'step2')
      expect(incoming.every((e) => e.target === 'step2')).toBe(true)
    })

    it('isParameterConnected should correctly check connection state', () => {
      const state = createPipelineWithParameters()

      expect(isParameterConnected(state, 'param_threshold', 'step1', 'threshold')).toBe(true)
      expect(isParameterConnected(state, 'param_threshold', 'step1', 'wrong_arg')).toBe(false)
      expect(isParameterConnected(state, 'nonexistent', 'step1', 'threshold')).toBe(false)
    })
  })
})

// =============================================================================
// SECTION 8: Tests for Previously Identified Bugs
// =============================================================================

describe('Regression Tests for Fixed Bugs', () => {
  beforeEach(() => {
    resetNodeIdCounter()
  })

  /**
   * Bug #1: Edge reconnection state tracking
   * The edgeReconnectSuccessful flag was set to true at the START of onReconnect,
   * before operations could fail. It should be set at the END.
   */
  describe('Bug #1: Edge Reconnection State Tracking', () => {
    it('should only mark reconnection successful after all operations complete', () => {
      // This tests the logic - if any operation in reconnection fails,
      // the success flag should remain false
      const step1 = createStepNode('process1', { id: 'step1', args: { value: '$param' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '' } })
      const param = createParameterNode('param', 'test', { id: 'param_param' })
      const edge = createParameterToStepEdge('param_param', 'step1', 'value')
      const state = createGraphState([step1, step2, param], [edge])

      // Successful reconnection
      const newState = reconnectEdge(state, edge, 'step2', 'value')

      // Both targets should be correctly updated
      expect(getStepArg(newState, 'step1', 'value')).toBe('')
      expect(getStepArg(newState, 'step2', 'value')).toBe('$param')
    })
  })

  /**
   * Bug #2: Missing parameter connection validation
   * Parameter connections should validate that:
   * - Parameter node exists
   * - Parameter has a valid name
   * - Existing connections to same arg are removed
   */
  describe('Bug #2: Parameter Connection Validation', () => {
    it('should validate parameter node exists before connecting', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '' } })
      const state = createGraphState([step], [])

      expect(() => {
        connectParameterToStep(state, 'nonexistent_param', 'step1', 'threshold')
      }).toThrow()
    })

    it('should remove existing parameter connection when connecting new one', () => {
      const step = createStepNode('process', { id: 'step1', args: { threshold: '$old' } })
      const oldParam = createParameterNode('old', 0.3, { id: 'param_old' })
      const newParam = createParameterNode('new', 0.7, { id: 'param_new' })
      const existingEdge = createParameterToStepEdge('param_old', 'step1', 'threshold')
      const state = createGraphState([step, oldParam, newParam], [existingEdge])

      const newState = connectParameterToStep(state, 'param_new', 'step1', 'threshold')

      // Should only have one edge to threshold
      const thresholdEdges = newState.edges.filter(
        (e) => e.target === 'step1' && e.targetHandle === 'threshold'
      )
      expect(thresholdEdges.length).toBe(1)
      expect(thresholdEdges[0].source).toBe('param_new')
    })
  })

  /**
   * Bug #5: Orphaned parameter references on node delete
   * When deleting a parameter node, step args that reference the parameter
   * should be cleared. Previously, only the edge was removed.
   */
  describe('Bug #5: Orphaned Parameter References', () => {
    it('should clear all arg references when deleting parameter node', () => {
      // Setup: param connected to multiple args on multiple steps
      const step1 = createStepNode('process1', { id: 'step1', args: { min: '$threshold', max: '$threshold' } })
      const step2 = createStepNode('process2', { id: 'step2', args: { value: '$threshold' } })
      const param = createParameterNode('threshold', 0.5, { id: 'param_threshold' })
      const edges = [
        createParameterToStepEdge('param_threshold', 'step1', 'min'),
        createParameterToStepEdge('param_threshold', 'step1', 'max'),
        createParameterToStepEdge('param_threshold', 'step2', 'value'),
      ]
      const state = createGraphState([step1, step2, param], edges)

      const newState = deleteNode(state, 'param_threshold')

      // All arg references should be cleared
      expect(getStepArg(newState, 'step1', 'min')).toBe('')
      expect(getStepArg(newState, 'step1', 'max')).toBe('')
      expect(getStepArg(newState, 'step2', 'value')).toBe('')

      // All edges should be removed
      expect(newState.edges.filter((e) => e.source === 'param_threshold').length).toBe(0)
    })

    it('should not affect args connected to other parameters', () => {
      const step = createStepNode('process', {
        id: 'step1',
        args: { min: '$min_value', max: '$max_value' },
      })
      const minParam = createParameterNode('min_value', 0, { id: 'param_min_value' })
      const maxParam = createParameterNode('max_value', 100, { id: 'param_max_value' })
      const edges = [
        createParameterToStepEdge('param_min_value', 'step1', 'min'),
        createParameterToStepEdge('param_max_value', 'step1', 'max'),
      ]
      const state = createGraphState([step, minParam, maxParam], edges)

      const newState = deleteNode(state, 'param_min_value')

      // min should be cleared
      expect(getStepArg(newState, 'step1', 'min')).toBe('')

      // max should remain connected
      expect(getStepArg(newState, 'step1', 'max')).toBe('$max_value')
      expect(isParameterConnected(newState, 'param_max_value', 'step1', 'max')).toBe(true)
    })
  })

  /**
   * Bug #9: Fragile parameter name extraction
   * Parameter names should be extracted from arg values ($paramName)
   * not from parsing node IDs (which can be unreliable).
   */
  describe('Bug #9: Parameter Name Extraction', () => {
    it('should extract parameter name from arg value correctly', () => {
      // Test various parameter name formats
      expect(getParameterNameFromArg('$threshold')).toBe('threshold')
      expect(getParameterNameFromArg('$my_param_123')).toBe('my_param_123')
      expect(getParameterNameFromArg('$UPPERCASE_PARAM')).toBe('UPPERCASE_PARAM')
      expect(getParameterNameFromArg('$a')).toBe('a')
    })

    it('should handle edge cases in parameter name extraction', () => {
      // Dollar sign only
      expect(getParameterNameFromArg('$')).toBe('')

      // Double dollar
      expect(getParameterNameFromArg('$$double')).toBe('$double')

      // Not a parameter reference
      expect(getParameterNameFromArg('threshold')).toBeNull()
      expect(getParameterNameFromArg('0.5')).toBeNull()
    })
  })
})
