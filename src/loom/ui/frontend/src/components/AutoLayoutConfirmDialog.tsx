import { AlertTriangle } from 'lucide-react'

interface AutoLayoutConfirmDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export default function AutoLayoutConfirmDialog({ onConfirm, onCancel }: AutoLayoutConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-700 p-6 max-w-md w-full mx-4">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Apply Auto-Layout</h2>
        </div>

        <p className="text-slate-600 dark:text-slate-300 mb-6">
          This will re-arrange all nodes and clear saved positions from the pipeline file.
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
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Apply &amp; Save
          </button>
        </div>
      </div>
    </div>
  )
}
