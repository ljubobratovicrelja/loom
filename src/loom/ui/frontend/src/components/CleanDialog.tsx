import type { CleanPreview } from '../types/pipeline'

interface CleanDialogProps {
  preview: CleanPreview
  loading: boolean
  onCancel: () => void
  onClean: (mode: 'trash' | 'permanent') => void
}

export default function CleanDialog({
  preview,
  loading,
  onCancel,
  onClean,
}: CleanDialogProps) {
  const existingPaths = preview.paths.filter((p) => p.exists)
  const hasFilesToClean = existingPaths.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-white mb-2">Clean Pipeline Data</h2>

        {hasFilesToClean ? (
          <>
            <p className="text-slate-300 mb-4">
              The following files will be removed:
            </p>

            {/* File list */}
            <div className="bg-slate-900 rounded border border-slate-700 max-h-60 overflow-y-auto mb-4">
              {existingPaths.map((item) => (
                <div
                  key={item.name}
                  className="px-3 py-2 border-b border-slate-700 last:border-b-0"
                >
                  <div className="text-sm text-slate-200 font-medium">{item.name}</div>
                  <div className="text-xs text-slate-400 truncate" title={item.path}>
                    {item.path}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-slate-400 text-sm mb-6">
              {existingPaths.length} file{existingPaths.length !== 1 ? 's' : ''} will be affected.
            </p>
          </>
        ) : (
          <p className="text-slate-400 mb-6">
            No data files to clean. All data nodes are already empty.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          {hasFilesToClean && (
            <>
              <button
                onClick={() => onClean('permanent')}
                disabled={loading}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Deleting...' : 'Delete Permanently'}
              </button>
              <button
                onClick={() => onClean('trash')}
                disabled={loading}
                className="px-4 py-2 text-sm bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors disabled:opacity-50"
              >
                {loading ? 'Moving...' : 'Move to Trash'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
