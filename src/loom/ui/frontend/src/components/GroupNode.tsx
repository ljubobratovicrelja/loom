import { memo, useCallback, useRef } from 'react'
import { useViewport, type NodeProps } from '@xyflow/react'
import type { GroupNode as GroupNodeType } from '../types/pipeline'
import { computeCenteredGroupLabel, INNER_RATIO, LINE_HEIGHT_RATIO } from '../utils/groupLabel'

function GroupNodeComponent({ data, width = 200, height = 100 }: NodeProps<GroupNodeType>) {
  const { zoom } = useViewport()
  const zoomed = data.isZoomedOut

  // When zoomed out, boost fill and border so groups become the prominent visual layer
  const bgAlpha = zoomed ? '30' : '18'
  const borderAlpha = zoomed ? '60' : '30'

  // When zoomed out, the label is centered and wrapped to the largest font that
  // still fits the rectangle (computed in screen px so it stays readable as the
  // user zooms out). Otherwise it sits in the corner at a constant screen size.
  const centeredLabel = zoomed
    ? computeCenteredGroupLabel(data.groupName, width, height, zoom)
    : null
  const fontSize = centeredLabel ? centeredLabel.fontSize / zoom : Math.min(13 / zoom, 28)

  // Selection visual state
  const { anyGroupSelected, isSelected } = data
  const selectionFilter =
    anyGroupSelected && !isSelected ? 'saturate(0.3) brightness(0.85)' : 'none'
  const selectionScale = anyGroupSelected && isSelected ? 'scale(1.02)' : 'none'

  const { onGroupClick, onGroupDoubleClick } = data
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      // Clear any pending timer from a previous click (onClick fires per-click, not per-pair)
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
      }
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        onGroupClick?.()
      }, 250)
    },
    [onGroupClick],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      onGroupDoubleClick?.()
    },
    [onGroupDoubleClick],
  )

  return (
    <div
      onClick={zoomed ? handleClick : undefined}
      onDoubleClick={zoomed ? handleDoubleClick : undefined}
      style={{
        width,
        height,
        backgroundColor: `${data.color}${bgAlpha}`,
        border: `1.5px solid ${data.color}${borderAlpha}`,
        borderRadius: 10,
        pointerEvents: zoomed ? 'auto' : 'none',
        userSelect: 'none',
        position: 'relative',
        cursor: zoomed ? 'pointer' : 'default',
        filter: selectionFilter,
        transform: selectionScale,
        transition:
          'background-color 0.4s ease, border-color 0.4s ease, transform 0.3s ease, filter 0.3s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: zoomed ? '50%' : '8px',
          left: zoomed ? '50%' : '12px',
          transform: zoomed ? 'translate(-50%, -50%)' : 'none',
          width: zoomed ? `${width * INNER_RATIO}px` : 'auto',
          textAlign: zoomed ? 'center' : 'left',
          fontSize: `${fontSize}px`,
          lineHeight: zoomed ? LINE_HEIGHT_RATIO : 1,
          color: data.color,
          fontWeight: 600,
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: zoomed ? 'normal' : 'nowrap',
          visibility: centeredLabel?.hidden ? 'hidden' : 'visible',
          transition: 'top 0.4s ease, left 0.4s ease, transform 0.4s ease, font-size 0.4s ease',
        }}
      >
        {data.groupName}
      </span>
    </div>
  )
}

export default memo(GroupNodeComponent)
