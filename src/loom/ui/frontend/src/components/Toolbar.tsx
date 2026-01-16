import RunControls from './RunControls'
import type { ExecutionStatus, RunMode } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'

interface ToolbarProps {
  configPath: string | null
  onSave: () => void
  onExport: () => void
  saving: boolean
  hasChanges: boolean
  selectedStepName: string | null
  selectedStepNames: string[]
  executionStatus: ExecutionStatus
  onRun: (mode: RunMode, stepName?: string, variableName?: string, stepNames?: string[]) => void
  onRunStep?: (stepName: string) => void  // Independent step execution
  onToggleTerminal: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  skipSaveConfirmation: boolean
  onSkipSaveConfirmationChange: (value: boolean) => void
  stepEligibility?: RunEligibility
  parallelEligibility?: RunEligibility
}

export default function Toolbar({
  configPath,
  onSave,
  onExport,
  saving,
  hasChanges,
  selectedStepName,
  selectedStepNames,
  executionStatus,
  onRun,
  onRunStep,
  onToggleTerminal,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  skipSaveConfirmation,
  onSkipSaveConfirmationChange,
  stepEligibility,
  parallelEligibility,
}: ToolbarProps) {
  return (
    <div className="h-12 bg-slate-900 border-b border-slate-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="w-6 h-6">
            <ellipse cx="16" cy="16" rx="14" ry="10" fill="none" stroke="#3b82f6" strokeWidth="2"/>
            <circle cx="16" cy="16" r="6" fill="#3b82f6"/>
            <circle cx="16" cy="16" r="3" fill="#0f172a"/>
            <circle cx="14" cy="14" r="1.5" fill="#60a5fa"/>
            <circle cx="4" cy="16" r="2" fill="#22c55e"/>
            <circle cx="28" cy="16" r="2" fill="#22c55e"/>
          </svg>
          <h1 className="text-white font-semibold">Loom</h1>
        </div>
        {configPath && (
          <span className="text-slate-400 text-sm">
            {configPath}
            {hasChanges && <span className="text-yellow-500 ml-1">*</span>}
          </span>
        )}
        {!configPath && (
          <span className="text-slate-500 text-sm italic">New pipeline</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Run controls */}
        <RunControls
          selectedStepName={selectedStepName}
          selectedStepNames={selectedStepNames}
          status={executionStatus}
          onRun={onRun}
          onRunStep={onRunStep}
          stepEligibility={stepEligibility}
          parallelEligibility={parallelEligibility}
        />

        {/* Divider */}
        <div className="w-px h-6 bg-slate-700" />

        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`
              px-2 py-1.5 text-white text-sm rounded transition-colors
              ${canUndo
                ? 'bg-slate-700 hover:bg-slate-600'
                : 'bg-slate-800 cursor-not-allowed opacity-50'}
            `}
            title="Undo (Cmd+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`
              px-2 py-1.5 text-white text-sm rounded transition-colors
              ${canRedo
                ? 'bg-slate-700 hover:bg-slate-600'
                : 'bg-slate-800 cursor-not-allowed opacity-50'}
            `}
            title="Redo (Cmd+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-700" />

        {/* Terminal toggle */}
        <button
          onClick={onToggleTerminal}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
        >
          Terminal
        </button>

        <button
          onClick={onExport}
          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
        >
          Export YAML
        </button>

        {/* Skip confirmation checkbox */}
        <label className="flex items-center gap-1.5 text-slate-400 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipSaveConfirmation}
            onChange={(e) => onSkipSaveConfirmationChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          Auto-save
        </label>

        <button
          onClick={onSave}
          disabled={saving || !configPath}
          className={`
            px-4 py-1.5 text-white text-sm rounded transition-colors
            ${saving || !configPath
              ? 'bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-blue-600 hover:bg-blue-500'}
          `}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
