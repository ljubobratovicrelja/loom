import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { documentSignature, stableStringify } from './documentSignature'
import type { DataNodeData, ParameterData, PipelineNode, StepData } from '../types/pipeline'

function stepNode(overrides: Partial<StepData> = {}, node: Partial<Node> = {}): PipelineNode {
  return {
    id: 'step_1',
    type: 'step',
    position: { x: 0, y: 0 },
    data: {
      name: 'render',
      task: 'render_probe',
      inputs: {},
      outputs: {},
      args: {},
      optional: false,
      ...overrides,
    },
    ...node,
  } as PipelineNode
}

function dataNode(overrides: Partial<DataNodeData> = {}): PipelineNode {
  return {
    id: 'data_1',
    type: 'data',
    position: { x: 10, y: 20 },
    data: {
      key: 'probe',
      name: 'Probe',
      type: 'csv',
      path: 'probe.csv',
      ...overrides,
    },
  } as PipelineNode
}

function paramNode(overrides: Partial<ParameterData> = {}): PipelineNode {
  return {
    id: 'param_seed',
    type: 'parameter',
    position: { x: 0, y: 0 },
    data: { name: 'seed', value: 0, ...overrides },
  } as PipelineNode
}

describe('stableStringify', () => {
  it('ignores object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  it('is stable across nested structures', () => {
    expect(stableStringify({ a: { y: 1, x: 2 } })).toBe(stableStringify({ a: { x: 2, y: 1 } }))
  })
})

describe('documentSignature', () => {
  it('is unaffected by node selection', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature([stepNode({}, { selected: true })], [])
    expect(b).toBe(a)
  })

  it('is unaffected by measured dimensions', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature(
      [stepNode({}, { width: 200, height: 80, measured: { width: 2 } })],
      [],
    )
    expect(b).toBe(a)
  })

  it('is unaffected by runtime step status', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature(
      [stepNode({ executionState: 'running', freshnessStatus: 'stale' })],
      [],
    )
    expect(b).toBe(a)
  })

  it('is unaffected by runtime data existence flags', () => {
    const a = documentSignature([dataNode()], [])
    const b = documentSignature([dataNode({ exists: true, pulseError: true })], [])
    expect(b).toBe(a)
  })

  it('detects a node position change', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature([stepNode({}, { position: { x: 5, y: 0 } })], [])
    expect(b).not.toBe(a)
  })

  it('detects a document data change', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature([stepNode({ args: { seed: 1 } })], [])
    expect(b).not.toBe(a)
  })

  it('detects a parameter value change', () => {
    const a = documentSignature([paramNode()], [])
    const b = documentSignature([paramNode({ value: 42 })], [])
    expect(b).not.toBe(a)
  })

  it('detects added and removed nodes', () => {
    const a = documentSignature([stepNode()], [])
    const b = documentSignature([stepNode(), dataNode()], [])
    expect(b).not.toBe(a)
    expect(documentSignature([], [])).not.toBe(a)
  })

  it('is unaffected by feedback edge label offsets', () => {
    const base: Edge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      type: 'feedback',
      data: { feedback: true, groupName: 'g', multiPass: { feedback: {} } },
    }
    const moved: Edge = { ...base, data: { ...base.data, labelOffsetX: 12, labelOffsetY: -8 } }
    expect(documentSignature([], [moved])).toBe(documentSignature([], [base]))
  })

  it('detects a persisted feedback edge data change', () => {
    const base: Edge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      type: 'feedback',
      data: { feedback: true, groupName: 'g', multiPass: { feedback: {} } },
    }
    const changed: Edge = {
      ...base,
      data: { ...base.data, multiPass: { feedback: { 'a.out': 'b.in' } } },
    }
    expect(documentSignature([], [changed])).not.toBe(documentSignature([], [base]))
  })

  it('detects edge connection changes', () => {
    const a: Edge = { id: 'e1', source: 'a', target: 'b' }
    const b: Edge = { id: 'e1', source: 'a', target: 'c' }
    expect(documentSignature([], [b])).not.toBe(documentSignature([], [a]))
  })

  it('ignores edge selection', () => {
    const a: Edge = { id: 'e1', source: 'a', target: 'b' }
    const b: Edge = { id: 'e1', source: 'a', target: 'b', selected: true }
    expect(documentSignature([], [b])).toBe(documentSignature([], [a]))
  })

  it('detects a parameters map change', () => {
    expect(documentSignature([], [], { seed: 1 })).not.toBe(documentSignature([], [], { seed: 2 }))
  })
})
