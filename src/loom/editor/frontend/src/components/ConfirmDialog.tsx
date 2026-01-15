interface ConfirmDialogProps {
  title: string
  message: string
  onYes: () => void
  onNo: () => void
  onYesAndRemember: () => void
}

export default function ConfirmDialog({
  title,
  message,
  onYes,
  onNo,
  onYesAndRemember,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onNo}
      />

      {/* Dialog */}
      <div className="relative bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
        <p className="text-slate-300 mb-6">{message}</p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onNo}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
          >
            No
          </button>
          <button
            onClick={onYes}
            className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
          >
            Yes
          </button>
          <button
            onClick={onYesAndRemember}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Yes, and remember
          </button>
        </div>
      </div>
    </div>
  )
}
