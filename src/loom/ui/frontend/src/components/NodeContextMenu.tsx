import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * A single action in the node context menu.
 *
 * `danger` renders the entry in red — used for destructive actions such as
 * delete. `disabled` greys the entry out and blocks the click.
 */
export interface ContextMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** Optional separator drawn above this entry. */
  separatorBefore?: boolean
}

export interface NodeContextMenuProps {
  /** Screen position (viewport coordinates) to anchor the menu at. */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** Menu width/height estimates used to keep the menu inside the viewport. */
const MENU_WIDTH = 220
const EDGE_MARGIN = 8

/**
 * Floating context menu anchored to a screen position.
 *
 * Rendered into a portal so the menu escapes the graph's overflow clipping and
 * the transformed canvas layer. Closes on outside click, Escape, scroll, or
 * when the window loses focus.
 */
export default function NodeContextMenu({ x, y, items, onClose }: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const handleOutside = useCallback(
    (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    },
    [onClose],
  )

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    // Capture phase so the menu closes before the canvas reacts to the click.
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [handleOutside, handleKey, onClose])

  // Keep the menu on screen when opened near the right or bottom edge.
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_MARGIN)
  const top = Math.min(y, window.innerHeight - items.length * 34 - EDGE_MARGIN)

  return createPortal(
    <div
      ref={menuRef}
      data-node-context-menu
      className="fixed z-[100] min-w-[200px] rounded-lg border border-slate-300 bg-white py-1 shadow-xl dark:border-slate-600 dark:bg-slate-800"
      style={{ left: Math.max(EDGE_MARGIN, left), top: Math.max(EDGE_MARGIN, top) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          {item.separatorBefore && (
            <div className="my-1 border-t border-slate-200 dark:border-slate-600" />
          )}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onSelect()
            }}
            className={[
              'block w-full px-3 py-1.5 text-left text-sm transition-colors',
              item.disabled
                ? 'cursor-not-allowed text-slate-400 dark:text-slate-500'
                : item.danger
                  ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
            ].join(' ')}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
