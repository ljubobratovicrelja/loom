import { describe, expect, it } from 'vitest'

import { highlightCode, languageForPath } from './highlight'

describe('languageForPath', () => {
  it('maps config and source extensions to registered languages', () => {
    expect(languageForPath('pipeline.yml')).toBe('yaml')
    expect(languageForPath('config.yaml')).toBe('yaml')
    expect(languageForPath('pyproject.toml')).toBe('ini')
    expect(languageForPath('setup.cfg')).toBe('ini')
    expect(languageForPath('task.py')).toBe('python')
    expect(languageForPath('data.json')).toBe('json')
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('run.sh')).toBe(null)
  })

  it('is case-insensitive and handles nested paths', () => {
    expect(languageForPath('data/Sub/Config.YAML')).toBe('yaml')
    expect(languageForPath('src/loom/tasks/Process.PY')).toBe('python')
  })

  it('returns null for unknown or extensionless files', () => {
    expect(languageForPath('notes.txt')).toBe(null)
    expect(languageForPath('README')).toBe(null)
    expect(languageForPath('archive.tar.gz')).toBe(null)
  })
})

describe('highlightCode', () => {
  it('emits markup for a known language', () => {
    const html = highlightCode('key: 42\n', 'yaml')
    expect(html).toContain('hljs-')
  })

  it('escapes HTML for unknown languages', () => {
    expect(highlightCode('<script>alert(1)</script>', null)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('escapes HTML even when highlighting fails', () => {
    const html = highlightCode('<b>not code</b>', 'yaml')
    expect(html).not.toContain('<b>')
  })
})
