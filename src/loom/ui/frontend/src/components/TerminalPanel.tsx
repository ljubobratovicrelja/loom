import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { ExecutionStatus, RunRequest, StepExecutionState } from '../types/pipeline'
import { useTerminal } from '../hooks/useTerminal'

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

function renderAnsiText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const ansiRegex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let currentColor = ''
  let match

  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      if (currentColor) {
        parts.push(
          <span key={parts.length} className={currentColor}>
            {segment}
          </span>,
        )
      } else {
        parts.push(segment)
      }
    }

    const codes = match[1].split(';')
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentColor = ''
      } else if (ansiColors[code]) {
        currentColor = ansiColors[code]
      }
    }

    lastIndex = ansiRegex.lastIndex
  }

  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex)
    if (currentColor) {
      parts.push(
        <span key={parts.length} className={currentColor}>
          {segment}
        </span>,
      )
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
  onStepOutput?: (stepName: string, output: string) => void
  onPipelineMessage?: (message: string) => void
  runRequest: RunRequest | null
  activeTerminalStep?: string | null
  stepOutputs?: Map<string, string>
  stepStatuses?: Map<string, StepExecutionState>
  // Steps currently running outside of useTerminal (independent step WS hook).
  externalRunningSteps?: Set<string>
  onCancelStep?: (stepName: string) => void
  onClearStepOutput?: (stepName: string) => void
}

