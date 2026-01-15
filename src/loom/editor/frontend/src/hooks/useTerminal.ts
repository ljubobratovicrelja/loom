import { useRef, useCallback, useState, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ExecutionStatus, RunRequest, StepExecutionState } from '../types/pipeline'

interface UseTerminalOptions {
  onStatusChange?: (status: ExecutionStatus) => void
  onStepStatusChange?: (stepName: string, state: StepExecutionState) => void
  onStepOutput?: (stepName: string, output: string) => void  // For parallel mode
}

export function useTerminal(options: UseTerminalOptions = {}) {
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ExecutionStatus>('idle')

  // Store callbacks in refs to avoid stale closures in WebSocket handlers
  const onStatusChangeRef = useRef(options.onStatusChange)
  const onStepStatusChangeRef = useRef(options.onStepStatusChange)
  const onStepOutputRef = useRef(options.onStepOutput)

  // Keep refs updated
  useEffect(() => {
    onStatusChangeRef.current = options.onStatusChange
    onStepStatusChangeRef.current = options.onStepStatusChange
    onStepOutputRef.current = options.onStepOutput
  }, [options.onStatusChange, options.onStepStatusChange, options.onStepOutput])

  const updateStatus = useCallback((newStatus: ExecutionStatus) => {
    setStatus(newStatus)
    onStatusChangeRef.current?.(newStatus)
  }, [])

  const initTerminal = useCallback((container: HTMLDivElement) => {
    if (terminalRef.current) {
      // Already initialized, just refit
      fitAddonRef.current?.fit()
      return
    }

    const terminal = new Terminal({
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#60a5fa',
        cursorAccent: '#0f172a',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(container)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
  }, [])

  const run = useCallback(
    (request: RunRequest) => {
      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close()
      }

      const terminal = terminalRef.current
      if (!terminal) return

      terminal.clear()
      terminal.writeln('\x1b[36m[MIRA]\x1b[0m Starting execution...\r\n')

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`)
      wsRef.current = ws

      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        ws.send(JSON.stringify(request))
        updateStatus('running')
      }

      ws.onmessage = (event) => {
        let text: string

        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data)
          text = new TextDecoder().decode(bytes)

          // Check for multiplexed output: [OUTPUT:step_name]...
          const outputMatch = text.match(/^\[OUTPUT:(\S+)\](.*)$/s)
          if (outputMatch) {
            const [, stepName, output] = outputMatch
            // Store per-step output for parallel mode
            onStepOutputRef.current?.(stepName, output)
            // Still write to terminal for live view
            terminal.write(output)
          } else {
            // Sequential mode - write directly
            terminal.write(bytes)
          }
        } else {
          text = event.data

          // Try to parse as JSON (for step status messages in parallel mode)
          try {
            const msg = JSON.parse(text)
            if (msg.type === 'step_status') {
              const state: StepExecutionState =
                msg.status === 'running' ? 'running' :
                msg.status === 'completed' ? 'completed' :
                msg.status === 'failed' ? 'failed' : 'idle'
              onStepStatusChangeRef.current?.(msg.step, state)
              return  // Don't write JSON to terminal
            }
          } catch {
            // Not JSON, write as text
          }

          terminal.write(text)
        }

        // Parse step status from output (for sequential mode)
        // Strip ANSI escape codes first for reliable matching
        const plainText = text.replace(/\x1b\[[0-9;]*m/g, '')
        // Matches: [RUNNING] step_name, [SUCCESS] step_name, [FAILED] step_name, [CANCELLED] step_name
        const runningMatch = plainText.match(/\[RUNNING\]\s*(\S+)/)
        const successMatch = plainText.match(/\[SUCCESS\]\s*(\S+)/)
        const failedMatch = plainText.match(/\[FAILED\]\s*(\S+)/)
        const cancelledMatch = plainText.match(/\[CANCELLED\]\s*(\S+)/)

        if (runningMatch) {
          onStepStatusChangeRef.current?.(runningMatch[1], 'running')
        }
        if (successMatch) {
          onStepStatusChangeRef.current?.(successMatch[1], 'completed')
        }
        if (failedMatch) {
          onStepStatusChangeRef.current?.(failedMatch[1], 'failed')
        }
        if (cancelledMatch) {
          onStepStatusChangeRef.current?.(cancelledMatch[1], 'idle')
        }
      }

      ws.onclose = () => {
        terminal.writeln('\r\n\x1b[36m[MIRA]\x1b[0m Connection closed')
        updateStatus('idle')
      }

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        terminal.writeln('\r\n\x1b[31m[ERROR]\x1b[0m WebSocket error - check browser console')
        updateStatus('failed')
      }
    },
    [updateStatus]
  )

  const cancel = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Send cancel signal - the server will handle termination
      wsRef.current.send('__CANCEL__')
      updateStatus('cancelled')
    }
  }, [updateStatus])

  const cancelStep = useCallback((stepName: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Send per-step cancel for parallel mode
      wsRef.current.send(`__CANCEL__:${stepName}`)
    }
  }, [])

  const resize = useCallback(() => {
    fitAddonRef.current?.fit()
  }, [])

  const clear = useCallback(() => {
    terminalRef.current?.clear()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
      terminalRef.current?.dispose()
    }
  }, [])

  return {
    initTerminal,
    run,
    cancel,
    cancelStep,
    resize,
    clear,
    status,
  }
}
