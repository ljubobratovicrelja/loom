import { useEffect, useRef, useState, useCallback } from 'react'
import '@xterm/xterm/css/xterm.css'
import type { ExecutionStatus, RunRequest, StepExecutionState } from '../types/pipeline'
import { useTerminal } from '../hooks/useTerminal'

// ANSI color code to Tailwind class mapping
const ansiColors: Record<string, string> = {
  '30': 'text-slate-900',
  '31': 'text-red-500',
  '32': 'text-green-500',
  '33': 'text-yellow-500',
  '34': 'text-blue-500',
  '35': 'text-purple-500',
  '36': 'text-cyan-500',
  '37': 'text-slate-200',
  '90': 'text-slate-500',
  '91': 'text-red-400',
  '92': 'text-green-400',
  '93': 'text-yellow-400',
  '94': 'text-blue-400',
  '95': 'text-purple-400',
  '96': 'text-cyan-400',
  '97': 'text-white',
}

// Convert ANSI escape codes to React elements
function renderAnsiText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match ANSI escape sequences: \x1b[...m or \033[...m
  const ansiRegex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let currentColor = ''
  let match

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      if (currentColor) {
        parts.push(<span key={parts.length} className={currentColor}>{segment}</span>)
      } else {
        parts.push(segment)
      }
    }

    // Parse the escape code
    const codes = match[1].split(';')
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentColor = ''  // Reset
      } else if (ansiColors[code]) {
        currentColor = ansiColors[code]
      }
    }

    lastIndex = ansiRegex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex)
    if (currentColor) {
      parts.push(<span key={parts.length} className={currentColor}>{segment}</span>)
    } else {
      parts.push(segment)
    }
  }

  return parts.length > 0 ? parts : [text]
}

interface TerminalPanelProps {
  visible: boolean
  onToggle: () => void
  onStatusChange: (status: ExecutionStatus) => void
  onStepStatusChange?: (stepName: string, state: StepExecutionState) => void
  onStepOutput?: (stepName: string, output: string) => void  // For parallel mode
  runRequest: RunRequest | null
  // For independent step execution
  activeTerminalStep?: string | null
  stepOutputs?: Map<string, string>
  stepStatuses?: Map<string, StepExecutionState>
  onCancelStep?: (stepName: string) => void
  onClearStepOutput?: (stepName: string) => void
}