export default function TerminalPanel({
  visible,
  onToggle,
  onStatusChange,
  onStepStatusChange,
  onStepOutput,
  onPipelineMessage,
  runRequest,
  activeTerminalStep,
  stepOutputs,
  stepStatuses,
  externalRunningSteps,
  onCancelStep,
  onClearStepOutput,
}: TerminalPanelProps) {
  const outputRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(300)
  const lastRequestRef = useRef<RunRequest | null>(null)

  const {
    run,
    cancel,
    cancelStep: cancelOrchestratedStep,
    status,
    runningSteps: orchestratedRunningSteps,
  } = useTerminal({
    onStatusChange,
    onStepStatusChange,
    onStepOutput,
    onPipelineMessage,
  })

  // Combined "anything running" set: orchestrated runs (sequential/group/all/parallel)
  // plus independent step WebSockets driven by useStepExecutions.
  const allRunningSteps = useMemo(() => {
    const combined = new Set<string>(orchestratedRunningSteps)
    if (externalRunningSteps) {
      for (const name of externalRunningSteps) combined.add(name)
    }
    return combined
  }, [orchestratedRunningSteps, externalRunningSteps])

  const anyRunning = allRunningSteps.size > 0

  // Step the terminal currently "locks" to while a run is in progress.
  // The user can switch among currently-running steps via the tab strip
  // but cannot escape into a non-running step until everything finishes.
  const [lockedStep, setLockedStep] = useState<string | null>(null)

  // When new steps start running, if no lock yet, lock to the first.
  // When the locked step stops running but others are still running, switch to one of them.
  // When all stop, release the lock.
  useEffect(() => {
    if (!anyRunning) {
      setLockedStep(null)
      return
    }
    if (!lockedStep || !allRunningSteps.has(lockedStep)) {
      // Pick a step to lock onto (first in iteration order = first started in most cases)
      const next = allRunningSteps.values().next().value as string | undefined
      if (next) setLockedStep(next)
    }
  }, [anyRunning, allRunningSteps, lockedStep])

  // Which step's buffer to display.
  // While running: the locked step (canvas selection cannot override).
  // While idle: whatever step the user has selected on the canvas.
  const viewedStep = anyRunning ? lockedStep : (activeTerminalStep ?? null)
  const viewedOutput = viewedStep ? stepOutputs?.get(viewedStep) : undefined
  const viewedStatus: StepExecutionState | undefined = viewedStep
    ? allRunningSteps.has(viewedStep)
      ? 'running'
      : stepStatuses?.get(viewedStep)
    : undefined

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [viewedOutput, viewedStep])

  useEffect(() => {
    if (runRequest && visible && runRequest !== lastRequestRef.current) {
      lastRequestRef.current = runRequest
      run(runRequest)
    }
  }, [runRequest, visible, run])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [height],
  )

  const handleCancelViewed = useCallback(() => {
    if (!viewedStep) return
    // Independent step runs are owned by App via onCancelStep prop.
    // Orchestrated parallel runs are cancelled via the shared WS.
    if (externalRunningSteps?.has(viewedStep) && onCancelStep) {
      onCancelStep(viewedStep)
    } else if (orchestratedRunningSteps.has(viewedStep)) {
      cancelOrchestratedStep(viewedStep)
    } else {
      // Sequential / pipeline-level cancel
      cancel()
    }
  }, [
    viewedStep,
    externalRunningSteps,
    onCancelStep,
    orchestratedRunningSteps,
    cancelOrchestratedStep,
    cancel,
  ])

  // Tab strip: only render when more than one step is concurrently running.
  const runningStepsList = useMemo(() => Array.from(allRunningSteps), [allRunningSteps])

  return (
    <>
      {!visible && (
        <button
          onClick={onToggle}
          className="h-8 bg-slate-200 dark:bg-slate-900 border-t border-slate-300 dark:border-slate-700
                     flex items-center px-4 text-slate-500 dark:text-slate-400 text-sm hover:bg-slate-300 dark:hover:bg-slate-800
                     transition-colors w-full"
        >
          <span className="mr-2">&#9650;</span>
          Terminal
          {(status === 'running' || anyRunning) && (
            <span className="ml-2 text-green-500 dark:text-green-400 animate-pulse">
              &#9679; Running
            </span>
          )}
        </button>
      )}

      <div
        className="bg-slate-100 dark:bg-slate-950 border-t border-slate-300 dark:border-slate-700 flex flex-col"
        style={{ height: visible ? height : 0, overflow: 'hidden' }}
      >
        <div
          className="h-1 bg-slate-300 dark:bg-slate-800 cursor-ns-resize hover:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
          onMouseDown={handleMouseDown}
        />

        <div className="h-9 bg-slate-200 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <span className="text-slate-900 dark:text-white text-sm font-medium whitespace-nowrap">
              Terminal
              {viewedStep && (
                <>
                  : <span className="text-cyan-500 dark:text-cyan-400">{viewedStep}</span>
                </>
              )}
              {anyRunning && (
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  (locked while running)
                </span>
              )}
            </span>
            {viewedStep && viewedStatus === 'running' && (
              <span className="text-cyan-500 dark:text-cyan-400 text-xs animate-pulse">
                &#9679; Running
              </span>
            )}
            {viewedStep && viewedStatus === 'completed' && (
              <span className="text-green-500 dark:text-green-400 text-xs">&#10003; Completed</span>
            )}
            {viewedStep && viewedStatus === 'failed' && (
              <span className="text-red-500 dark:text-red-400 text-xs">&#10007; Failed</span>
            )}
            {!viewedStep && status === 'running' && (
              <span className="text-green-500 dark:text-green-400 text-xs animate-pulse">
                &#9679; Running
              </span>
            )}
            {!viewedStep && status === 'completed' && (
              <span className="text-green-500 dark:text-green-400 text-xs">&#10003; Completed</span>
            )}
            {!viewedStep && status === 'failed' && (
              <span className="text-red-500 dark:text-red-400 text-xs">&#10007; Failed</span>
            )}
            {!viewedStep && status === 'cancelled' && (
              <span className="text-yellow-500 dark:text-yellow-400 text-xs">
                &#9632; Cancelled
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {viewedStep && viewedStatus === 'running' && (
              <button
                onClick={handleCancelViewed}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs rounded transition-colors"
              >
                Cancel
              </button>
            )}
            {!viewedStep && status === 'running' && (
              <button
                onClick={cancel}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 dark:bg-red-700 dark:hover:bg-red-600 text-white text-xs rounded transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                if (viewedStep && onClearStepOutput) onClearStepOutput(viewedStep)
              }}
              disabled={!viewedStep}
              className="px-2 py-1 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-xs rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear
            </button>
            <button
              onClick={onToggle}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-sm px-2 transition-colors"
            >
              &#9660;
            </button>
          </div>
        </div>

        {/* Tab strip: visible only when 2+ steps are running, so user can switch
            among currently-running tasks. Canvas selection is ignored while running. */}
        {anyRunning && runningStepsList.length > 1 && (
          <div className="h-8 bg-slate-200 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700 flex items-center gap-1 px-2 shrink-0 overflow-x-auto">
            {runningStepsList.map((name) => (
              <button
                key={name}
                onClick={() => setLockedStep(name)}
                className={
                  'px-2 py-0.5 text-xs rounded transition-colors whitespace-nowrap ' +
                  (lockedStep === name
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-400 dark:hover:bg-slate-700')
                }
              >
                <span className="mr-1 animate-pulse">&#9679;</span>
                {name}
              </button>
            ))}
          </div>
        )}

        <div
          ref={outputRef}
          className="flex-1 p-2 overflow-auto bg-slate-50 dark:bg-slate-950 font-mono text-sm text-slate-700 dark:text-slate-200"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {viewedStep ? (
            viewedOutput ? (
              renderAnsiText(viewedOutput)
            ) : (
              <span className="text-slate-400 dark:text-slate-500">Waiting for output...</span>
            )
          ) : (
            <span className="text-slate-400 dark:text-slate-500">
              {status === 'running'
                ? 'Starting...'
                : 'Select a step on the canvas to view its output, or click Run.'}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
