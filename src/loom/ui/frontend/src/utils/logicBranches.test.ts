import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { LogicStatus } from '../types/pipeline'
import { computeBranchActivity } from './logicBranches'

function switchNode(id: string, name: string): Node {
  return {
    id,
    type: 'switch',
    position: { x: 0, y: 0 },
    data: { name, condition: '$c', data: '$d' },
  }
}
function conditionNode(id: string, name: string): Node {
  return { id, type: 'condition', position: { x: 0, y: 0 }, data: { name, inputs: {}, args: {} } }
}
function stepNode(id: string, name: string): Node {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { name, task: `tasks/${name}.py`, inputs: {}, outputs: {}, args: {}, optional: false },
  }
}
function dataNode(id: string, key: string, exists: boolean | undefined = true): Node {
  return {
    id,
    type: 'data',
    position: { x: 0, y: 0 },
    data: { key, name: key, type: 'txt', path: `${key}.txt`, exists },
  }
}
function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): Edge {
  return { id, source, target, sourceHandle, targetHandle }
}

function graph(): { nodes: Node[]; edges: Edge[] } {
  const nodes = [
    conditionNode('cond', 'cond'),
    switchNode('sw', 'gate'),
    dataNode('din', 'din'),
    stepNode('then_step', 'then_step'),
    stepNode('else_step', 'else_step'),
    dataNode('dout', 'dout'),
    stepNode('after_else', 'after_else'),
  ]
  const edges = [
    edge('e_cond', 'cond', 'sw', 'result', 'condition'),
    edge('e_din', 'din', 'sw', 'value', 'data'),
    edge('e_then', 'sw', 'then_step', 'then'),
    edge('e_else', 'sw', 'else_step', 'else'),
    edge('e_out', 'else_step', 'dout'),
    edge('e_after', 'dout', 'after_else'),
  ]
  return { nodes, edges }
}

const status = (branches: Record<string, 'then' | 'else'>): LogicStatus => ({
  conditions: {},
  branches,
  errors: {},
})

describe('computeBranchActivity', () => {
  it('returns nothing when no branches are known', () => {
    const { nodes, edges } = graph()
    const r = computeBranchActivity(nodes, edges, { conditions: {}, branches: {}, errors: {} })
    expect(r.inactiveNodeIds.size).toBe(0)
    expect(r.inactiveEdgeIds.size).toBe(0)
    expect(computeBranchActivity(nodes, edges, null).inactiveNodeIds.size).toBe(0)
  })

  it('marks the non-taken branch and its downstream as inactive (then taken)', () => {
    const { nodes, edges } = graph()
    const r = computeBranchActivity(nodes, edges, status({ gate: 'then' }))

    expect(r.inactiveNodeIds.has('else_step')).toBe(true)
    expect(r.inactiveNodeIds.has('after_else')).toBe(true)
    expect(r.inactiveNodeIds.has('dout')).toBe(true)
    expect(r.inactiveNodeIds.has('then_step')).toBe(false)
    expect(r.inactiveNodeIds.has('sw')).toBe(false)

    expect(r.inactiveEdgeIds.has('e_else')).toBe(true)
    expect(r.inactiveEdgeIds.has('e_then')).toBe(false)
  })

  it('marks the other branch when else is taken', () => {
    const { nodes, edges } = graph()
    const r = computeBranchActivity(nodes, edges, status({ gate: 'else' }))
    expect(r.inactiveNodeIds.has('then_step')).toBe(true)
    expect(r.inactiveNodeIds.has('else_step')).toBe(false)
    expect(r.inactiveNodeIds.has('after_else')).toBe(false)
  })

  it('does not fade when the condition edge is removed (branch unknown)', () => {
    const { nodes, edges } = graph()
    const withoutCondition = edges.filter((e) => e.id !== 'e_cond')
    const r = computeBranchActivity(nodes, withoutCondition, status({ gate: 'then' }))
    expect(r.inactiveNodeIds.size).toBe(0)
    expect(r.inactiveEdgeIds.size).toBe(0)
  })

  it('does not fade when the switch payload edge is removed (branch unknown)', () => {
    const { nodes, edges } = graph()
    const withoutPayload = edges.filter((e) => e.id !== 'e_din')
    const r = computeBranchActivity(nodes, withoutPayload, status({ gate: 'then' }))
    expect(r.inactiveNodeIds.size).toBe(0)
    expect(r.inactiveEdgeIds.size).toBe(0)
  })

  it('does not fade when the payload data does not exist (branch unknown)', () => {
    // Same graph, but the payload data node reports exists === false.
    const nodes = [
      conditionNode('cond', 'cond'),
      switchNode('sw', 'gate'),
      dataNode('din', 'din', false),
      stepNode('then_step', 'then_step'),
      stepNode('else_step', 'else_step'),
    ]
    const edges = [
      edge('e_cond', 'cond', 'sw', 'result', 'condition'),
      edge('e_din', 'din', 'sw', 'value', 'data'),
      edge('e_then', 'sw', 'then_step', 'then'),
      edge('e_else', 'sw', 'else_step', 'else'),
    ]
    const r = computeBranchActivity(nodes, edges, status({ gate: 'then' }))
    expect(r.inactiveNodeIds.size).toBe(0)
  })

  it('does not fade when the condition input is disconnected (branch unknown)', () => {
    const nodes: Node[] = [
      {
        id: 'cond',
        type: 'condition',
        position: { x: 0, y: 0 },
        data: { name: 'cond', inputs: { data: '' }, args: {} },
      },
      switchNode('sw', 'gate'),
      dataNode('din', 'din'),
      stepNode('then_step', 'then_step'),
      stepNode('else_step', 'else_step'),
    ]
    const edges = [
      edge('e_cond', 'cond', 'sw', 'result', 'condition'),
      edge('e_din', 'din', 'sw', 'value', 'data'),
      edge('e_then', 'sw', 'then_step', 'then'),
      edge('e_else', 'sw', 'else_step', 'else'),
    ]
    const r = computeBranchActivity(nodes, edges, status({ gate: 'then' }))
    expect(r.inactiveNodeIds.size).toBe(0)
  })
})
