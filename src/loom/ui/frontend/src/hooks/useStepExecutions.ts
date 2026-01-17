import { useRef, useCallback, useState, useEffect } from 'react'
import type { StepExecutionState } from '../types/pipeline'

interface StepExecution {
  ws: WebSocket | null
  status: StepExecutionState
  retryCount: number
  retryTimeout: ReturnType<typeof setTimeout> | null
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000 // Base delay, increases exponentially

interface UseStepExecutionsOptions {
  onStepStatusChange?: (stepName: string, status: StepExecutionState) => void
  onStepOutput?: (stepName: string, output: string) => void
}

export function useStepExecutions(options: UseStepExecutionsOptions = {}) {
  // Map of step name -> execution info
  const executionsRef = useRef<Map<string, StepExecution>>(new Map())
  // Force re-renders when step statuses change
  const [stepStatuses, setStepStatuses] = useState<Map<string, StepExecutionState>>(new Map())

  // Store callbacks in refs to avoid stale closures
  const onStepStatusChangeRef = useRef(options.onStepStatusChange)
  const onStepOutputRef = useRef(options.onStepOutput)

  useEffect(() => {
    onStepStatusChangeRef.current = options.onStepStatusChange
    onStepOutputRef.current = options.onStepOutput
  }, [options.onStepStatusChange, options.onStepOutput])

  const updateStepStatus = useCallback((stepName: string, status: StepExecutionState) => {
    const exec = executionsRef.current.get(stepName)
    if (exec) {
      exec.status = status
    }
    setStepStatuses(prev => {
      const next = new Map(prev)
      next.set(stepName, status)
      return next
    })
    onStepStatusChangeRef.current?.(stepName, status)
  }, [])

  // Internal function to create WebSocket connection with retry support
  const connectWebSocket = useCallback((stepName: string, isRetry: boolean = false) => {
    const exec = executionsRef.current.get(stepName)
    if (!exec) return

    // Create new WebSocket for this step
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`)
    exec.ws = ws

    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      // Reset retry count on successful connection
      exec.retryCount = 0
      ws.send(JSON.stringify({ mode: 'step', step_name: stepName }))
      updateStepStatus(stepName, 'running')
      if (isRetry) {
        onStepOutputRef.current?.(stepName, `\x1b[32m[INFO]\x1b[0m Reconnected successfully\r\n`)
      }
    }

    ws.onmessage = (event) => {
      let text: string

      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        text = new TextDecoder().decode(bytes)
        // Send output to callback
        onStepOutputRef.current?.(stepName, text)
      } else {
        text = event.data

        // Try to parse as JSON (for status messages)
        try {
          const msg = JSON.parse(text)
          if (msg.type === 'step_status') {
            const state: StepExecutionState =
              msg.status === 'running' ? 'running' :
              msg.status === 'completed' ? 'completed' :
              msg.status === 'failed' ? 'failed' :
              msg.status === 'cancelled' ? 'idle' : 'idle'
            updateStepStatus(stepName, state)
            return // Don't send JSON to output
          }
        } catch {
          // Not JSON, send as output
        }

        onStepOutputRef.current?.(stepName, text)
      }

      // Parse status from text output
      const plainText = text.replace(/\x1b\[[0-9;]*m/g, '')
      if (plainText.includes('[RUNNING]')) {
        updateStepStatus(stepName, 'running')
      } else if (plainText.includes('[SUCCESS]')) {
        updateStepStatus(stepName, 'completed')
      } else if (plainText.includes('[FAILED]')) {
        updateStepStatus(stepName, 'failed')
      } else if (plainText.includes('[CANCELLED]')) {
        updateStepStatus(stepName, 'idle')
      }
    }

    ws.onclose = () => {
      const currentExec = executionsRef.current.get(stepName)
      if (currentExec) {
        currentExec.ws = null
        // If still running when closed, mark as idle
        if (currentExec.status === 'running') {
          updateStepStatus(stepName, 'idle')
        }
      }
    }

    ws.onerror = (error) => {
      console.error(`WebSocket error for step ${stepName}:`, error)
      const currentExec = executionsRef.current.get(stepName)

      if (currentExec && currentExec.retryCount < MAX_RETRIES) {
        // Attempt retry with exponential backoff
        currentExec.retryCount++
        const delay = RETRY_DELAY_MS * Math.pow(2, currentExec.retryCount - 1)
        onStepOutputRef.current?.(
          stepName,
          `\x1b[33m[WARN]\x1b[0m Connection failed, retrying in ${delay}ms (attempt ${currentExec.retryCount}/${MAX_RETRIES})\r\n`
        )
        currentExec.retryTimeout = setTimeout(() => {
          connectWebSocket(stepName, true)
        }, delay)
      } else {
        // Max retries exceeded, mark as failed
        onStepOutputRef.current?.(stepName, `\x1b[31m[ERROR]\x1b[0m WebSocket connection failed after ${MAX_RETRIES} retries\r\n`)
        updateStepStatus(stepName, 'failed')
      }
    }
  }, [updateStepStatus])

  const runStep = useCallback((stepName: string) => {
    // Check if already running
    const existing = executionsRef.current.get(stepName)
    if (existing?.status === 'running') {
      console.warn(`Step ${stepName} is already running`)
      return
    }

    // Clear any pending retry
    if (existing?.retryTimeout) {
      clearTimeout(existing.retryTimeout)
    }

    // Create execution entry
    const execution: StepExecution = {
      ws: null,
      status: 'idle',
      retryCount: 0,
      retryTimeout: null,
    }
    executionsRef.current.set(stepName, execution)

    // Start connection
    connectWebSocket(stepName)
  }, [connectWebSocket])

  const cancelStep = useCallback((stepName: string) => {
    const exec = executionsRef.current.get(stepName)
    if (exec?.ws && exec.ws.readyState === WebSocket.OPEN) {
      exec.ws.send('__CANCEL__')
    }
  }, [])

  const getStepStatus = useCallback((stepName: string): StepExecutionState => {
    return stepStatuses.get(stepName) || 'idle'
  }, [stepStatuses])

  const isAnyRunning = useCallback((): boolean => {
    for (const status of stepStatuses.values()) {
      if (status === 'running') return true
    }
    return false
  }, [stepStatuses])

  // Cleanup on unmount
  useEffect(() => {
    const executions = executionsRef.current
    return () => {
      for (const [, exec] of executions) {
        if (exec.retryTimeout) {
          clearTimeout(exec.retryTimeout)
        }
        exec.ws?.close()
      }
    }
  }, [])

  return {
    runStep,
    cancelStep,
    getStepStatus,
    stepStatuses,
    isAnyRunning,
  }
}
