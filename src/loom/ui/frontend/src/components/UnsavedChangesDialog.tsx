import { AlertTriangle } from 'lucide-react'

interface UnsavedChangesDialogProps {
  pipelineName: string
  onSave: () => void
  onDontSave: () => void
  onCancel: () => void
}

export default function UnsavedChangesDialog({
  pipelineName,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg shadow-xl border border-slate-700 max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-amber-500/20 rounded-full">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Unsaved Changes
              </h3>
              <p className="text-slate-300 text-sm">
                You have unsaved changes in the current pipeline. Would you like to save them before opening{' '}
                <span className="font-medium text-white">{pipelineName}</span>?
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-900/50 rounded-b-lg flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDontSave}
            className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
          >
            Don't Save
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
