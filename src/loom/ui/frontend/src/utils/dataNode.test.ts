/**
 * Tests for data node operations and connection validation.
 *
 * These tests verify:
 * - Data node creation with different types
 * - Connection validation between data nodes and steps
 * - Type compatibility checking for connections
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetNodeIdCounter,
  createStepNode,
  createDataNode,
  createDataToStepEdge,
  createStepToDataEdge,
  createGraphState,
} from './graphTestUtils'
import type { StepData, DataNodeData, TaskInfo, DataType, InputOutputSchema } from '../types/pipeline'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock task with typed inputs and outputs.
 */
function createMockTask(
  name: string,
  inputs: Record<string, InputOutputSchema> = {},
  outputs: Record<string, InputOutputSchema> = {}
): TaskInfo {
  return {
    name,
    path: `tasks/${name}.py`,
    description: `Test task ${name}`,
    inputs,
    outputs,
    args: {},
  }
}

/**
 * Validates a connection between a data node and a step.
 * Returns null if valid, or an error message if invalid.
 */
function validateDataToStepConnection(
  dataNode: { data: DataNodeData },
  stepNode: { data: StepData },
  targetHandle: string,
  tasks: TaskInfo[]
): string | null {
  const task = tasks.find((t) => t.path === stepNode.data.task)
  if (!task) return null // No task schema, allow connection

  const inputSchema = task.inputs[targetHandle]
  if (!inputSchema?.type) return null // No type constraint, allow connection

  if (inputSchema.type !== dataNode.data.type) {
    return `Type mismatch: data node is "${dataNode.data.type}" but input expects "${inputSchema.type}"`
  }

  return null
}

/**
 * Validates a connection from a step output to a data node.
 * Returns null if valid, or an error message if invalid.
 */
function validateStepToDataConnection(
  stepNode: { data: StepData },
  dataNode: { data: DataNodeData },
  sourceHandle: string,
  tasks: TaskInfo[]
): string | null {
  const task = tasks.find((t) => t.path === stepNode.data.task)
  if (!task) return null // No task schema, allow connection

  const outputSchema = task.outputs[sourceHandle]
  if (!outputSchema?.type) return null // No type constraint, allow connection

  if (outputSchema.type !== dataNode.data.type) {
    return `Type mismatch: step output is "${outputSchema.type}" but data node is "${dataNode.data.type}"`
  }

  return null
}

// ============================================================================
// Tests
// ============================================================================

