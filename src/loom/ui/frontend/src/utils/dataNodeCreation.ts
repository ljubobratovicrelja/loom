/**
 * Pure helpers for creating and wiring typed data nodes.
 *
 * The editor's YAML serialization is driven by `step.data.inputs`, `outputs`
 * and `args` (edges are only reconstructed from those). So every data-node
 * connection must also update the connected step's reference — these helpers
 * keep that logic testable and out of the React components.
 */

import type { Edge } from '@xyflow/react'
import type {
  DataFileEntry,
  DataNode as DataNodeType,
  DataNodeData,
  DataType,
  PipelineNode,
  StepData,
  TaskInfo,
} from '../types/pipeline'

export type StepRefKind = 'input' | 'output'

let generatedIdCounter = 0

/** Builds a process-unique id for a generated data node. */
export function makeDataNodeId(): string {
  generatedIdCounter += 1
  return `data_${Date.now()}_${generatedIdCounter}`
}

/**
 * Resolves the data type for a step output handle from the task schema.
 * Falls back to `data_folder` when the task or typed output is unknown.
 */
export function inferOutputDataType(task: TaskInfo | undefined, handleId: string): DataType {
  return task?.outputs[handleId]?.type ?? 'data_folder'
}

/** Derives a `$reference` key from a step name and output handle. */
export function buildDataKey(stepName: string, handleId: string): string {
  const raw = `${stepName}_${handleId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
  const trimmed = raw.replace(/^_+/, '').replace(/_+$/, '')
  return trimmed || 'output'
}

/** Returns `base`, or `base_2`, `base_3`, ... until it is not in `existingKeys`. */
export function uniqueDataKey(base: string, existingKeys: Iterable<string>): string {
  const existing = new Set(existingKeys)
  if (!existing.has(base)) return base
  let counter = 2
  while (existing.has(`${base}_${counter}`)) counter += 1
  return `${base}_${counter}`
}

/**
 * Sets a data reference on a step. For `output` handles the reference is stored
 * in `outputs`; for `input` handles it goes to `inputs` (or to `args` when the
 * handle is an argument).
 */
export function setStepRef(
  stepData: StepData,
  handle: string,
  key: string,
  kind: StepRefKind,
): StepData {
  const ref = `$${key}`
  if (kind === 'output') {
    return { ...stepData, outputs: { ...(stepData.outputs || {}), [handle]: ref } }
  }
  if (stepData.inputs && handle in stepData.inputs) {
    return { ...stepData, inputs: { ...stepData.inputs, [handle]: ref } }
  }
  if (stepData.args && handle in stepData.args) {
    return { ...stepData, args: { ...stepData.args, [handle]: ref } }
  }
  return { ...stepData, inputs: { ...(stepData.inputs || {}), [handle]: ref } }
}

/**
 * Clears a data reference previously set by `setStepRef`. Returns the original
 * object when nothing referenced `handle`.
 */
export function clearStepRef(stepData: StepData, handle: string, kind: StepRefKind): StepData {
  if (kind === 'output') {
    if (!stepData.outputs || !(handle in stepData.outputs)) return stepData
    return { ...stepData, outputs: { ...stepData.outputs, [handle]: '' } }
  }
  if (stepData.inputs && handle in stepData.inputs) {
    return { ...stepData, inputs: { ...stepData.inputs, [handle]: '' } }
  }
  if (stepData.args && handle in stepData.args) {
    return { ...stepData, args: { ...stepData.args, [handle]: '' } }
  }
  return stepData
}

export interface CreateOutputDataNodeOptions {
  nodes: PipelineNode[]
  edges: Edge[]
  stepId: string
  handleId: string
  position: { x: number; y: number }
  tasks: TaskInfo[]
  nodeId?: string
}

export interface CreateOutputDataNodeResult {
  nodes: PipelineNode[]
  edges: Edge[]
  newNode: DataNodeType
}

/**
 * Creates a typed data node at `position` for a step's output handle and wires
 * it: the step's `outputs[handleId]` becomes `$<key>` and an edge is added.
 * Any existing edge from the same step output handle is replaced.
 *
 * Returns `null` when the source step or output handle cannot be resolved.
 */
export function createOutputDataNode(
  options: CreateOutputDataNodeOptions,
): CreateOutputDataNodeResult | null {
  const { nodes, edges, stepId, handleId, position, tasks } = options

  const stepNode = nodes.find((n) => n.id === stepId && n.type === 'step')
  if (!stepNode) return null
  const stepData = stepNode.data as StepData
  if (!stepData.outputs || !(handleId in stepData.outputs)) return null

  const task = tasks.find((t) => t.path === stepData.task)
  const dataType = inferOutputDataType(task, handleId)

  const existingKeys = nodes
    .filter((n) => n.type === 'data')
    .map((n) => (n.data as DataNodeData).key)
  const key = uniqueDataKey(buildDataKey(stepData.name, handleId), existingKeys)

  const nodeId = options.nodeId ?? makeDataNodeId()
  const newNode: DataNodeType = {
    id: nodeId,
    type: 'data',
    position,
    selected: true,
    data: { key, name: key, type: dataType, path: '' },
  }

  const nextNodes: PipelineNode[] = [
    ...nodes.map((node): PipelineNode => {
      if (node.id === stepId && node.type === 'step') {
        return {
          ...node,
          selected: false,
          data: setStepRef(node.data as StepData, handleId, key, 'output'),
        }
      }
      return node.selected ? { ...node, selected: false } : node
    }),
    newNode,
  ]

  const nextEdges: Edge[] = [
    ...edges.filter((e) => !(e.source === stepId && e.sourceHandle === handleId)),
    {
      id: `e_${stepId}_${nodeId}_${handleId}`,
      source: stepId,
      target: nodeId,
      sourceHandle: handleId,
      targetHandle: 'input',
    },
  ]

  return { nodes: nextNodes, edges: nextEdges, newNode }
}

/** Extension -> data type map used when picking a file from a directory. */
const EXTENSION_TYPE_MAP: Record<string, DataType> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  tif: 'image',
  tiff: 'image',
  mp4: 'video',
  avi: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  csv: 'csv',
  json: 'json',
  txt: 'txt',
  md: 'txt',
  log: 'txt',
}

/** Infers a data node type from a filename extension (default: txt). */
export function inferDataTypeFromFilename(filename: string): DataType {
  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
  return EXTENSION_TYPE_MAP[ext] ?? 'txt'
}

/** Builds a data key from a file name, dropping its extension. */
export function buildFileKey(filename: string): string {
  const stem = filename.replace(/\.[^./]+$/, '')
  const raw = stem
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
  const trimmed = raw.replace(/^_+/, '').replace(/_+$/, '')
  return trimmed || 'file'
}

export interface CreateNestedDataNodeOptions {
  nodes: PipelineNode[]
  edges: Edge[]
  dirNodeId: string
  entry: DataFileEntry
  position: { x: number; y: number }
  nodeId?: string
}

export interface CreateNestedDataNodeResult {
  nodes: PipelineNode[]
  edges: Edge[]
  newNode: DataNodeType
}

/**
 * Creates a file data node nested inside a directory data node and wires the
 * containment edge (`dir ⊃ file`). The new node records `nested_in` so the
 * dependency survives serialization and is re-derived on reload.
 *
 * Returns `null` when the directory node cannot be resolved.
 */
export function createNestedDataNode(
  options: CreateNestedDataNodeOptions,
): CreateNestedDataNodeResult | null {
  const { nodes, edges, dirNodeId, entry, position } = options

  const dirNode = nodes.find((n) => n.id === dirNodeId && n.type === 'data')
  if (!dirNode) return null
  const dirData = dirNode.data as DataNodeData
  if (!dirData.key) return null

  const existingKeys = nodes
    .filter((n) => n.type === 'data')
    .map((n) => (n.data as DataNodeData).key)
  const key = uniqueDataKey(buildFileKey(entry.name), existingKeys)

  const nodeId = options.nodeId ?? makeDataNodeId()
  const newNode: DataNodeType = {
    id: nodeId,
    type: 'data',
    position,
    selected: true,
    data: {
      key,
      name: entry.name,
      type: inferDataTypeFromFilename(entry.name),
      path: entry.path,
      nested_in: `$${dirData.key}`,
    },
  }

  const nextNodes: PipelineNode[] = [
    ...nodes.map((node): PipelineNode => (node.selected ? { ...node, selected: false } : node)),
    newNode,
  ]

  const nextEdges: Edge[] = [
    ...edges,
    {
      id: `e_nested_${dirNodeId}_${nodeId}`,
      source: dirNodeId,
      target: nodeId,
      sourceHandle: 'value',
      targetHandle: 'input',
      type: 'containment',
    },
  ]

  return { nodes: nextNodes, edges: nextEdges, newNode }
}

/**
 * Clears step references for data edges that were deleted. For each step,
 * an outgoing edge to a data node clears the matching output reference; an
 * incoming edge from a data node clears the matching input/arg reference.
 * Returns the original array when nothing changed.
 */
export function clearDataRefsForEdges(nodes: PipelineNode[], deletedEdges: Edge[]): PipelineNode[] {
  if (deletedEdges.length === 0) return nodes

  const dataNodeIds = new Set(nodes.filter((n) => n.type === 'data').map((n) => n.id))

  let changed = false
  const result = nodes.map((node): PipelineNode => {
    if (node.type !== 'step') return node
    let stepData = node.data as StepData

    for (const edge of deletedEdges) {
      if (edge.source === node.id && edge.sourceHandle && dataNodeIds.has(edge.target)) {
        stepData = clearStepRef(stepData, edge.sourceHandle, 'output')
      } else if (edge.target === node.id && edge.targetHandle && dataNodeIds.has(edge.source)) {
        stepData = clearStepRef(stepData, edge.targetHandle, 'input')
      }
    }

    if (stepData !== node.data) {
      changed = true
      return { ...node, data: stepData }
    }
    return node
  })

  return changed ? result : nodes
}
