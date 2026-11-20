/**
 * Syntax highlighting for the text preview.
 *
 * Uses highlight.js with a narrow, explicitly registered language set so the
 * bundle stays small: config formats plus Python. Everything else falls back to
 * plain text. Highlighting is synchronous and returns HTML already escaped by
 * highlight.js, so it is safe to inject with dangerouslySetInnerHTML.
 */
import hljs from 'highlight.js/lib/core'

import bash from 'highlight.js/lib/languages/bash'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGUAGES = {
  bash,
  dockerfile,
  ini,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
} as const

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language)
}

/** Extension → registered language name. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  bash: 'bash',
  cfg: 'ini',
  conf: 'ini',
  dockerfile: 'dockerfile',
  ini: 'ini',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  pyi: 'python',
  sql: 'sql',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

/** Exact basenames that have no useful extension. */
const BASENAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  '.env': 'bash',
  pipfile: 'ini',
  'requirements.txt': 'ini',
}

/** Resolve the highlight.js language for a file path, or null for plain text. */
export function languageForPath(path: string): string | null {
  const basename = path.split('/').pop()?.toLowerCase() ?? ''
  if (basename in BASENAME_TO_LANGUAGE) return BASENAME_TO_LANGUAGE[basename]
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return null
  return EXTENSION_TO_LANGUAGE[basename.slice(dot + 1)] ?? null
}

/**
 * Highlight a source string. Returns escaped HTML; when the language is unknown
 * or highlighting fails, the text is HTML-escaped and returned unchanged.
 */
export function highlightCode(code: string, language: string | null): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    } catch {
      // Fall through to escaped plain text.
    }
  }
  return escapeHtml(code)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
