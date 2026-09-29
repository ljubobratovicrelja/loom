import { describe, it, expect } from 'vitest'
import type { Edge } from '@xyflow/react'
import type { ParameterNode, PipelineNode } from '../types/pipeline'
import { estimateParamWidth } from './layout'
import {
  AUTO_PARAM_REF_FLAG,
  collapseParameterRefs,
  isAutoParamRef,
  splitParameterRefNodes,
} from './parameterRefs'

// =============================================================================
// Test Utilities
// =============================================================================

const createStep = (
  id: string,
  options: {
    position?: { x: number; y: number }
    inputs?: Record<string, string>
    args?: Record<string, unknown>
    outputs?: Record<string, string>
    loop?: boolean
  } = {},
): PipelineNode => ({
  id,
  type: 'step',
  position: options.position ?? { x: 0, y: 0 },
  data: {
    name: id,
    task: `tasks/${id}.py`,
    inputs: options.inputs ?? {},
    args: options.args ?? {},
    outputs: options.outputs ?? {},
    optional: false,
    loop: options.loop ? { over: '$in', into: '$out' } : undefined,
  },
})

const createParam = (
  name: string,
  id: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
): ParameterNode => ({
  id,
  type: 'parameter',
  position,
  data: { name, value: 1 },
})

const createRefParam = (
  name: string,
  id: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
): ParameterNode => ({
  id,
  type: 'parameter',
  position,
  data: { name, value: 1, isAutoParamRef: true },
})

const createDataNode = (
  id: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
): PipelineNode => ({
  id,
  type: 'data',
  position,
  data: { key: id, name: id, type: 'csv', path: `data/${id}.csv` },
})

const createEdge = (id: string, source: string, target: string, targetHandle?: string): Edge => ({
  id,
  source,
  target,
  targetHandle,
})

// =============================================================================
// splitParameterRefNodes Tests
// =============================================================================

