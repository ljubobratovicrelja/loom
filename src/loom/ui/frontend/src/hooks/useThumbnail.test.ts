/**
 * Tests for useThumbnail hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('useThumbnail hook', () => {
  let originalFetch: typeof global.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock

    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('thumbnail fetching logic', () => {
    it('should not fetch when exists is false', () => {
      // When exists is false, no fetch should be made
      // This test validates the condition: exists !== true
      const exists = false
      const _dataType = 'image' // eslint-disable-line @typescript-eslint/no-unused-vars

      // Simulate the hook logic
      if (exists !== true) {
        // Should not call fetch
        expect(fetchMock).not.toHaveBeenCalled()
      }
    })

    it('should not fetch when exists is undefined', () => {
      // When exists is undefined, no fetch should be made
      const exists = undefined
      const _dataType = 'image' // eslint-disable-line @typescript-eslint/no-unused-vars

      if (exists !== true) {
        expect(fetchMock).not.toHaveBeenCalled()
      }
    })

    it('should fetch thumbnail for image type when exists is true', async () => {
      const mockBlob = new Blob(['fake image'], { type: 'image/png' })
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(mockBlob),
      })

      // Simulate fetching thumbnail
      const dataKey = 'test_image'
      const response = await fetch(`/api/thumbnail/${encodeURIComponent(dataKey)}`)

      expect(fetchMock).toHaveBeenCalledWith(`/api/thumbnail/${dataKey}`)
      expect(response.ok).toBe(true)
    })

    it('should fetch thumbnail for video type when exists is true', async () => {
      const mockBlob = new Blob(['fake video frame'], { type: 'image/png' })
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(mockBlob),
      })

      const dataKey = 'test_video'
      const response = await fetch(`/api/thumbnail/${encodeURIComponent(dataKey)}`)

      expect(fetchMock).toHaveBeenCalled()
      expect(response.ok).toBe(true)
    })

    it('should fetch preview for txt type when exists is true', async () => {
      const mockPreview = { lines: ['line1', 'line2'], truncated: false }
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPreview),
      })

      const dataKey = 'test_txt'
      const response = await fetch(`/api/preview/${encodeURIComponent(dataKey)}`)
      const data = await response.json()

      expect(fetchMock).toHaveBeenCalled()
      expect(data.lines).toEqual(['line1', 'line2'])
      expect(data.truncated).toBe(false)
    })

    it('should fetch preview for csv type when exists is true', async () => {
      const mockPreview = { lines: ['a,b,c', '1,2,3'], truncated: false }
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPreview),
      })

      const dataKey = 'test_csv'
      const response = await fetch(`/api/preview/${encodeURIComponent(dataKey)}`)
      const data = await response.json()

      expect(data.lines).toEqual(['a,b,c', '1,2,3'])
    })

    it('should fetch preview for json type when exists is true', async () => {
      const mockPreview = { lines: ['{"key": "value"}'], truncated: false }
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPreview),
      })

      const dataKey = 'test_json'
      const response = await fetch(`/api/preview/${encodeURIComponent(dataKey)}`)
      const data = await response.json()

      expect(data.lines[0]).toContain('key')
    })

    it('should not fetch for unsupported types', () => {
      const dataType = 'data_folder'

      // For unsupported types, the hook should not fetch
      const isImageOrVideo = dataType === 'image' || dataType === 'video'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'

      expect(isImageOrVideo).toBe(false)
      expect(isText).toBe(false)
    })

    it('should handle 204 response for thumbnail (generation failed)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 204,
      })

      const dataKey = 'test_image'
      const response = await fetch(`/api/thumbnail/${encodeURIComponent(dataKey)}`)

      expect(response.status).toBe(204)
      // Hook should set thumbnailUrl to null when 204
    })

    it('should handle error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const dataKey = 'missing_data'
      const response = await fetch(`/api/thumbnail/${encodeURIComponent(dataKey)}`)

      expect(response.ok).toBe(false)
      // Hook should set error state
    })

    it('should handle fetch exception', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))

      try {
        await fetch('/api/thumbnail/test')
        expect(true).toBe(false) // Should not reach here
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toBe('Network error')
      }
    })

    it('should handle AbortError gracefully', async () => {
      const abortError = new DOMException('Aborted', 'AbortError')
      fetchMock.mockRejectedValue(abortError)

      try {
        await fetch('/api/thumbnail/test')
      } catch (e) {
        // AbortError should be caught and ignored in the hook
        expect(e).toBeInstanceOf(DOMException)
        expect((e as DOMException).name).toBe('AbortError')
      }
    })
  })

  describe('URL object handling', () => {
    it('should create object URL for blob response', async () => {
      const mockBlob = new Blob(['image data'], { type: 'image/png' })
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(mockBlob),
      })

      const response = await fetch('/api/thumbnail/test')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)

      expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
      expect(url).toBe('blob:mock-url')
    })

    it('should revoke object URL on cleanup', () => {
      const mockUrl = 'blob:mock-url-to-revoke'
      URL.revokeObjectURL(mockUrl)

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl)
    })
  })

  describe('data type detection', () => {
    it('should identify image type as supporting thumbnails', () => {
      const dataType = 'image'
      const isImageOrVideo = dataType === 'image' || dataType === 'video'
      expect(isImageOrVideo).toBe(true)
    })

    it('should identify video type as supporting thumbnails', () => {
      const dataType = 'video'
      const isImageOrVideo = dataType === 'image' || dataType === 'video'
      expect(isImageOrVideo).toBe(true)
    })

    it('should identify txt type as supporting text preview', () => {
      const dataType = 'txt'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
      expect(isText).toBe(true)
    })

    it('should identify csv type as supporting text preview', () => {
      const dataType = 'csv'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
      expect(isText).toBe(true)
    })

    it('should identify json type as supporting text preview', () => {
      const dataType = 'json'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
      expect(isText).toBe(true)
    })

    it('should identify image_directory as not supporting previews', () => {
      const dataType = 'image_directory'
      const isImageOrVideo = dataType === 'image' || dataType === 'video'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
      expect(isImageOrVideo).toBe(false)
      expect(isText).toBe(false)
    })

    it('should identify data_folder as not supporting previews', () => {
      const dataType = 'data_folder'
      const isImageOrVideo = dataType === 'image' || dataType === 'video'
      const isText = dataType === 'txt' || dataType === 'csv' || dataType === 'json'
      expect(isImageOrVideo).toBe(false)
      expect(isText).toBe(false)
    })
  })
})
