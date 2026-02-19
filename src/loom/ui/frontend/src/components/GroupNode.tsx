import { memo } from 'react'
import { useViewport, type NodeProps } from '@xyflow/react'
import type { GroupNode as GroupNodeType } from '../types/pipeline'

function GroupNodeComponent({ data, width = 200, height = 100 }: NodeProps<GroupNodeType>) {
  const { zoom } = useViewport()
  // Counter-scale so label stays at constant screen size, but cap at a maximum
  const rawFontSize = 13 / zoom
  const maxFontSize = 28 // cap so text doesn't dominate when zoomed out
  const fontSize = Math.min(rawFontSize, maxFontSize)

  // When zoomed out, boost fill and border so groups become the prominent visual layer
  const bgAlpha = data.isZoomedOut ? '30' : '18'
  const borderAlpha = data.isZoomedOut ? '60' : '30'

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: `${data.color}${bgAlpha}`,
        border: `1.5px solid ${data.color}${borderAlpha}`,
        borderRadius: 10,
        pointerEvents: 'none',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          fontSize: `${fontSize}px`,
          lineHeight: 1,
          color: data.color,
          fontWeight: 600,
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {data.groupName}
      </span>
    </div>
  )
}

export default memo(GroupNodeComponent)
