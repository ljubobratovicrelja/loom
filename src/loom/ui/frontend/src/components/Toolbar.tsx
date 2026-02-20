import { Eye, EyeOff, LayoutGrid } from 'lucide-react'
import RunControls from './RunControls'
import type { ExecutionStatus, RunMode } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'

interface ToolbarProps {
  configPath: string | null
  onSave: () => void
  onExport: () => void
  onClean: () => void
  saving: boolean
  hasChanges: boolean
  selectedStepName: string | null
  selectedStepNames: string[]
  executionStatus: ExecutionStatus
  onRun: (mode: RunMode, stepName?: string, variableName?: string, stepNames?: string[], groupName?: string) => void
  onRunStep?: (stepName: string) => void  // Independent step execution
  onToggleTerminal: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  showParameterNodes: boolean
  onToggleParameterNodes: () => void
  onAutoLayout: () => void
  skipSaveConfirmation: boolean
  onSkipSaveConfirmationChange: (value: boolean) => void
  parallelEnabled: boolean
  onParallelEnabledChange: (value: boolean) => void
  maxWorkers: number | null
  onMaxWorkersChange: (value: number | null) => void
  stepEligibility?: RunEligibility
  parallelEligibility?: RunEligibility
  groupEligibility?: RunEligibility
  detectedGroupName?: string | null
}

export default function Toolbar({
  configPath,
  onSave,
  onExport,
  onClean,
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
  showParameterNodes,
  onToggleParameterNodes,
  onAutoLayout,
  skipSaveConfirmation,
  onSkipSaveConfirmationChange,
  parallelEnabled,
  onParallelEnabledChange,
  maxWorkers,
  onMaxWorkersChange,
  stepEligibility,
  parallelEligibility,
  groupEligibility,
  detectedGroupName,
}: ToolbarProps) {
  return (
    <div className="h-12 bg-slate-100 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="w-6 h-6">
            <ellipse cx="16" cy="16" rx="14" ry="10" fill="none" stroke="#3b82f6" strokeWidth="2"/>
            <circle cx="16" cy="16" r="6" fill="#3b82f6"/>
            <circle cx="16" cy="16" r="3" className="fill-slate-100 dark:fill-slate-900"/>
            <circle cx="14" cy="14" r="1.5" fill="#60a5fa"/>
            <circle cx="4" cy="16" r="2" fill="#22c55e"/>
            <circle cx="28" cy="16" r="2" fill="#22c55e"/>
          </svg>
          <h1 className="text-slate-900 dark:text-white font-semibold">Loom</h1>
        </div>
        {configPath && (
          <span className="text-slate-500 dark:text-slate-400 text-sm">
            {configPath}
            {hasChanges && <span className="text-yellow-500 ml-1">*</span>}
          </span>
        )}
        {!configPath && (
          <span className="text-slate-400 dark:text-slate-500 text-sm italic">New pipeline</span>
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
          groupEligibility={groupEligibility}
          detectedGroupName={detectedGroupName}
        />

        {/* Divider */}
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />

        {/* Undo/Redo buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`
              px-2 py-1.5 text-slate-700 dark:text-white text-sm rounded transition-colors
              ${canUndo
                ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
                : 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed opacity-50'}
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
              px-2 py-1.5 text-slate-700 dark:text-white text-sm rounded transition-colors
              ${canRedo
                ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
                : 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed opacity-50'}
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
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />

        {/* Parameter nodes toggle */}
        <button
          onClick={onToggleParameterNodes}
          className={`
            px-2 py-1.5 text-sm rounded transition-colors
            ${showParameterNodes
              ? 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white'
              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500'}
          `}
          title="Toggle parameter nodes (P)"
        >
          {showParameterNodes
            ? <Eye className="w-4 h-4" />
            : <EyeOff className="w-4 h-4" />
          }
        </button>

        {/* Auto-layout button */}
        <button
          onClick={onAutoLayout}
          className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-sm rounded transition-colors"
          title="Auto-layout (Ctrl+Shift+L)"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />

        {/* Terminal toggle */}
        <button
          onClick={onToggleTerminal}
          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-sm rounded transition-colors"
        >
          Terminal
        </button>

        <button
          onClick={onClean}
          disabled={!configPath}
          className={`
            px-4 py-1.5 text-white text-sm rounded transition-colors
            ${!configPath
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-orange-600 hover:bg-orange-500'}
          `}
        >
          Clean Data
        </button>

        <button
          onClick={onExport}
          className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-sm rounded transition-colors"
        >
          Export YAML
        </button>

        {/* Execution settings */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={parallelEnabled}
              onChange={(e) => onParallelEnabledChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            Parallel
          </label>
          {parallelEnabled && (
            <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-sm select-none">
              <span>Workers:</span>
              <input
                type="number"
                min="1"
                max="32"
                value={maxWorkers ?? ''}
                placeholder="auto"
                onChange={(e) => {
                  const val = e.target.value
                  onMaxWorkersChange(val === '' ? null : parseInt(val, 10))
                }}
                className="w-16 px-1.5 py-0.5 text-sm rounded border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>
          )}
        </div>

        {/* Skip confirmation checkbox */}
        <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipSaveConfirmation}
            onChange={(e) => onSkipSaveConfirmationChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          Auto-save
        </label>

        <button
          onClick={onSave}
          disabled={saving || !configPath}
          className={`
            px-4 py-1.5 text-white text-sm rounded transition-colors
            ${saving || !configPath
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-blue-600 hover:bg-blue-500'}
          `}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
