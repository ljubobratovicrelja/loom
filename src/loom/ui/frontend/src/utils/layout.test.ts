import { describe, it, expect } from 'vitest'
import { applyDagreLayout } from './layout'
import type { Node, Edge } from '@xyflow/react'

// =============================================================================
// Test Utilities
// =============================================================================

const createStepNode = (id: string): Node => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: { name: id, task: 'tasks/test.py', inputs: {}, outputs: {}, args: {} },
})

const createStepNodeWithIO = (
  id: string,
  inputs: Record<string, string>,
  outputs: Record<string, string>,
  args: Record<string, unknown>,
): Node => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: { name: id, task: 'tasks/test.py', inputs, outputs, args },
})

const createDataNode = (id: string): Node => ({
  id,
  type: 'data',
  position: { x: 0, y: 0 },
  data: { key: id, name: id, type: 'csv', path: 'data/test.csv' },
})

const createParameterNode = (id: string, value: unknown = 0): Node => ({
  id,
  type: 'parameter',
  position: { x: 0, y: 0 },
  data: { name: id, value },
})

const createEdge = (source: string, target: string): Edge => ({
  id: `e_${source}_${target}`,
  source,
  target,
})

// =============================================================================
// applyDagreLayout Tests
// =============================================================================

describe('applyDagreLayout', () => {
  describe('basic layout', () => {
    it('should return empty array for empty input', () => {
      const result = applyDagreLayout([], [])
      expect(result).toEqual([])
    })

    it('should assign positions to all nodes', () => {
      const nodes = [
        createStepNode('step1'),
        createDataNode('var1'),
      ]

      const result = applyDagreLayout(nodes, [])

      expect(result.length).toBe(2)
      result.forEach((node) => {
        expect(typeof node.position.x).toBe('number')
        expect(typeof node.position.y).toBe('number')
        expect(Number.isNaN(node.position.x)).toBe(false)
        expect(Number.isNaN(node.position.y)).toBe(false)
      })
    })

    it('should preserve node data', () => {
      const nodes = [
        createStepNode('step1'),
        createDataNode('var1'),
      ]

      const result = applyDagreLayout(nodes, [])

      expect(result[0].id).toBe('step1')
      expect(result[0].type).toBe('step')
      expect(result[0].data.name).toBe('step1')
      expect(result[1].id).toBe('var1')
      expect(result[1].type).toBe('data')
    })
  })

  describe('layout with edges', () => {
    it('should layout connected nodes left-to-right', () => {
      // step1 -> var1 -> step2
      const nodes = [
        createStepNode('step1'),
        createDataNode('var1'),
        createStepNode('step2'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('var1', 'step2'),
      ]

      const result = applyDagreLayout(nodes, edges)

      // Find nodes by id
      const step1 = result.find((n) => n.id === 'step1')!
      const var1 = result.find((n) => n.id === 'var1')!
      const step2 = result.find((n) => n.id === 'step2')!

      // step1 should be leftmost, step2 rightmost
      expect(step1.position.x).toBeLessThan(var1.position.x)
      expect(var1.position.x).toBeLessThan(step2.position.x)
    })

    it('should handle diamond topology', () => {
      // step1 -> var1 -> step2 -> var3 -> step4
      //       \-> var2 -> step3 ->/
      const nodes = [
        createStepNode('step1'),
        createDataNode('var1'),
        createDataNode('var2'),
        createStepNode('step2'),
        createStepNode('step3'),
        createDataNode('var3'),
        createStepNode('step4'),
      ]
      const edges = [
        createEdge('step1', 'var1'),
        createEdge('step1', 'var2'),
        createEdge('var1', 'step2'),
        createEdge('var2', 'step3'),
        createEdge('step2', 'var3'),
        createEdge('step3', 'var3'),
        createEdge('var3', 'step4'),
      ]

      const result = applyDagreLayout(nodes, edges)

      // All nodes should have valid positions
      expect(result.length).toBe(7)
      result.forEach((node) => {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      })

      // step4 should be rightmost (downstream of everything)
      const step1 = result.find((n) => n.id === 'step1')!
      const step4 = result.find((n) => n.id === 'step4')!
      expect(step1.position.x).toBeLessThan(step4.position.x)
    })
  })

  describe('disconnected components', () => {
    it('should layout disconnected nodes', () => {
      // Two independent nodes
      const nodes = [
        createStepNode('step1'),
        createStepNode('step2'),
      ]

      const result = applyDagreLayout(nodes, [])

      // Both should have valid positions
      expect(result.length).toBe(2)
      result.forEach((node) => {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      })
    })
  })

  describe('node sizing', () => {
    it('should produce more compact layout for data nodes than steps with many I/O', () => {
      // Two data nodes stacked vertically
      const dataNodes = [
        createDataNode('d1'),
        createDataNode('d2'),
        createStepNode('s1'),
      ]
      const dataEdges = [
        createEdge('d1', 's1'),
        createEdge('d2', 's1'),
      ]

      // Two step nodes with multiple I/O (taller) stacked vertically
      const stepNodes = [
        createStepNodeWithIO('s1', { a: 'x', b: 'y' }, { out: 'z' }, { p1: 1, p2: 2, p3: 3 }),
        createStepNodeWithIO('s2', { a: 'x', b: 'y' }, { out: 'z' }, { p1: 1, p2: 2, p3: 3 }),
        createDataNode('d1'),
      ]
      const stepEdges = [
        createEdge('s1', 'd1'),
        createEdge('s2', 'd1'),
      ]

      const dataResult = applyDagreLayout(dataNodes, dataEdges)
      const stepResult = applyDagreLayout(stepNodes, stepEdges)

      const dataYs = dataResult.map((n) => n.position.y)
      const dataSpan = Math.max(...dataYs) - Math.min(...dataYs)

      const stepYs = stepResult.map((n) => n.position.y)
      const stepSpan = Math.max(...stepYs) - Math.min(...stepYs)

      // Steps with I/O are taller, so the step layout should use more vertical space
      expect(dataSpan).toBeLessThan(stepSpan)
    })
  })

  describe('parameter node handling', () => {
    it('should position parameter nodes to the left of their connected step', () => {
      const nodes = [
        createParameterNode('p1', 10),
        createStepNode('step1'),
        createDataNode('out1'),
      ]
      const edges = [
        createEdge('p1', 'step1'),
        createEdge('step1', 'out1'),
      ]

      const result = applyDagreLayout(nodes, edges)
      const p1 = result.find((n) => n.id === 'p1')!
      const step1 = result.find((n) => n.id === 'step1')!

      expect(p1.position.x).toBeLessThan(step1.position.x)
    })

    it('should include all parameter nodes in result', () => {
      const nodes = [
        createParameterNode('p1', 1),
        createParameterNode('p2', 2),
        createStepNode('step1'),
      ]
      const edges = [
        createEdge('p1', 'step1'),
        createEdge('p2', 'step1'),
      ]

      const result = applyDagreLayout(nodes, edges)
      expect(result.length).toBe(3)
      expect(result.find((n) => n.id === 'p1')).toBeDefined()
      expect(result.find((n) => n.id === 'p2')).toBeDefined()
    })

    it('should produce compact layout with many parameters vs without', () => {
      // Step with 10 parameters (parameters excluded from dagre)
      const manyParamNodes: Node[] = [
        createStepNodeWithIO(
          'step1',
          { img: 'image' },
          { out: 'result' },
          Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`arg${i}`, `$p${i}`])),
        ),
        createDataNode('out1'),
        ...Array.from({ length: 10 }, (_, i) => createParameterNode(`p${i}`, i)),
      ]
      const manyParamEdges: Edge[] = [
        createEdge('step1', 'out1'),
        ...Array.from({ length: 10 }, (_, i) => createEdge(`p${i}`, 'step1')),
      ]

      const result = applyDagreLayout(manyParamNodes, manyParamEdges)

      // All nodes should have valid positions
      expect(result.length).toBe(12)
      result.forEach((node) => {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      })

      // The step+data vertical span should be reasonable.
      // Without parameter exclusion, 10 params in dagre would create ~600px+ vertical span
      // from parameter stacking. With exclusion, step+data layout is compact.
      const ys = result.filter((n) => n.type !== 'parameter').map((n) => n.position.y)
      const verticalSpan = Math.max(...ys) - Math.min(...ys)
      expect(verticalSpan).toBeLessThan(600)
    })

    it('should center-align parameters with different name lengths', () => {
      // Create parameters with different name lengths
      const shortParam: Node = {
        id: 'short', type: 'parameter', position: { x: 0, y: 0 },
        data: { name: 'w_lmk', value: 1 },
      }
      const longParam: Node = {
        id: 'long', type: 'parameter', position: { x: 0, y: 0 },
        data: { name: 'n_stage3_icp_passes', value: 20 },
      }
      const nodes = [shortParam, longParam, createStepNode('step1')]
      const edges = [createEdge('short', 'step1'), createEdge('long', 'step1')]

      const result = applyDagreLayout(nodes, edges)
      const s = result.find((n) => n.id === 'short')!
      const l = result.find((n) => n.id === 'long')!

      // Shorter parameter should be shifted right (larger x) compared to longer one
      // because both are centered on the same column axis
      expect(s.position.x).toBeGreaterThan(l.position.x)
    })

    it('should handle orphan parameters not connected to any step', () => {
      const nodes = [
        createParameterNode('orphan', 42),
        createStepNode('step1'),
      ]

      const result = applyDagreLayout(nodes, [])

      expect(result.length).toBe(2)
      const orphan = result.find((n) => n.id === 'orphan')!
      expect(Number.isFinite(orphan.position.x)).toBe(true)
      expect(Number.isFinite(orphan.position.y)).toBe(true)
    })
  })

  describe('grouped nodes', () => {
    const createGroupedStepNode = (id: string, group: string): Node => ({
      id,
      type: 'step',
      position: { x: 0, y: 0 },
      data: { name: id, task: 'tasks/test.py', inputs: {}, outputs: {}, args: {}, group },
    })

    it('should not return virtual _group_ cluster nodes in result', () => {
      const nodes = [
        createGroupedStepNode('step1', 'my_group'),
        createGroupedStepNode('step2', 'my_group'),
        createStepNode('step3'),
      ]

      const result = applyDagreLayout(nodes, [])

      // Virtual cluster nodes must be filtered out
      const ids = result.map((n) => n.id)
      expect(ids).not.toContain('_group_my_group')
      expect(result.length).toBe(3)
    })

    it('should return valid positions for all original nodes', () => {
      const nodes = [
        createGroupedStepNode('step1', 'group_a'),
        createGroupedStepNode('step2', 'group_a'),
        createStepNode('step3'),
      ]

      const result = applyDagreLayout(nodes, [])

      result.forEach((node) => {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      })
    })

    it('should cluster grouped nodes closer together than ungrouped', () => {
      // step1 and step2 are in the same group; step3 is far apart in x
      const nodes = [
        createGroupedStepNode('step1', 'group_a'),
        createGroupedStepNode('step2', 'group_a'),
        createStepNode('step3'),
      ]
      const edges = [
        createEdge('step1', 'step3'),
        createEdge('step2', 'step3'),
      ]

      const result = applyDagreLayout(nodes, edges)

      const s1 = result.find((n) => n.id === 'step1')!
      const s2 = result.find((n) => n.id === 'step2')!
      const s3 = result.find((n) => n.id === 'step3')!

      // step3 should be to the right of both grouped nodes (downstream)
      expect(s3.position.x).toBeGreaterThan(s1.position.x)
      expect(s3.position.x).toBeGreaterThan(s2.position.x)
    })

    it('should handle multiple groups without errors', () => {
      const nodes = [
        createGroupedStepNode('a1', 'group_a'),
        createGroupedStepNode('a2', 'group_a'),
        createGroupedStepNode('b1', 'group_b'),
        createGroupedStepNode('b2', 'group_b'),
      ]

      const result = applyDagreLayout(nodes, [])

      expect(result.length).toBe(4)
      result.forEach((node) => {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      })
    })
  })
})
