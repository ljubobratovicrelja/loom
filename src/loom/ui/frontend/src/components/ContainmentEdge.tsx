import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Edge drawn from a container data node to a data node nested inside it.
 *
 * It is deliberately distinct from data-flow edges: dashed and muted, with an
 * "inside" label, so the ownership relation is visible without being mistaken
 * for a pipeline dependency.
 */
export default function ContainmentEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#2dd4bf' : '#5eead4',
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: '2 4',
          opacity: selected ? 1 : 0.8,
          filter: selected ? 'drop-shadow(0 0 6px rgba(45, 212, 191, 0.7))' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div className="px-1.5 py-0.5 rounded text-[9px] leading-none border bg-teal-50 dark:bg-teal-900/60 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300">
            &#8834; inside
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
