import { AlertTriangle } from 'lucide-react'

interface NewFileConfirmDialogProps {
  fileName: string
  directoryKey: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation shown when adding a file that isn't in the directory yet.
 * Loom can't verify that the producing step will create it, so the pipeline
 * connection is only an assumption until the step runs.
 */
export default function NewFileConfirmDialog({
  fileName,
  directoryKey,
  onConfirm,
  onCancel,
}: NewFileConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-700 p-6 max-w-md w-full mx-4">
        <div className="flex items-start gap-3 mb-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-500 mt-0.5" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Add unverified file?
          </h2>
        </div>

        <p className="text-slate-600 dark:text-slate-300 text-sm mb-3">
          <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
            {fileName}
          </code>{' '}
          is not currently in{' '}
          <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
            ${directoryKey}
          </code>
          .
        </p>

        <p className="text-slate-600 dark:text-slate-300 text-sm mb-6">
          Loom cannot confirm the pipeline connectivity, because it does not know whether this file
          will exist in this directory under this name once the producing step has finished. The
          file will be added as an expected output and treated as a dependency.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
          >
            Add file
          </button>
        </div>
      </div>
    </div>
  )
}
