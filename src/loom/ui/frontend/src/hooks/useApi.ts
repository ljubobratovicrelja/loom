import { useState, useCallback, useRef, useEffect } from 'react'
import type { PipelineGraph, EditorState, TaskInfo, ValidationResult, CleanPreview, CleanResult, PipelineInfo } from '../types/pipeline'

const API_BASE = '/api'

/**
 * Helper to check if an error is an AbortError.
 */
function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true
  if (e instanceof Error && e.name === 'AbortError') return true
  return false
}

export function useApi() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track abort controllers for each operation type
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  // Cleanup function to abort all pending requests on unmount
  useEffect(() => {
    const controllers = abortControllers.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
    }
  }, [])

  /**
   * Creates or replaces an AbortController for the given operation.
   * Aborts any previous request with the same operation key.
   */
  const getSignal = useCallback((operationKey: string): AbortSignal => {
    // Abort any existing request for this operation
    const existing = abortControllers.current.get(operationKey)
    if (existing) {
      existing.abort()
    }
    // Create new controller
    const controller = new AbortController()
    abortControllers.current.set(operationKey, controller)
    return controller.signal
  }, [])

  /**
   * Cleans up the abort controller for the given operation.
   */
  const cleanupSignal = useCallback((operationKey: string): void => {
    abortControllers.current.delete(operationKey)
  }, [])

  const loadConfig = useCallback(async (path?: string): Promise<PipelineGraph | null> => {
    setLoading(true)
    setError(null)
    const signal = getSignal('loadConfig')
    try {
      const url = path ? `${API_BASE}/config?path=${encodeURIComponent(path)}` : `${API_BASE}/config`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`Failed to load: ${res.statusText}`)
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return null // Request was cancelled
      }
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      cleanupSignal('loadConfig')
      setLoading(false)
    }
  }, [getSignal, cleanupSignal])

  const saveConfig = useCallback(async (graph: PipelineGraph, path?: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    const signal = getSignal('saveConfig')
    try {
      const url = path ? `${API_BASE}/config?path=${encodeURIComponent(path)}` : `${API_BASE}/config`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graph),
        signal,
      })
      if (!res.ok) throw new Error(`Failed to save: ${res.statusText}`)
      return true
    } catch (e) {
      if (isAbortError(e)) {
        return false // Request was cancelled
      }
      setError(e instanceof Error ? e.message : 'Unknown error')
      return false
    } finally {
      cleanupSignal('saveConfig')
      setLoading(false)
    }
  }, [getSignal, cleanupSignal])

  const loadState = useCallback(async (): Promise<EditorState | null> => {
    const signal = getSignal('loadState')
    try {
      const res = await fetch(`${API_BASE}/state`, { signal })
      if (!res.ok) return null
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return null
      }
      return null
    } finally {
      cleanupSignal('loadState')
    }
  }, [getSignal, cleanupSignal])

  const loadTasks = useCallback(async (): Promise<TaskInfo[]> => {
    const signal = getSignal('loadTasks')
    try {
      const res = await fetch(`${API_BASE}/tasks`, { signal })
      if (!res.ok) return []
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return []
      }
      return []
    } finally {
      cleanupSignal('loadTasks')
    }
  }, [getSignal, cleanupSignal])

  const loadDataStatus = useCallback(async (): Promise<Record<string, boolean>> => {
    const signal = getSignal('loadDataStatus')
    try {
      const res = await fetch(`${API_BASE}/data/status`, { signal })
      if (!res.ok) return {}
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return {}
      }
      return {}
    } finally {
      cleanupSignal('loadDataStatus')
    }
  }, [getSignal, cleanupSignal])

  const trashData = useCallback(async (name: string): Promise<{ success: boolean; message: string }> => {
    const signal = getSignal(`trashData_${name}`)
    try {
      const res = await fetch(`${API_BASE}/data/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        signal,
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, message: data.detail || 'Failed to trash data' }
      }
      return { success: true, message: data.message || 'Moved to trash' }
    } catch (e) {
      if (isAbortError(e)) {
        return { success: false, message: 'Request cancelled' }
      }
      return { success: false, message: e instanceof Error ? e.message : 'Unknown error' }
    } finally {
      cleanupSignal(`trashData_${name}`)
    }
  }, [getSignal, cleanupSignal])

  const openPath = useCallback(async (path: string): Promise<boolean> => {
    const signal = getSignal('openPath')
    try {
      const res = await fetch(`${API_BASE}/open-path?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        signal,
      })
      return res.ok
    } catch (e) {
      if (isAbortError(e)) {
        return false
      }
      return false
    } finally {
      cleanupSignal('openPath')
    }
  }, [getSignal, cleanupSignal])

  const validateConfig = useCallback(async (path?: string): Promise<ValidationResult> => {
    const signal = getSignal('validateConfig')
    try {
      const url = path
        ? `${API_BASE}/config/validate?path=${encodeURIComponent(path)}`
        : `${API_BASE}/config/validate`
      const res = await fetch(url, { signal })
      if (!res.ok) return { warnings: [] }
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return { warnings: [] }
      }
      return { warnings: [] }
    } finally {
      cleanupSignal('validateConfig')
    }
  }, [getSignal, cleanupSignal])

  const previewClean = useCallback(async (): Promise<CleanPreview | null> => {
    const signal = getSignal('previewClean')
    try {
      const res = await fetch(`${API_BASE}/clean/preview`, { signal })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to preview clean')
      }
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return null
      }
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      cleanupSignal('previewClean')
    }
  }, [getSignal, cleanupSignal])

  const cleanAllData = useCallback(async (
    mode: 'trash' | 'permanent',
    includeThumbnails: boolean = true
  ): Promise<CleanResult | null> => {
    const signal = getSignal('cleanAllData')
    try {
      const url = `${API_BASE}/clean?mode=${encodeURIComponent(mode)}&include_thumbnails=${includeThumbnails}`
      const res = await fetch(url, {
        method: 'POST',
        signal,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to clean data')
      }
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return null
      }
      setError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      cleanupSignal('cleanAllData')
    }
  }, [getSignal, cleanupSignal])

  const listPipelines = useCallback(async (): Promise<PipelineInfo[]> => {
    const signal = getSignal('listPipelines')
    try {
      const res = await fetch(`${API_BASE}/pipelines`, { signal })
      if (!res.ok) return []
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return []
      }
      return []
    } finally {
      cleanupSignal('listPipelines')
    }
  }, [getSignal, cleanupSignal])

  const openPipeline = useCallback(async (path: string): Promise<{ success: boolean; configPath?: string; tasksDir?: string; error?: string }> => {
    const signal = getSignal('openPipeline')
    try {
      const res = await fetch(`${API_BASE}/pipelines/open?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        signal,
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.detail || 'Failed to open pipeline' }
      }
      return { success: true, configPath: data.configPath, tasksDir: data.tasksDir }
    } catch (e) {
      if (isAbortError(e)) {
        return { success: false, error: 'Request cancelled' }
      }
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    } finally {
      cleanupSignal('openPipeline')
    }
  }, [getSignal, cleanupSignal])

  const checkPath = useCallback(async (path: string): Promise<{ exists: boolean; resolved_path: string | null }> => {
    const signal = getSignal('checkPath')
    try {
      const res = await fetch(`${API_BASE}/check-path?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        signal,
      })
      if (!res.ok) {
        return { exists: false, resolved_path: null }
      }
      return await res.json()
    } catch (e) {
      if (isAbortError(e)) {
        return { exists: false, resolved_path: null }
      }
      return { exists: false, resolved_path: null }
    } finally {
      cleanupSignal('checkPath')
    }
  }, [getSignal, cleanupSignal])

  return { loadConfig, saveConfig, loadState, loadTasks, loadDataStatus, trashData, openPath, validateConfig, previewClean, cleanAllData, listPipelines, openPipeline, checkPath, loading, error }
}
