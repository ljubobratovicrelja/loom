import { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

export interface TextPreview {
  lines: string[]
  truncated: boolean
}

export interface ThumbnailState {
  loading: boolean
  thumbnailUrl: string | null
  textPreview: TextPreview | null
  error: string | null
}

/**
 * Hook to fetch thumbnail or text preview for a data node.
 * Only fetches once per unique dataKey when exists is true.
 *
 * @param dataKey - The data node key
 * @param dataType - The data type (image, video, txt, csv, json, etc.)
 * @param exists - Whether the data file exists
 * @param path - The path to the file (used for path-based endpoints when editing)
 * @returns ThumbnailState with loading, thumbnailUrl, textPreview, and error
 */
export function useThumbnail(
  dataKey: string,
  dataType: string,
  exists: boolean | undefined,
  path: string
): ThumbnailState {
  const [state, setState] = useState<ThumbnailState>({
    loading: false,
    thumbnailUrl: null,
    textPreview: null,
    error: null,
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  // Track what we've fetched to avoid re-fetching
  const fetchedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // Cleanup function
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  useEffect(() => {
    // Determine what to fetch based on data type
    const isImageOrVideo = dataType === 'image' || dataType === 'video'
    const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
    const supportsPreview = isImageOrVideo || isText

    // Build a cache key for this request - include path to re-fetch when path changes
    const cacheKey = `${dataKey}:${dataType}:${exists}:${path}`

    // Don't fetch if:
    // - Data doesn't exist
    // - Type doesn't support previews
    // - We already fetched for this exact key
    if (exists !== true || !supportsPreview) {
      // Reset state if exists changed to false
      if (fetchedKeyRef.current !== null && exists !== true) {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current)
          objectUrlRef.current = null
        }
        fetchedKeyRef.current = null
        setState({
          loading: false,
          thumbnailUrl: null,
          textPreview: null,
          error: null,
        })
      }
      return
    }

    // Already fetched for this key - skip
    if (fetchedKeyRef.current === cacheKey) {
      return
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    // Clean up old object URL before fetching new one
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    const fetchData = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }))

      try {
        if (isImageOrVideo) {
          // Fetch thumbnail using path-based endpoint (works without saving config)
          const response = await fetch(
            `${API_BASE}/thumbnail/by-path?path=${encodeURIComponent(path)}&type=${encodeURIComponent(dataType)}`,
            { signal: abortControllerRef.current!.signal }
          )

          if (response.status === 204) {
            // No content - thumbnail generation failed
            fetchedKeyRef.current = cacheKey
            setState({
              loading: false,
              thumbnailUrl: null,
              textPreview: null,
              error: null,
            })
            return
          }

          if (!response.ok) {
            throw new Error(`Failed to fetch thumbnail: ${response.statusText}`)
          }

          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          objectUrlRef.current = url
          fetchedKeyRef.current = cacheKey

          setState({
            loading: false,
            thumbnailUrl: url,
            textPreview: null,
            error: null,
          })
        } else {
          // Fetch text preview using path-based endpoint (works without saving config)
          const response = await fetch(
            `${API_BASE}/preview/by-path?path=${encodeURIComponent(path)}&type=${encodeURIComponent(dataType)}`,
            { signal: abortControllerRef.current!.signal }
          )

          if (!response.ok) {
            throw new Error(`Failed to fetch preview: ${response.statusText}`)
          }

          const preview: TextPreview = await response.json()
          fetchedKeyRef.current = cacheKey

          setState({
            loading: false,
            thumbnailUrl: null,
            textPreview: preview,
            error: null,
          })
        }
      } catch (e) {
        // Ignore abort errors
        if (e instanceof DOMException && e.name === 'AbortError') {
          return
        }
        if (e instanceof Error && e.name === 'AbortError') {
          return
        }

        fetchedKeyRef.current = cacheKey // Mark as fetched even on error to avoid retrying
        setState({
          loading: false,
          thumbnailUrl: null,
          textPreview: null,
          error: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    }

    fetchData()
  }, [dataKey, dataType, exists, path])

  return state
}
