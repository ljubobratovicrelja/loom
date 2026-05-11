import { useCallback, useRef } from 'react'
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from '@xyflow/react'
import type { FeedbackEdgeData } from '../types/pipeline'

export default function FeedbackEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps) {
  const { getViewport, setEdges } = useReactFlow()

  // Custom looping path that curves below the nodes to convey feedback
  const dx = Math.max(40, Math.abs(sourceX - targetX) * 0.15)
  const loopDrop = Math.max(60, Math.abs(sourceX - targetX) * 0.15 + Math.abs(sourceY - targetY) * 0.2)
  const bottomY = Math.max(sourceY, targetY) + loopDrop
  const midX = (sourceX + targetX) / 2

  // Label position with draggable offset stored in edge data
  // The label acts as the control point — dragging it reshapes the curve
  const feedbackData = data as (FeedbackEdgeData & { labelOffsetX?: number; labelOffsetY?: number }) | undefined
  const offsetX = feedbackData?.labelOffsetX ?? 0
  const offsetY = feedbackData?.labelOffsetY ?? 0
  const controlX = midX + offsetX
  const controlY = bottomY + offsetY

  const edgePath = [
    `M ${sourceX} ${sourceY}`,
    `C ${sourceX + dx} ${sourceY}, ${sourceX + dx} ${controlY}, ${controlX} ${controlY}`,
    `C ${targetX - dx} ${controlY}, ${targetX - dx} ${targetY}, ${targetX} ${targetY}`,
  ].join(' ')

  const labelX = controlX
  const labelY = controlY

  const mp = feedbackData?.multiPass

  // Build label text
  let labelText = 'feedback'
  if (mp) {
    const count = mp.schedule?.length ?? mp.count ?? '?'
    labelText = `${count} iterations`
    if (mp.condition?.script) {
      const scriptName = mp.condition.script.split('/').pop() || mp.condition.script
      labelText += `\n${scriptName}`
    }
  }

  // Drag handling — convert screen deltas to flow coords via zoom
  const dragRef = useRef<{
    startScreenX: number
    startScreenY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      dragRef.current = {
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startOffsetX: offsetX,
        startOffsetY: offsetY,
      }

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return
        const { zoom } = getViewport()
        const movedX = (ev.clientX - dragRef.current.startScreenX) / zoom
        const movedY = (ev.clientY - dragRef.current.startScreenY) / zoom
        setEdges((eds) =>
          eds.map((edge) =>
            edge.id === id
              ? {
                  ...edge,
                  data: {
                    ...edge.data,
                    labelOffsetX: dragRef.current!.startOffsetX + movedX,
                    labelOffsetY: dragRef.current!.startOffsetY + movedY,
                  },
                }
              : edge
          )
        )
      }

      const onMouseUp = () => {
        dragRef.current = null
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [id, offsetX, offsetY, getViewport, setEdges]
  )

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#a78bfa' : '#8b5cf6',
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: '8 4',
          filter: selected ? 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.7))' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            cursor: 'grab',
          }}
          onMouseDown={onMouseDown}
        >
          <div
            className={`px-2 py-1 rounded text-[10px] leading-tight whitespace-pre text-center border ${
              selected
                ? 'bg-purple-200 dark:bg-purple-800 border-purple-400 dark:border-purple-500 text-purple-800 dark:text-purple-200'
                : 'bg-purple-100 dark:bg-purple-900/50 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
            }`}
          >
            {labelText}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
