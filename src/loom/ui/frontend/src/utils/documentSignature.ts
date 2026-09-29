import type { Edge } from '@xyflow/react'
import type { PipelineNode } from '../types/pipeline'

/**
 * Node data fields that are only relevant to the running/visual editor and are
 * never written to the pipeline YAML. Changes to these must not dirty the doc.
 */
const RUNTIME_NODE_DATA_KEYS = new Set([
  'executionState',
  'freshnessStatus',
  'exists',
  'pulseError',
])

/**
 * Edge data fields that only affect rendering (dragged feedback label position)
 * and are not persisted.
 */
const UI_EDGE_DATA_KEYS = new Set(['labelOffsetX', 'labelOffsetY'])

/**
 * Deterministic JSON serialization with sorted object keys, so that two values
 * with the same content in a different key order produce the same string.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map(
      (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
    )
  return `{${entries.join(',')}}`
}

function projectData(
  data: Record<string, unknown> | undefined,
  excludedKeys: Set<string>,
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {}
  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (excludedKeys.has(key) || value === undefined) continue
    projected[key] = value
  }
  return projected
}

/**
 * Computes a signature of the *document-relevant* content of the graph. Two
 * graphs share a signature when they would serialize to the same pipeline YAML,
 * ignoring editor/runtime-only state such as selection, measured dimensions,
 * execution status, freshness and file existence.
 *
 * Used to decide whether the user has unsaved changes without being fooled by
 * React Flow emitting `select`/`dimensions` changes or by background status
 * refreshes that rewrite node objects.
 */
export function documentSignature(
  nodes: PipelineNode[],
  edges: Edge[],
  parameters: Record<string, unknown> = {},
): string {
  const projectedNodes = nodes.map((node) => ({
    id: node.id,
    type: node.type ?? null,
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    data: projectData(node.data as Record<string, unknown> | undefined, RUNTIME_NODE_DATA_KEYS),
  }))

  const projectedEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    type: edge.type ?? null,
    data: projectData(edge.data as Record<string, unknown> | undefined, UI_EDGE_DATA_KEYS),
  }))

  return stableStringify({ nodes: projectedNodes, edges: projectedEdges, parameters })
}
