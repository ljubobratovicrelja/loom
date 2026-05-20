import { useRef, useCallback, useState, useEffect } from 'react'
import type { ExecutionStatus, RunRequest, StepExecutionState } from '../types/pipeline'

interface UseTerminalOptions {
  onStatusChange?: (status: ExecutionStatus) => void
  onStepStatusChange?: (stepName: string, state: StepExecutionState) => void
  onStepOutput?: (stepName: string, output: string) => void
  onPipelineMessage?: (message: string) => void
}

export function useTerminal(options: UseTerminalOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ExecutionStatus>('idle')
  const [runningSteps, setRunningSteps] = useState<Set<string>>(new Set())

  // For sequential / group / all runs: the step whose PTY output we're
  // currently receiving. Parallel runs use the `[OUTPUT:name]` prefix instead.
  const currentStepRef = useRef<string | null>(null)

  const onStatusChangeRef = useRef(options.onStatusChange)
  const onStepStatusChangeRef = useRef(options.onStepStatusChange)
  const onStepOutputRef = useRef(options.onStepOutput)
  const onPipelineMessageRef = useRef(options.onPipelineMessage)

  useEffect(() => {
    onStatusChangeRef.current = options.onStatusChange
    onStepStatusChangeRef.current = options.onStepStatusChange
    onStepOutputRef.current = options.onStepOutput
    onPipelineMessageRef.current = options.onPipelineMessage
  }, [
    options.onStatusChange,
    options.onStepStatusChange,
    options.onStepOutput,
    options.onPipelineMessage,
  ])

  const updateStatus = useCallback((newStatus: ExecutionStatus) => {
    setStatus(newStatus)
    onStatusChangeRef.current?.(newStatus)
  }, [])

  const markRunning = useCallback((stepName: string, isRunning: boolean) => {
    setRunningSteps((prev) => {
      const next = new Set(prev)
      if (isRunning) next.add(stepName)
      else next.delete(stepName)
      return next
    })
  }, [])

  // Helper invoked for parallel-demultiplexed chunks so we still track per-step
  // status purely from their content.
  const parseMarkersForStep = useCallback(
    (output: string, stepName: string) => {
      const plain = output.replace(/\x1b\[[0-9;]*m/g, '')
      if (plain.includes('[RUNNING]')) markRunning(stepName, true)
      if (plain.includes('[SUCCESS]')) {
        markRunning(stepName, false)
        onStepStatusChangeRef.current?.(stepName, 'completed')
      }
      if (plain.includes('[FAILED]')) {
        markRunning(stepName, false)
        onStepStatusChangeRef.current?.(stepName, 'failed')
      }
      if (plain.includes('[CANCELLED]')) {
        markRunning(stepName, false)
        onStepStatusChangeRef.current?.(stepName, 'idle')
      }
    },
    [markRunning],
  )

  const run = useCallback(
    (request: RunRequest) => {
      if (wsRef.current) {
        wsRef.current.close()
      }

      currentStepRef.current = null
      setRunningSteps(new Set())

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`)
      wsRef.current = ws

      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        ws.send(JSON.stringify(request))
        updateStatus('running')
      }

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          const text = new TextDecoder().decode(bytes)

          // Parallel mode multiplexer: chunks are prefixed with [OUTPUT:name]
          const outputMatch = text.match(/^\[OUTPUT:(\S+)\]([\s\S]*)$/)
          if (outputMatch) {
            const [, stepName, output] = outputMatch
            onStepOutputRef.current?.(stepName, output)
            // Also parse markers inside the demultiplexed output
            parseMarkersForStep(output, stepName)
            return
          }

          // Sequential: route to currently running step
          if (currentStepRef.current) {
            onStepOutputRef.current?.(currentStepRef.current, text)
          } else {
            onPipelineMessageRef.current?.(text)
          }
          return
        }

        const text = event.data as string

        // JSON status messages (per-step)
        try {
          const msg = JSON.parse(text)
          if (msg.type === 'step_status') {
            const state: StepExecutionState =
              msg.status === 'running'
                ? 'running'
                : msg.status === 'completed'
                  ? 'completed'
                  : msg.status === 'failed'
                    ? 'failed'
                    : 'idle'
            if (msg.status === 'running') {
              currentStepRef.current = msg.step
              markRunning(msg.step, true)
            } else {
              if (currentStepRef.current === msg.step) {
                currentStepRef.current = null
              }
              markRunning(msg.step, false)
            }
            onStepStatusChangeRef.current?.(msg.step, state)
            return
          }
        } catch {
          // Not JSON
        }

        // Plain text marker lines from the server: [RUNNING] / [SUCCESS] /
        // [FAILED] / [CANCELLED] / [LOOM] / [COMPLETED] / [PARTIAL] / [ERROR]
        const plainText = text.replace(/\x1b\[[0-9;]*m/g, '')
        const runningMatch = plainText.match(/\[RUNNING\]\s*(\S+)/)
        const successMatch = plainText.match(/\[SUCCESS\]\s*(\S+)/)
        const failedMatch = plainText.match(/\[FAILED\]\s*(\S+)/)
        const cancelledMatch = plainText.match(/\[CANCELLED\]\s*(\S+)/)

        if (runningMatch) {
          currentStepRef.current = runningMatch[1]
          markRunning(runningMatch[1], true)
          onStepStatusChangeRef.current?.(runningMatch[1], 'running')
        }
        if (successMatch) {
          markRunning(successMatch[1], false)
          if (currentStepRef.current === successMatch[1]) currentStepRef.current = null
          onStepStatusChangeRef.current?.(successMatch[1], 'completed')
        }
        if (failedMatch) {
          markRunning(failedMatch[1], false)
          if (currentStepRef.current === failedMatch[1]) currentStepRef.current = null
          onStepStatusChangeRef.current?.(failedMatch[1], 'failed')
        }
        if (cancelledMatch) {
          markRunning(cancelledMatch[1], false)
          if (currentStepRef.current === cancelledMatch[1]) currentStepRef.current = null
          onStepStatusChangeRef.current?.(cancelledMatch[1], 'idle')
        }

        // Route the text into a step buffer if we know which step it belongs to.
        if (currentStepRef.current) {
          onStepOutputRef.current?.(currentStepRef.current, text)
        } else {
          onPipelineMessageRef.current?.(text)
        }
      }

      ws.onclose = () => {
        updateStatus('idle')
        currentStepRef.current = null
        setRunningSteps(new Set())
      }

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        updateStatus('failed')
      }
    },
    [updateStatus, markRunning, parseMarkersForStep],
  )

  const cancel = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send('__CANCEL__')
      updateStatus('cancelled')
    }
  }, [updateStatus])

  const cancelStep = useCallback((stepName: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(`__CANCEL__:${stepName}`)
    }
  }, [])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  return {
    run,
    cancel,
    cancelStep,
    status,
    runningSteps,
  }
}
