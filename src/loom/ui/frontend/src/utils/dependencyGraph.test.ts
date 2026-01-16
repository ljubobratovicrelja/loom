import { describe, it, expect } from 'vitest'
import { buildDependencyGraph, getStepName } from './dependencyGraph'
import type { Node, Edge } from '@xyflow/react'

// Helper to create step nodes
const createStepNode = (id: string, name: string): Node => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: { name, task: 'tasks/test.py', inputs: {}, outputs: {}, args: {}, optional: false },
})

// Helper to create data nodes
const createDataNode = (id: string, name: string): Node => ({
  id,
  type: 'data',
  position: { x: 0, y: 0 },
  data: { key: name, name, type: 'csv', path: 'data/test.csv' },
})

// Helper to create edges
const createEdge = (source: string, target: string, sourceHandle?: string, targetHandle?: string): Edge => ({
  id: `e_${source}_${target}`,
  source,
  target,
  sourceHandle,
  targetHandle,
})

describe('buildDependencyGraph', () => {
  describe('basic functionality', () => {
    it('should return empty sets for empty graph', () => {
      const graph = buildDependencyGraph([], [])
      expect(graph.getUpstream('any')).toEqual(new Set())
      expect(graph.getDownstream('any')).toEqual(new Set())
      expect(graph.getAllStepIds().size).toBe(0)
    })

    it('should track step IDs', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'input'),
      ]

      const graph = buildDependencyGraph(nodes, [])
      expect(graph.getAllStepIds()).toEqual(new Set(['step1', 'step2']))
    })
  })

  describe('dependency tracking', () => {
    it('should track direct upstream dependencies', () => {
      // step1 produces var1, step2 consumes var1
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1', 'output', 'input'), // step1 -> var1
        createEdge('var1', 'step2', 'value', 'data'),  // var1 -> step2
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.getDirectUpstream('step2')).toEqual(new Set(['step1']))
      expect(graph.getDirectUpstream('step1')).toEqual(new Set())
    })

    it('should track direct downstream dependencies', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.getDirectDownstream('step1')).toEqual(new Set(['step2']))
      expect(graph.getDirectDownstream('step2')).toEqual(new Set())
    })

    it('should track transitive upstream dependencies', () => {
      // step1 -> var1 -> step2 -> var2 -> step3
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createStepNode('step3', 'classify'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.getUpstream('step3')).toEqual(new Set(['step1', 'step2']))
      expect(graph.getUpstream('step2')).toEqual(new Set(['step1']))
      expect(graph.getUpstream('step1')).toEqual(new Set())
    })

    it('should track transitive downstream dependencies', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createStepNode('step3', 'classify'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.getDownstream('step1')).toEqual(new Set(['step2', 'step3']))
      expect(graph.getDownstream('step2')).toEqual(new Set(['step3']))
      expect(graph.getDownstream('step3')).toEqual(new Set())
    })
  })

  describe('output conflict detection', () => {
    it('should detect steps producing the same variable', () => {
      // Both step1 and step2 produce var1 (conflict)
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'alt_extract'),
        createDataNode('var1', 'output'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step2', 'var1'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasOutputConflict('step1', 'step2')).toBe(true)
      expect(graph.hasOutputConflict('step2', 'step1')).toBe(true)
    })

    it('should not report conflict for independent outputs', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'output1'),
        createDataNode('var2', 'output2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step2', 'var2'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasOutputConflict('step1', 'step2')).toBe(false)
    })
  })

  describe('blocked steps calculation', () => {
    it('should block running step itself', () => {
      const nodes = [createStepNode('step1', 'extract')]
      const graph = buildDependencyGraph(nodes, [])

      const blocked = graph.getBlockedSteps(new Set(['step1']))
      expect(blocked.has('step1')).toBe(true)
    })

    it('should block upstream of running step', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // When step2 is running, step1 (upstream) should be blocked
      const blocked = graph.getBlockedSteps(new Set(['step2']))
      expect(blocked.has('step1')).toBe(true)
      expect(blocked.has('step2')).toBe(true)
    })

    it('should block downstream of running step', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // When step1 is running, step2 (downstream) should be blocked
      const blocked = graph.getBlockedSteps(new Set(['step1']))
      expect(blocked.has('step1')).toBe(true)
      expect(blocked.has('step2')).toBe(true)
    })

    it('should not block independent steps', () => {
      // step1 -> var1 -> step2 (one branch)
      // step3 -> var2 -> step4 (independent branch)
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createStepNode('step3', 'alt_extract'),
        createStepNode('step4', 'alt_process'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step3', 'var2'),
        createEdge('var2', 'step4'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // Running step1 should not block step3 or step4
      const blocked = graph.getBlockedSteps(new Set(['step1']))
      expect(blocked.has('step1')).toBe(true)
      expect(blocked.has('step2')).toBe(true)
      expect(blocked.has('step3')).toBe(false)
      expect(blocked.has('step4')).toBe(false)
    })
  })

  describe('diamond dependency', () => {
    it('should handle diamond pattern correctly', () => {
      // step1 -> var1 -> step2 -> var3 -> step4
      //       \-> var2 -> step3 -> var4 ->/
      // step4 consumes both var3 and var4
      const nodes = [
        createStepNode('step1', 'split'),
        createStepNode('step2', 'branch_a'),
        createStepNode('step3', 'branch_b'),
        createStepNode('step4', 'merge'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
        createDataNode('var3', 'result_a'),
        createDataNode('var4', 'result_b'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step1', 'var2'),
        createEdge('var1', 'step2'),
        createEdge('var2', 'step3'),
        createEdge('step2', 'var3'),
        createEdge('step3', 'var4'),
        createEdge('var3', 'step4'),
        createEdge('var4', 'step4'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // step4 depends on both step2 and step3
      const upstream4 = graph.getUpstream('step4')
      expect(upstream4.has('step1')).toBe(true)
      expect(upstream4.has('step2')).toBe(true)
      expect(upstream4.has('step3')).toBe(true)

      // step1's downstream includes all other steps
      const downstream1 = graph.getDownstream('step1')
      expect(downstream1.has('step2')).toBe(true)
      expect(downstream1.has('step3')).toBe(true)
      expect(downstream1.has('step4')).toBe(true)
    })
  })

  describe('caching', () => {
    it('should return consistent results on multiple calls', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // Call multiple times
      const upstream1 = graph.getUpstream('step2')
      const upstream2 = graph.getUpstream('step2')
      const upstream3 = graph.getUpstream('step2')

      expect(upstream1).toEqual(upstream2)
      expect(upstream2).toEqual(upstream3)
    })
  })

  describe('edge cases', () => {
    it('should handle step with no inputs or outputs', () => {
      const nodes = [createStepNode('step1', 'standalone')]
      const graph = buildDependencyGraph(nodes, [])

      expect(graph.getUpstream('step1')).toEqual(new Set())
      expect(graph.getDownstream('step1')).toEqual(new Set())
      expect(graph.getBlockedSteps(new Set(['step1']))).toEqual(new Set(['step1']))
    })

    it('should handle non-existent step ID gracefully', () => {
      const nodes = [createStepNode('step1', 'extract')]
      const graph = buildDependencyGraph(nodes, [])

      expect(graph.getUpstream('nonexistent')).toEqual(new Set())
      expect(graph.getDownstream('nonexistent')).toEqual(new Set())
      expect(graph.hasOutputConflict('nonexistent', 'step1')).toBe(false)
    })

    it('should handle variable nodes without connections', () => {
      const nodes = [
        createStepNode('step1', 'extract'),
        createDataNode('var1', 'orphan'),
      ]

      const graph = buildDependencyGraph(nodes, [])

      expect(graph.getAllStepIds()).toEqual(new Set(['step1']))
    })
  })

  describe('circular dependency detection', () => {
    it('should detect no cycles in linear pipeline', () => {
      // step1 -> var1 -> step2 -> var2 -> step3
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createStepNode('step3', 'classify'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(false)
      expect(graph.detectCycles()).toEqual(new Set())
    })

    it('should detect simple two-node cycle', () => {
      // step1 -> var1 -> step2 -> var2 -> step1 (cycle!)
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data1'),
        createDataNode('var2', 'data2'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step1'), // Creates cycle
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(true)
      const cycleNodes = graph.detectCycles()
      expect(cycleNodes.has('step1')).toBe(true)
      expect(cycleNodes.has('step2')).toBe(true)
    })

    it('should detect self-loop cycle', () => {
      // step1 -> var1 -> step1 (self-loop)
      const nodes = [
        createStepNode('step1', 'recursive'),
        createDataNode('var1', 'data'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step1'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(true)
      expect(graph.detectCycles().has('step1')).toBe(true)
    })

    it('should detect cycle in larger graph', () => {
      // step1 -> var1 -> step2 -> var2 -> step3 -> var3 -> step1 (3-node cycle)
      const nodes = [
        createStepNode('step1', 'a'),
        createStepNode('step2', 'b'),
        createStepNode('step3', 'c'),
        createDataNode('var1', 'v1'),
        createDataNode('var2', 'v2'),
        createDataNode('var3', 'v3'),
      ]

      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step3'),
        createEdge('step3', 'var3'),
        createEdge('var3', 'step1'), // Closes the cycle
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(true)
      const cycleNodes = graph.detectCycles()
      expect(cycleNodes.size).toBe(3)
      expect(cycleNodes.has('step1')).toBe(true)
      expect(cycleNodes.has('step2')).toBe(true)
      expect(cycleNodes.has('step3')).toBe(true)
    })

    it('should not report non-cycle nodes when cycle exists elsewhere', () => {
      // Linear chain: step0 -> var0 -> step1
      // Cycle: step1 -> var1 -> step2 -> var2 -> step1
      // step0 should NOT be in cycle
      const nodes = [
        createStepNode('step0', 'source'),
        createStepNode('step1', 'a'),
        createStepNode('step2', 'b'),
        createDataNode('var0', 'input'),
        createDataNode('var1', 'v1'),
        createDataNode('var2', 'v2'),
      ]

      const edges = [
        createEdge('step0', 'var0'),
        createEdge('var0', 'step1'),
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('step2', 'var2'),
        createEdge('var2', 'step1'), // Cycle between step1 and step2
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(true)
      const cycleNodes = graph.detectCycles()
      expect(cycleNodes.has('step0')).toBe(false)
      expect(cycleNodes.has('step1')).toBe(true)
      expect(cycleNodes.has('step2')).toBe(true)
    })

    it('should handle empty graph', () => {
      const graph = buildDependencyGraph([], [])

      expect(graph.hasCycles()).toBe(false)
      expect(graph.detectCycles()).toEqual(new Set())
    })

    it('should handle disconnected components with one having a cycle', () => {
      // Component 1: step1 -> var1 -> step2 (no cycle)
      // Component 2: step3 -> var2 -> step4 -> var3 -> step3 (cycle)
      const nodes = [
        createStepNode('step1', 'a'),
        createStepNode('step2', 'b'),
        createStepNode('step3', 'c'),
        createStepNode('step4', 'd'),
        createDataNode('var1', 'v1'),
        createDataNode('var2', 'v2'),
        createDataNode('var3', 'v3'),
      ]

      const edges = [
        // Component 1 - linear
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        // Component 2 - cycle
        createEdge('step3', 'var2'),
        createEdge('var2', 'step4'),
        createEdge('step4', 'var3'),
        createEdge('var3', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      expect(graph.hasCycles()).toBe(true)
      const cycleNodes = graph.detectCycles()
      expect(cycleNodes.has('step1')).toBe(false)
      expect(cycleNodes.has('step2')).toBe(false)
      expect(cycleNodes.has('step3')).toBe(true)
      expect(cycleNodes.has('step4')).toBe(true)
    })
  })

  describe('parameter nodes handling', () => {
    it('should ignore parameter nodes in dependency calculations', () => {
      // Parameter nodes should not affect step dependencies
      const paramNode: Node = {
        id: 'param_threshold',
        type: 'parameter',
        position: { x: 0, y: 0 },
        data: { name: 'threshold', value: 0.5 },
      }
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process'),
        createDataNode('var1', 'data'),
        paramNode,
      ]
      // param -> step edge should not create dependency
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('param_threshold', 'step1'), // Parameter connection
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // step1 should have no upstream (parameter is not a dependency)
      expect(graph.getUpstream('step1')).toEqual(new Set())
      // Parameter should not be in step IDs
      expect(graph.getAllStepIds().has('param_threshold')).toBe(false)
    })
  })

  describe('multiple consumers of same variable', () => {
    it('should track multiple steps consuming same variable', () => {
      // step1 produces var1, both step2 and step3 consume it
      const nodes = [
        createStepNode('step1', 'extract'),
        createStepNode('step2', 'process_a'),
        createStepNode('step3', 'process_b'),
        createDataNode('var1', 'data'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
        createEdge('var1', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // step1's downstream should include both step2 and step3
      expect(graph.getDownstream('step1')).toEqual(new Set(['step2', 'step3']))
      // Both step2 and step3 should have step1 as upstream
      expect(graph.getUpstream('step2')).toEqual(new Set(['step1']))
      expect(graph.getUpstream('step3')).toEqual(new Set(['step1']))
    })
  })

  describe('step producing multiple variables', () => {
    it('should track step with multiple outputs', () => {
      // step1 produces both var1 and var2
      const nodes = [
        createStepNode('step1', 'split'),
        createStepNode('step2', 'process_a'),
        createStepNode('step3', 'process_b'),
        createDataNode('var1', 'output_a'),
        createDataNode('var2', 'output_b'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step1', 'var2'),
        createEdge('var1', 'step2'),
        createEdge('var2', 'step3'),
      ]

      const graph = buildDependencyGraph(nodes, edges)

      // step1's downstream should include both consumers
      expect(graph.getDownstream('step1')).toEqual(new Set(['step2', 'step3']))
    })
  })
})

// =============================================================================
// getStepName Tests
// =============================================================================

describe('getStepName', () => {
  it('should return name for step node', () => {
    const node = createStepNode('step1', 'extract_data')
    expect(getStepName(node)).toBe('extract_data')
  })

  it('should return name for data node', () => {
    const node = createDataNode('data1', 'input_data')
    expect(getStepName(node)).toBe('input_data')
  })

  it('should return id for unknown node type', () => {
    const node: Node = {
      id: 'unknown_123',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {},
    }
    expect(getStepName(node)).toBe('unknown_123')
  })

  it('should return id for parameter node', () => {
    const node: Node = {
      id: 'param_threshold',
      type: 'parameter',
      position: { x: 0, y: 0 },
      data: { name: 'threshold', value: 0.5 },
    }
    // Parameter nodes fall through to return id
    expect(getStepName(node)).toBe('param_threshold')
  })
})
