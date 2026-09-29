/**
 * Render a raw terminal output stream into display text.
 *
 * The server runs each task inside a PTY, so the terminal line discipline
 * translates every `\n` a child writes into `\r\n` (ONLCR), and interactive
 * progress bars write bare `\r` to overwrite the current line. The raw stream
 * is therefore kept intact and rendered here, which keeps chunk boundaries
 * from corrupting the result:
 *
 *   - `\n` ends a line.
 *   - `\r` returns the cursor to the start of the line; whatever follows
 *     overwrites it. Only the text written after the final `\r` on a line is
 *     visible, but a trailing `\r` with nothing after it leaves the line as-is
 *     (so `foo\r\n` stays `foo` instead of becoming empty).
 */
export function renderTerminalOutput(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      const segments = line.split('\r')
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].length > 0) return segments[i]
      }
      return ''
    })
    .join('\n')
}

/** A single execution of a task, with the raw stdout/stderr it produced. */
export interface TerminalRun {
  startedAt: number
  raw: string
}

/**
 * A task's terminal history: one entry per run, oldest first. Buffers are kept
 * per task node so selecting a different node swaps the view without losing
 * what the previous task printed.
 */
export type TerminalBuffer = TerminalRun[]

/** Begin a new run, appending it after any previous runs. */
export function startRun(buffer: TerminalBuffer, startedAt: number): TerminalBuffer {
  return [...buffer, { startedAt, raw: '' }]
}

/** Append raw output to the most recent run (creating one if needed). */
export function appendTerminalOutput(buffer: TerminalBuffer, output: string): TerminalBuffer {
  if (buffer.length === 0) {
    return [{ startedAt: Date.now(), raw: output }]
  }
  const last = buffer[buffer.length - 1]
  return [...buffer.slice(0, -1), { ...last, raw: last.raw + output }]
}
