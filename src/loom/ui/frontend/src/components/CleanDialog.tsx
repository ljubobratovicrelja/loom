import type { CleanPreview, CleanPreviewPath } from '../types/pipeline'

interface CleanDialogProps {
  preview: CleanPreview
  loading: boolean
  onCancel: () => void
  onClean: (mode: 'trash' | 'permanent') => void
}

export default function CleanDialog({ preview, loading, onCancel, onClean }: CleanDialogProps) {
  const existingPaths = preview.paths.filter((p) => p.exists)
  const outputRoot = preview.output_root ?? null
  const hasFilesToClean = existingPaths.length > 0 || outputRoot !== null

  const renderPath = (item: CleanPreviewPath, label?: string) => (
    <div
      key={label ?? item.name}
      className="px-3 py-2 border-b border-slate-300 dark:border-slate-700 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">
          {label ?? item.name}
        </span>
        {item.is_dir && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            directory · {item.entry_count ?? 0} file{(item.entry_count ?? 0) !== 1 ? 's' : ''}
          </span>
        )}
        {item.inside_pipeline === false && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
            outside pipeline
          </span>
        )}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={item.path}>
        {item.path}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-700 p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Clean Pipeline Data
        </h2>

        {hasFilesToClean ? (
          <>
            <p className="text-slate-600 dark:text-slate-300 mb-4">
              The following paths will be removed. Directories are deleted entirely.
            </p>

            {/* File list */}
            <div className="bg-slate-100 dark:bg-slate-900 rounded border border-slate-300 dark:border-slate-700 max-h-60 overflow-y-auto mb-4">
              {existingPaths.map((item) => renderPath(item))}
              {outputRoot && renderPath(outputRoot, `${outputRoot.name}/ (owned output tree)`)}
            </div>

            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              {existingPaths.length} data path{existingPaths.length !== 1 ? 's' : ''}
              {outputRoot ? ' plus the owned output tree' : ''} will be affected.
            </p>
          </>
        ) : (
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            No data files to clean. All data nodes are already empty.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
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
