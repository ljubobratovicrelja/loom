import { describe, it, expect } from 'vitest'
import type { Edge } from '@xyflow/react'
import {
  buildDataKey,
  clearDataRefsForEdges,
  clearStepRef,
  createOutputDataNode,
  inferOutputDataType,
  makeDataNodeId,
  setStepRef,
  uniqueDataKey,
} from './dataNodeCreation'
import type { PipelineNode, StepData, TaskInfo } from '../types/pipeline'
import { createDataNode, createStepNode } from './graphTestUtils'

function mockTask(outputs: TaskInfo['outputs'] = {}): TaskInfo {
  return {
    name: 'detect',
    path: 'tasks/detect.py',
    description: '',
    inputs: {},
    outputs,
    args: {},
  }
}

describe('buildDataKey', () => {
  it('lowercases and sanitizes step name and handle', () => {
    expect(buildDataKey('Extract Visual', '--out-dir')).toBe('extract_visual_out_dir')
  })

  it('never returns an empty key', () => {
    expect(buildDataKey('!!!', '???')).toBe('output')
  })
})

describe('uniqueDataKey', () => {
  it('returns the base when unused', () => {
    expect(uniqueDataKey('out', [])).toBe('out')
  })

  it('appends an incrementing suffix when taken', () => {
    expect(uniqueDataKey('out', ['out', 'out_2'])).toBe('out_3')
  })
})

describe('inferOutputDataType', () => {
  it('uses the task output type', () => {
    expect(inferOutputDataType(mockTask({ '-o': { description: '', type: 'image' } }), '-o')).toBe(
      'image',
    )
  })

  it('falls back to data_folder for unknown handles or tasks', () => {
    expect(inferOutputDataType(mockTask(), '-o')).toBe('data_folder')
    expect(inferOutputDataType(undefined, '-o')).toBe('data_folder')
  })
})

describe('setStepRef / clearStepRef', () => {
  it('sets and clears input references', () => {
    const step = { inputs: { image: '' }, outputs: {}, args: {} } as unknown as StepData
    const wired = setStepRef(step, 'image', 'raw_image', 'input')
    expect(wired.inputs.image).toBe('$raw_image')
    expect(clearStepRef(wired, 'image', 'input').inputs.image).toBe('')
  })

  it('sets arg references when the handle is an argument', () => {
    const step = { inputs: {}, outputs: {}, args: { '--radius': 3 } } as unknown as StepData
    const wired = setStepRef(step, '--radius', 'blur_radius', 'input')
    expect(wired.args['--radius']).toBe('$blur_radius')
    expect(wired.inputs).toEqual({})
  })

  it('sets output references', () => {
    const step = { inputs: {}, outputs: { '-o': '' }, args: {} } as unknown as StepData
    const wired = setStepRef(step, '-o', 'result', 'output')
    expect(wired.outputs['-o']).toBe('$result')
  })
})

describe('createOutputDataNode', () => {
  it('creates a typed node, wires the output, and adds the edge', () => {
    const step = createStepNode('detect', {
      id: 'step1',
      outputs: { '-o': '' },
      task: 'tasks/detect.py',
    }) as PipelineNode
    const tasks = [mockTask({ '-o': { description: '', type: 'csv' } })]

    const result = createOutputDataNode({
      nodes: [step],
      edges: [],
      stepId: 'step1',
      handleId: '-o',
      position: { x: 10, y: 20 },
      tasks,
      nodeId: 'data_new',
    })

    expect(result).not.toBeNull()
    const newNode = result!.newNode
    expect(newNode.data.type).toBe('csv')
    expect(newNode.data.key).toBe('detect_o')
    expect(newNode.position).toEqual({ x: 10, y: 20 })

    const wiredStep = result!.nodes.find((n) => n.id === 'step1') as PipelineNode
    expect((wiredStep.data as StepData).outputs['-o']).toBe('$detect_o')

    expect(result!.edges).toHaveLength(1)
    expect(result!.edges[0]).toMatchObject({
      source: 'step1',
      target: 'data_new',
      sourceHandle: '-o',
      targetHandle: 'input',
    })
  })

  it('replaces an existing edge from the same output handle', () => {
    const step = createStepNode('detect', {
      id: 'step1',
      outputs: { '-o': '$old' },
    }) as PipelineNode
    const oldData = createDataNode('old', 'csv', 'data/old.csv', { id: 'data_old' }) as PipelineNode
    const oldEdge: Edge = {
      id: 'e_step1_data_old_-o',
      source: 'step1',
      target: 'data_old',
      sourceHandle: '-o',
      targetHandle: 'input',
    }

    const result = createOutputDataNode({
      nodes: [step, oldData],
      edges: [oldEdge],
      stepId: 'step1',
      handleId: '-o',
      position: { x: 0, y: 0 },
      tasks: [],
      nodeId: 'data_new',
    })

    expect(result!.edges).toHaveLength(1)
    expect(result!.edges[0].target).toBe('data_new')
  })

  it('returns null for unknown steps or non-output handles', () => {
    const step = createStepNode('detect', { id: 'step1', outputs: {}, inputs: { image: '' } })
    const base = { nodes: [step] as PipelineNode[], edges: [], tasks: [], position: { x: 0, y: 0 } }
    expect(createOutputDataNode({ ...base, stepId: 'missing', handleId: '-o' })).toBeNull()
    expect(createOutputDataNode({ ...base, stepId: 'step1', handleId: 'image' })).toBeNull()
  })
})

describe('clearDataRefsForEdges', () => {
  it('clears step output and input references for deleted data edges', () => {
    const producer = createStepNode('produce', {
      id: 'step_producer',
      outputs: { '-o': '$mid' },
    }) as PipelineNode
    const consumer = createStepNode('consume', {
      id: 'step_consumer',
      inputs: { image: '$mid' },
    }) as PipelineNode
    const data = createDataNode('mid', 'image', 'data/mid.png', { id: 'data_mid' }) as PipelineNode

    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'step_producer',
        target: 'data_mid',
        sourceHandle: '-o',
        targetHandle: 'input',
      },
      {
        id: 'e2',
        source: 'data_mid',
        target: 'step_consumer',
        sourceHandle: 'value',
        targetHandle: 'image',
      },
    ]

    const result = clearDataRefsForEdges([producer, consumer, data], edges)
    const resultProducer = result.find((n) => n.id === 'step_producer') as PipelineNode
    const resultConsumer = result.find((n) => n.id === 'step_consumer') as PipelineNode
    expect((resultProducer.data as StepData).outputs['-o']).toBe('')
    expect((resultConsumer.data as StepData).inputs.image).toBe('')
  })

  it('ignores edges that do not touch data nodes', () => {
    const step = createStepNode('a', { id: 'step_a' }) as PipelineNode
    const edges: Edge[] = [{ id: 'e1', source: 'step_a', target: 'step_b', sourceHandle: '-o' }]
    const result = clearDataRefsForEdges([step], edges)
    expect(result[0]).toBe(step)
  })
})

describe('makeDataNodeId', () => {
  it('returns unique ids', () => {
    expect(makeDataNodeId()).not.toBe(makeDataNodeId())
  })
})
