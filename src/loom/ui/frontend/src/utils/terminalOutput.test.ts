import { describe, it, expect } from 'vitest'
import {
  appendTerminalOutput,
  renderTerminalOutput,
  startRun,
  type TerminalBuffer,
} from './terminalOutput'

describe('renderTerminalOutput', () => {
  it('preserves normal PTY lines that end in CRLF', () => {
    expect(renderTerminalOutput('hello stdout\r\nerr line\r\n')).toBe('hello stdout\nerr line\n')
  })

  it('preserves bare newlines', () => {
    expect(renderTerminalOutput('hello\nworld\n')).toBe('hello\nworld\n')
  })

  it('collapses a progress bar overwritten with CR on one line', () => {
    expect(renderTerminalOutput('progress 25%\rprogress 50%\rprogress 75%')).toBe('progress 75%')
  })

  it('handles a progress bar terminated by CRLF', () => {
    expect(renderTerminalOutput('progress 25%\rprogress 50%\r\nnext')).toBe('progress 50%\nnext')
  })

  it('handles a trailing progress CR followed by the PTY line-ending CR', () => {
    expect(renderTerminalOutput('progress 25%\rprogress 50%\r\r\nnext')).toBe('progress 50%\nnext')
  })

  it('keeps content before and after a mixed progress block', () => {
    const raw = 'start\r\nprog 1%\rprog 2%\r\r\nend\r\n'
    expect(renderTerminalOutput(raw)).toBe('start\nprog 2%\nend\n')
  })

  it('preserves a trailing newline', () => {
    expect(renderTerminalOutput('done\r\n')).toBe('done\n')
  })

  it('preserves blank lines', () => {
    expect(renderTerminalOutput('a\r\n\r\nb\r\n')).toBe('a\n\nb\n')
  })

  it('keeps stdout and stderr interleaved in order', () => {
    expect(renderTerminalOutput('out 1\r\nerr 1\r\nout 2\r\n')).toBe('out 1\nerr 1\nout 2\n')
  })

  it('keeps a half-written line that has not been terminated yet', () => {
    expect(renderTerminalOutput('partial output')).toBe('partial output')
  })

  it('resolves an overwrite even when it arrives after a trailing CR', () => {
    // Raw stream is stored intact, so a later chunk still overwrites correctly.
    expect(renderTerminalOutput('progress 25%\rprogress 50%')).toBe('progress 50%')
    expect(renderTerminalOutput('progress 25%')).toBe('progress 25%')
  })

  it('renders the full marker/output stream a step produces', () => {
    const raw =
      '\x1b[36m[RUNNING]\x1b[0m Hello\r\n' +
      '  python hello.py --out out.txt\r\n' +
      'line one stdout\r\nline two stderr\r\n' +
      '\rprogress 25%\rprogress 50%\rprogress 75%\r\n' +
      'final line\r\n' +
      '\x1b[32m[SUCCESS]\x1b[0m Hello\r\n'
    const rendered = renderTerminalOutput(raw).replace(/\x1b\[[0-9;]*m/g, '')
    expect(rendered).toContain('[RUNNING] Hello')
    expect(rendered).toContain('line one stdout')
    expect(rendered).toContain('line two stderr')
    expect(rendered).toContain('progress 75%')
    expect(rendered).toContain('final line')
    expect(rendered).toContain('[SUCCESS] Hello')
    expect(rendered).not.toMatch(/^\s*$/)
  })
})

describe('terminal run buffers', () => {
  it('starts with an empty buffer', () => {
    expect(startRun([], 1000)).toEqual([{ startedAt: 1000, raw: '' }])
  })

  it('appends output to the most recent run only', () => {
    let buffer: TerminalBuffer = startRun([], 1000)
    buffer = appendTerminalOutput(buffer, 'first')
    buffer = appendTerminalOutput(buffer, 'second')
    expect(buffer).toEqual([{ startedAt: 1000, raw: 'firstsecond' }])
  })

  it('preserves earlier runs when a new run starts', () => {
    let buffer: TerminalBuffer = startRun([], 1000)
    buffer = appendTerminalOutput(buffer, 'run 1 output')
    buffer = startRun(buffer, 2000)
    buffer = appendTerminalOutput(buffer, 'run 2 output')
    expect(buffer).toEqual([
      { startedAt: 1000, raw: 'run 1 output' },
      { startedAt: 2000, raw: 'run 2 output' },
    ])
  })

  it('creates an implicit run when output arrives without startRun', () => {
    const buffer = appendTerminalOutput([], 'orphan output')
    expect(buffer).toHaveLength(1)
    expect(buffer[0].raw).toBe('orphan output')
  })

  it('does not mutate the input buffer', () => {
    const original: TerminalBuffer = startRun([], 1000)
    const copy = JSON.parse(JSON.stringify(original))
    appendTerminalOutput(original, 'x')
    startRun(original, 2000)
    expect(original).toEqual(copy)
  })
})