describe('splitParameterRefNodes', () => {
  it('returns the exact input references when no parameter has multiple edges', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [createEdge('e1', 'param_threshold', 'step_a', 'alpha')]

    const result = splitParameterRefNodes(nodes, edges)

    expect(result.nodes).toBe(nodes)
    expect(result.edges).toBe(edges)
  })

  it('returns the exact input references when there are no parameter nodes', () => {
    const nodes = [
      createDataNode('data_out', { x: 0, y: 0 }),
      createStep('step_a', { position: { x: 200, y: 0 } }),
      createStep('step_b', { position: { x: 300, y: 0 } }),
    ]
    const edges = [
      createEdge('e1', 'data_out', 'step_a', 'in1'),
      createEdge('e2', 'data_out', 'step_b', 'in1'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    expect(result.nodes).toBe(nodes)
    expect(result.edges).toBe(edges)
  })

  it('splits two outgoing edges into one ref, keeping the nearest edge on the original', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    const refId = 'param_threshold__autoref__step_a__alpha'
    expect(result.nodes).toHaveLength(4)
    const refNode = result.nodes.find((n) => n.id === refId)
    expect(refNode).toBeDefined()
    expect(refNode?.type).toBe('parameter')

    // The original keeps the nearest edge (e2 -> step_b)
    const kept = result.edges.find((e) => e.id === 'e2')
    expect(kept?.source).toBe('param_threshold')
    expect(kept?.target).toBe('step_b')

    // The other edge is rewired to the ref node
    const rewired = result.edges.find((e) => e.source === refId)
    expect(rewired?.target).toBe('step_a')
    expect(rewired?.targetHandle).toBe('alpha')
    expect(rewired?.id).toBe(`e_${refId}_step_a_alpha`)
  })

  it('creates fully interactive ref nodes flagged with isAutoParamRef', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    const refNode = result.nodes.find((n) => n.id.includes('__autoref__')) as ParameterNode
    expect(refNode).toBeDefined()
    expect(refNode.data.isAutoParamRef).toBe(true)
    expect(refNode.data[AUTO_PARAM_REF_FLAG]).toBe(true)
    // Refs are real, interactive nodes: no interaction flags are disabled
    expect(refNode.selectable).not.toBe(false)
    expect(refNode.draggable).not.toBe(false)
    expect(refNode.deletable).not.toBe(false)
    expect(refNode.connectable).not.toBe(false)
    expect(refNode.focusable).not.toBe(false)
    expect(refNode.selectable).toBeUndefined()
    expect(refNode.draggable).toBeUndefined()
  })

  it('selects the nearest target as primary even when it is not first in the edges array', () => {
    const nodes = [
      createStep('step_far', { position: { x: 500, y: 0 } }),
      createStep('step_near', { position: { x: 80, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e_far', 'param_threshold', 'step_far', 'alpha'),
      createEdge('e_near', 'param_threshold', 'step_near', 'beta'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    // The nearer edge keeps the original source; the far edge gets rewired
    const kept = result.edges.find((e) => e.source === 'param_threshold')
    expect(kept?.id).toBe('e_near')
    const refId = 'param_threshold__autoref__step_far__alpha'
    const rewired = result.edges.find((e) => e.source === refId)
    expect(rewired?.target).toBe('step_far')
  })

  it('creates two refs for three outgoing edges that do not overlap', () => {
    // All steps share a position so both refs land at the same x/y base and the
    // overlap avoidance must separate them vertically.
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 100 } }),
      createStep('step_b', { position: { x: 300, y: 100 } }),
      createStep('step_c', { position: { x: 300, y: 100 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
      createEdge('e3', 'param_threshold', 'step_c', 'gamma'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    const refs = result.nodes.filter((n): n is ParameterNode => n.id.includes('__autoref__'))
    expect(refs).toHaveLength(2)
    expect(result.edges).toHaveLength(3)

    // Both refs share the same target step x, so they must be separated
    // vertically by at least REF_NODE_HEIGHT + 8 (68px).
    expect(refs[0].position.x).toBe(refs[1].position.x)
    expect(Math.abs(refs[1].position.y - refs[0].position.y)).toBeGreaterThanOrEqual(68)
  })

  it('positions the ref centered on the target handle row', () => {
    const nodes = [
      createStep('step_x', {
        position: { x: 400, y: 200 },
        inputs: { in1: '$a' },
        args: { arg1: '$b' },
        outputs: {},
      }),
      createStep('step_other', { position: { x: 200, y: 0 } }),
      createParam('gamma', 'param_gamma', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_gamma', 'step_x', 'arg1'),
      createEdge('e2', 'param_gamma', 'step_other', 'x'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    const refNode = result.nodes.find((n) => n.id === 'param_gamma__autoref__step_x__arg1')
    expect(refNode).toBeDefined()
    const refWidth = estimateParamWidth({ name: 'gamma', value: 1 })
    // step_x handleOrder = [in1, arg1] -> idx 1, yOffset = 50 + 26 + 13 = 89
    expect(refNode?.position.x).toBe(400 - 140 - refWidth)
    expect(refNode?.position.y).toBe(259)
  })

  it('falls back to a default position when the target node is missing', () => {
    const nodes = [
      createStep('step_other', { position: { x: 200, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 10, y: 20 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'missing_node', 'foo'),
      createEdge('e2', 'param_threshold', 'step_other', 'x'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    const refNode = result.nodes.find((n) => n.id === 'param_threshold__autoref__missing_node__foo')
    expect(refNode).toBeDefined()
    expect(refNode?.position).toEqual({ x: 270, y: 100 })
  })

  it('inserts each ref immediately after its source parameter node', () => {
    const nodes = [
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    expect(result.nodes[0].id).toBe('param_threshold')
    expect(result.nodes[1].id).toBe('param_threshold__autoref__step_a__alpha')
    expect(result.nodes[2].id).toBe('step_a')
    expect(result.nodes[3].id).toBe('step_b')
  })

  it('splits two parameters independently with unique ref ids', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createStep('step_c', { position: { x: 200, y: 0 } }),
      createParam('alpha', 'param_alpha', { x: 0, y: 0 }),
      createParam('beta', 'param_beta', { x: 0, y: 60 }),
    ]
    const edges = [
      createEdge('e1', 'param_alpha', 'step_a', 'a1'),
      createEdge('e2', 'param_alpha', 'step_b', 'b1'),
      createEdge('e3', 'param_beta', 'step_b', 'b2'),
      createEdge('e4', 'param_beta', 'step_c', 'c1'),
    ]

    const result = splitParameterRefNodes(nodes, edges)

    expect(result.nodes).toHaveLength(7) // 5 original + 2 refs
    expect(result.edges).toHaveLength(4)
    const refIds = result.nodes.filter((n) => n.id.includes('__autoref__')).map((n) => n.id)
    expect(refIds).toHaveLength(2)
    expect(refIds).toEqual(
      expect.arrayContaining([
        'param_alpha__autoref__step_a__a1',
        'param_beta__autoref__step_c__c1',
      ]),
    )
    expect(new Set(refIds).size).toBe(2)
  })

  it('does not mutate the input arrays or objects', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]
    const nodesBefore = structuredClone(nodes)
    const edgesBefore = structuredClone(edges)

    splitParameterRefNodes(nodes, edges)

    expect(nodes).toEqual(nodesBefore)
    expect(edges).toEqual(edgesBefore)
    expect(edges[0]).toEqual(edgesBefore[0])

    // Untouched nodes keep their object identity
    const result = splitParameterRefNodes(nodes, edges)
    expect(result.nodes[0]).toBe(nodes[0]) // step_a
    expect(result.nodes[1]).toBe(nodes[1]) // step_b
    expect(result.nodes[2]).toBe(nodes[2]) // param returned as-is
    // Primary edge passes through unchanged
    expect(result.edges[1]).toBe(edges[1])
  })
})

// =============================================================================
// isAutoParamRef Tests
// =============================================================================

describe('isAutoParamRef', () => {
  it('returns true for a ref node and false for a normal parameter node', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]

    const result = splitParameterRefNodes(nodes, edges)
    const refNode = result.nodes.find((n) => n.id.includes('__autoref__')) as ParameterNode

    expect(isAutoParamRef(refNode)).toBe(true)
    expect(isAutoParamRef(createParam('x', 'param_x'))).toBe(false)
  })

  it('returns false for non-parameter nodes', () => {
    expect(isAutoParamRef(createStep('step_a'))).toBe(false)
    expect(isAutoParamRef(createDataNode('data_a'))).toBe(false)
  })
})

// =============================================================================
// collapseParameterRefs Tests
// =============================================================================

describe('collapseParameterRefs', () => {
  it('returns the same references when there are no ref nodes', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [createEdge('e1', 'param_threshold', 'step_a', 'alpha')]

    const result = collapseParameterRefs(nodes, edges)

    expect(result.nodes).toBe(nodes)
    expect(result.edges).toBe(edges)
  })

  it('removes ref nodes and re-points their edges at the canonical parameter', () => {
    const nodes: PipelineNode[] = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
      createRefParam('threshold', 'param_threshold__autoref__step_a__alpha', {
        x: 120,
        y: 120,
      }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_b', 'beta'),
      createEdge('e_rewired', 'param_threshold__autoref__step_a__alpha', 'step_a', 'alpha'),
    ]

    const result = collapseParameterRefs(nodes, edges)

    expect(result.nodes).toHaveLength(3)
    expect(result.nodes.map((n) => n.id)).toEqual(['step_a', 'step_b', 'param_threshold'])

    const rewired = result.edges.find((e) => e.target === 'step_a')
    expect(rewired?.source).toBe('param_threshold')
    expect(rewired?.targetHandle).toBe('alpha')
    expect(rewired?.id).toBe('e_param_threshold_step_a_alpha')

    // Edges that did not touch a ref keep their object identity
    expect(result.edges.find((e) => e.target === 'step_b')).toBe(edges[0])
  })

  it('round-trips split then collapse back to the original nodes and edges', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e_param_threshold_step_a_alpha', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e_param_threshold_step_b_beta', 'param_threshold', 'step_b', 'beta'),
    ]

    const split = splitParameterRefNodes(nodes, edges)
    const collapsed = collapseParameterRefs(split.nodes, split.edges)

    // Edge ids must match the originals e_param_<name>_<target>_<handle>
    expect(collapsed.edges.map((e) => e.id).sort()).toEqual(edges.map((e) => e.id).sort())
    expect(collapsed.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id))
    expect(collapsed.nodes).toEqual(nodes)
    expect(collapsed.edges).toEqual(edges)
  })

  it('does not mutate the input arrays or objects', () => {
    const nodes = [
      createStep('step_a', { position: { x: 300, y: 0 } }),
      createStep('step_b', { position: { x: 100, y: 0 } }),
      createParam('threshold', 'param_threshold', { x: 0, y: 0 }),
    ]
    const edges = [
      createEdge('e1', 'param_threshold', 'step_a', 'alpha'),
      createEdge('e2', 'param_threshold', 'step_b', 'beta'),
    ]

    const split = splitParameterRefNodes(nodes, edges)
    const nodesBefore = structuredClone(split.nodes)
    const edgesBefore = structuredClone(split.edges)

    collapseParameterRefs(split.nodes, split.edges)

    expect(split.nodes).toEqual(nodesBefore)
    expect(split.edges).toEqual(edgesBefore)
  })
})