describe('Data Node Operations', () => {
  beforeEach(() => {
    resetNodeIdCounter()
  })

  // ==========================================================================
  // SECTION 1: Data Node Creation
  // ==========================================================================

  describe('Data Node Creation', () => {
    it('should create data nodes with correct structure', () => {
      const dataNode = createDataNode('input_video', 'video', 'data/video.mp4')

      expect(dataNode.type).toBe('data')
      expect((dataNode.data as DataNodeData).name).toBe('input_video')
      expect((dataNode.data as DataNodeData).type).toBe('video')
      expect((dataNode.data as DataNodeData).path).toBe('data/video.mp4')
    })

    it('should create data nodes for all supported types', () => {
      const types: DataType[] = ['image', 'video', 'csv', 'json', 'image_directory', 'data_folder']

      for (const type of types) {
        const node = createDataNode(`test_${type}`, type, `data/test.${type}`)
        expect(node.data.type).toBe(type)
      }
    })

    it('should create data nodes with optional fields', () => {
      const node = createDataNode('training_images', 'image_directory', 'data/training/', {
        description: 'Training image directory',
        pattern: '*.png',
        exists: true,
      })

      expect(node.data.description).toBe('Training image directory')
      expect(node.data.pattern).toBe('*.png')
      expect(node.data.exists).toBe(true)
    })

    it('should generate unique IDs for data nodes', () => {
      const node1 = createDataNode('video')
      const node2 = createDataNode('video')

      expect(node1.id).not.toBe(node2.id)
    })
  })

  // ==========================================================================
  // SECTION 2: Data Node Edge Creation
  // ==========================================================================

  describe('Data Node Edge Creation', () => {
    it('should create edges from data nodes to steps', () => {
      const dataNode = createDataNode('input_csv', 'csv', 'data/input.csv')
      const stepNode = createStepNode('process', { task: 'tasks/process.py' })
      const edge = createDataToStepEdge(dataNode.id, stepNode.id, 'data')

      expect(edge.source).toBe(dataNode.id)
      expect(edge.target).toBe(stepNode.id)
      expect(edge.sourceHandle).toBe('value')
      expect(edge.targetHandle).toBe('data')
    })

    it('should create edges from steps to data nodes', () => {
      const stepNode = createStepNode('extract', { task: 'tasks/extract.py' })
      const dataNode = createDataNode('output_csv', 'csv', 'data/output.csv')
      const edge = createStepToDataEdge(stepNode.id, dataNode.id, '-o')

      expect(edge.source).toBe(stepNode.id)
      expect(edge.target).toBe(dataNode.id)
      expect(edge.sourceHandle).toBe('-o')
      expect(edge.targetHandle).toBe('input')
    })
  })

  // ==========================================================================
  // SECTION 3: Connection Validation
  // ==========================================================================

  describe('Connection Type Validation', () => {
    it('should allow connection when types match', () => {
      const dataNode = createDataNode('input_video', 'video', 'data/input.mp4')
      const stepNode = createStepNode('extract', { task: 'tasks/extract.py' })
      const tasks = [
        createMockTask('extract', {
          video: { description: 'Input video file', type: 'video' },
        }),
      ]

      const error = validateDataToStepConnection(dataNode, stepNode, 'video', tasks)
      expect(error).toBeNull()
    })

    it('should reject connection when types mismatch', () => {
      const dataNode = createDataNode('input_csv', 'csv', 'data/input.csv')
      const stepNode = createStepNode('extract', { task: 'tasks/extract.py' })
      const tasks = [
        createMockTask('extract', {
          video: { description: 'Input video file', type: 'video' },
        }),
      ]

      const error = validateDataToStepConnection(dataNode, stepNode, 'video', tasks)
      expect(error).toBe('Type mismatch: data node is "csv" but input expects "video"')
    })

    it('should allow connection when input has no type constraint', () => {
      const dataNode = createDataNode('input_data', 'json', 'data/input.json')
      const stepNode = createStepNode('process', { task: 'tasks/process.py' })
      const tasks = [
        createMockTask('process', {
          data: { description: 'Input data file' }, // No type specified
        }),
      ]

      const error = validateDataToStepConnection(dataNode, stepNode, 'data', tasks)
      expect(error).toBeNull()
    })

    it('should allow connection when task schema not found', () => {
      const dataNode = createDataNode('input_video', 'video', 'data/input.mp4')
      const stepNode = createStepNode('unknown', { task: 'tasks/unknown.py' })
      const tasks: TaskInfo[] = [] // No task schema

      const error = validateDataToStepConnection(dataNode, stepNode, 'video', tasks)
      expect(error).toBeNull()
    })

    it('should validate step output to data node connections', () => {
      const stepNode = createStepNode('extract', { task: 'tasks/extract.py' })
      const dataNodeCSV = createDataNode('output_csv', 'csv', 'data/output.csv')
      const dataNodeVideo = createDataNode('output_video', 'video', 'data/output.mp4')
      const tasks = [
        createMockTask(
          'extract',
          {},
          {
            '-o': { description: 'Output CSV file', type: 'csv' },
          }
        ),
      ]

      // Matching types should pass
      const validError = validateStepToDataConnection(stepNode, dataNodeCSV, '-o', tasks)
      expect(validError).toBeNull()

      // Mismatched types should fail
      const invalidError = validateStepToDataConnection(stepNode, dataNodeVideo, '-o', tasks)
      expect(invalidError).toBe('Type mismatch: step output is "csv" but data node is "video"')
    })
  })

  // ==========================================================================
  // SECTION 4: Graph State with Data Nodes
  // ==========================================================================

  describe('Graph State with Data Nodes', () => {
    it('should create graph state with data nodes', () => {
      const videoData = createDataNode('video', 'video', 'data/input.mp4')
      const csvData = createDataNode('gaze', 'csv', 'data/gaze.csv')
      const step = createStepNode('extract', { task: 'tasks/extract.py' })

      const state = createGraphState(
        [videoData, csvData, step],
        [
          createDataToStepEdge(videoData.id, step.id, 'video'),
          createDataToStepEdge(csvData.id, step.id, 'gaze'),
        ]
      )

      expect(state.nodes).toHaveLength(3)
      expect(state.edges).toHaveLength(2)

      // Verify node types
      const dataNodes = state.nodes.filter((n) => n.type === 'data')
      expect(dataNodes).toHaveLength(2)
    })

    it('should support data node chains with steps', () => {
      // Pipeline: input_video -> extract -> output_csv
      const inputVideo = createDataNode('input_video', 'video', 'data/input.mp4')
      const extract = createStepNode('extract', { task: 'tasks/extract.py' })
      const outputCSV = createDataNode('output_csv', 'csv', 'data/output.csv')

      const state = createGraphState(
        [inputVideo, extract, outputCSV],
        [
          createDataToStepEdge(inputVideo.id, extract.id, 'video'),
          createStepToDataEdge(extract.id, outputCSV.id, '-o'),
        ]
      )

      expect(state.nodes).toHaveLength(3)
      expect(state.edges).toHaveLength(2)

      // Verify edge connections
      const inputEdge = state.edges.find((e) => e.source === inputVideo.id)
      expect(inputEdge?.target).toBe(extract.id)

      const outputEdge = state.edges.find((e) => e.target === outputCSV.id)
      expect(outputEdge?.source).toBe(extract.id)
    })
  })

  // ==========================================================================
  // SECTION 5: Data Type Compatibility
  // ==========================================================================

  describe('Data Type Compatibility', () => {
    const fileTypes: DataType[] = ['image', 'video', 'csv', 'json']
    const directoryTypes: DataType[] = ['image_directory', 'data_folder']

    it('should identify file vs directory types', () => {
      for (const type of fileTypes) {
        const isDirectory = type === 'image_directory' || type === 'data_folder'
        expect(isDirectory).toBe(false)
      }

      for (const type of directoryTypes) {
        const isDirectory = type === 'image_directory' || type === 'data_folder'
        expect(isDirectory).toBe(true)
      }
    })

    it('should enforce strict type matching', () => {
      // Each type should only match itself
      const allTypes: DataType[] = [...fileTypes, ...directoryTypes]

      for (const type1 of allTypes) {
        for (const type2 of allTypes) {
          const shouldMatch = type1 === type2
          const dataNode = createDataNode('test', type1)
          const tasks = [
            createMockTask('test_task', {
              input: { description: 'Test input', type: type2 },
            }),
          ]
          const stepNode = createStepNode('test_task', { task: 'tasks/test_task.py' })

          const error = validateDataToStepConnection(dataNode, stepNode, 'input', tasks)
          if (shouldMatch) {
            expect(error).toBeNull()
          } else {
            expect(error).not.toBeNull()
          }
        }
      }
    })
  })
})
