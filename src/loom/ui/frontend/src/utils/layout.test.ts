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

const createDataNode = (id: string): Node => ({
  id,
  type: 'data',
  position: { x: 0, y: 0 },
  data: { key: id, name: id, type: 'csv', path: 'data/test.csv' },
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
})
