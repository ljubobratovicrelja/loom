import { memo, useCallback, useRef } from 'react'
import { useViewport, type NodeProps } from '@xyflow/react'
import type { GroupNode as GroupNodeType } from '../types/pipeline'

function GroupNodeComponent({ data, width = 200, height = 100 }: NodeProps<GroupNodeType>) {
  const { zoom } = useViewport()
  const zoomed = data.isZoomedOut

  // When zoomed out, boost fill and border so groups become the prominent visual layer
  const bgAlpha = zoomed ? '30' : '18'
  const borderAlpha = zoomed ? '60' : '30'

  // When zoomed out, scale label to fill the group box; otherwise keep it in the corner.
  // We estimate character width as ~0.6em and pick the font size that fits the box,
  // clamped so it doesn't get absurdly large for short names or tiny groups.
  const charCount = data.groupName.length || 1
  const fitByWidth = (width * 0.8) / (charCount * 0.6) // 80% of box width
  const fitByHeight = height * 0.35 // at most 35% of box height
  const centeredFontSize = Math.max(16, Math.min(fitByWidth, fitByHeight))

  const cornerFontSize = Math.min(13 / zoom, 28)

  const fontSize = zoomed ? centeredFontSize : cornerFontSize

  const { onGroupClick, onGroupDoubleClick } = data
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // Clear any pending timer from a previous click (onClick fires per-click, not per-pair)
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      onGroupClick?.()
    }, 250)
  }, [onGroupClick])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    onGroupDoubleClick?.()
  }, [onGroupDoubleClick])

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
        transition: 'background-color 0.4s ease, border-color 0.4s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: zoomed ? '50%' : '8px',
          left: zoomed ? '50%' : '12px',
          transform: zoomed ? 'translate(-50%, -50%)' : 'none',
          fontSize: `${fontSize}px`,
          lineHeight: 1,
          color: data.color,
          fontWeight: 600,
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          transition: 'top 0.4s ease, left 0.4s ease, transform 0.4s ease, font-size 0.4s ease',
        }}
      >
        {data.groupName}
      </span>
    </div>
  )
}

export default memo(GroupNodeComponent)