export default function TerminalPanel({
  visible,
  onToggle,
  onStatusChange,
  onStepStatusChange,
  onStepOutput,
  runRequest,
  activeTerminalStep,
  stepOutputs,
  stepStatuses,
  onCancelStep,
  onClearStepOutput,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stepOutputRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(300)
  const lastRequestRef = useRef<RunRequest | null>(null)

  const { initTerminal, run, cancel, cancelStep: _cancelStep, resize, clear, status } = useTerminal({
    onStatusChange,
    onStepStatusChange,
    onStepOutput,
  })

  // Get active step's output and status
  const activeStepOutput = activeTerminalStep ? stepOutputs?.get(activeTerminalStep) : undefined
  const activeStepStatus = activeTerminalStep ? stepStatuses?.get(activeTerminalStep) : undefined
  // Show step output view whenever a step is selected and has been executed
  // This ensures we can always see/cancel running steps when they're selected
  const hasStepExecution = activeTerminalStep && stepStatuses?.has(activeTerminalStep)
  const showStepOutput = hasStepExecution || (activeTerminalStep && activeStepOutput)

  // Auto-scroll step output when it changes
  useEffect(() => {
    if (stepOutputRef.current && showStepOutput) {
      stepOutputRef.current.scrollTop = stepOutputRef.current.scrollHeight
    }
  }, [activeStepOutput, showStepOutput])

  // Initialize terminal when container is available (once)
  useEffect(() => {
    if (containerRef.current) {
      initTerminal(containerRef.current)
    }
  }, [initTerminal])

  // Run when request changes
  useEffect(() => {
    if (runRequest && visible && runRequest !== lastRequestRef.current) {
      lastRequestRef.current = runRequest
      run(runRequest)
    }
  }, [runRequest, visible, run])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [resize])

  // Resize terminal when height changes
  useEffect(() => {
    if (visible) {
      // Delay to allow DOM to update
      const timer = setTimeout(() => resize(), 10)
      return () => clearTimeout(timer)
    }
  }, [height, visible, resize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = height

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY
      setHeight(Math.max(150, Math.min(600, startHeight + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [height])

  // Always render the terminal container to preserve content,
  // but show/hide with CSS based on visibility
  return (
    <>
      {/* Collapsed bar - shown when terminal is hidden */}
      {!visible && (
        <button
          onClick={onToggle}
          className="h-8 bg-slate-900 border-t border-slate-700
                     flex items-center px-4 text-slate-400 text-sm hover:bg-slate-800
                     transition-colors w-full"
        >
          <span className="mr-2">&#9650;</span>
          Terminal
          {status === 'running' && (
            <span className="ml-2 text-green-400 animate-pulse">&#9679; Running</span>
          )}
        </button>
      )}

      {/* Full terminal panel - always rendered but hidden when collapsed */}
      <div
        className="bg-slate-950 border-t border-slate-700 flex flex-col"
        style={{ height: visible ? height : 0, overflow: 'hidden' }}
      >
        {/* Resize handle */}
        <div
          className="h-1 bg-slate-800 cursor-ns-resize hover:bg-blue-600 transition-colors"
          onMouseDown={handleMouseDown}
        />

        {/* Header */}
        <div className="h-9 bg-slate-900 border-b border-slate-700 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm font-medium">
              {showStepOutput ? (
                <>Terminal: <span className="text-cyan-400">{activeTerminalStep}</span></>
              ) : (
                'Terminal'
              )}
            </span>
            {/* Show step-specific status when viewing step output */}
            {showStepOutput && activeStepStatus === 'running' && (
              <span className="text-cyan-400 text-xs animate-pulse">&#9679; Running</span>
            )}
            {showStepOutput && activeStepStatus === 'completed' && (
              <span className="text-green-400 text-xs">&#10003; Completed</span>
            )}
            {showStepOutput && activeStepStatus === 'failed' && (
              <span className="text-red-400 text-xs">&#10007; Failed</span>
            )}
            {/* Show global status when not viewing step output */}
            {!showStepOutput && status === 'running' && (
              <span className="text-green-400 text-xs animate-pulse">&#9679; Running</span>
            )}
            {!showStepOutput && status === 'completed' && (
              <span className="text-green-400 text-xs">&#10003; Completed</span>
            )}
            {!showStepOutput && status === 'failed' && (
              <span className="text-red-400 text-xs">&#10007; Failed</span>
            )}
            {!showStepOutput && status === 'cancelled' && (
              <span className="text-yellow-400 text-xs">&#9632; Cancelled</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Step-specific cancel button */}
            {showStepOutput && activeStepStatus === 'running' && onCancelStep && activeTerminalStep && (
              <button
                onClick={() => onCancelStep(activeTerminalStep)}
                className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition-colors"
              >
                Cancel
              </button>
            )}
            {/* Global cancel button */}
            {!showStepOutput && status === 'running' && (
              <button
                onClick={cancel}
                className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition-colors"
              >
                Cancel
              </button>
            )}
            {/* Clear button - works for both modes */}
            <button
              onClick={() => {
                if (showStepOutput && activeTerminalStep && onClearStepOutput) {
                  onClearStepOutput(activeTerminalStep)
                } else {
                  clear()
                }
              }}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded transition-colors"
            >
              Clear
            </button>
            <button
              onClick={onToggle}
              className="text-slate-400 hover:text-white text-sm px-2 transition-colors"
            >
              &#9660;
            </button>
          </div>
        </div>

        {/* Step output view - shown when viewing a specific step's output */}
        {showStepOutput && (
          <div
            ref={stepOutputRef}
            className="flex-1 p-2 overflow-auto bg-slate-950 font-mono text-sm text-slate-200"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {activeStepOutput ? (
              renderAnsiText(activeStepOutput)
            ) : (
              <span className="text-slate-500">Waiting for output...</span>
            )}
          </div>
        )}

        {/* Terminal container - hidden when viewing step output */}
        <div
          ref={containerRef}
          className="flex-1 p-1 overflow-hidden"
          style={{ display: showStepOutput ? 'none' : 'block' }}
        />
      </div>
    </>
  )
}
