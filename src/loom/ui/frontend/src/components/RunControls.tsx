import type { ExecutionStatus, RunMode } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'
import { getBlockReasonMessage } from '../hooks/useRunEligibility'

interface RunControlsProps {
  selectedStepName: string | null
  selectedStepNames: string[]
  status: ExecutionStatus
  onRun: (mode: RunMode, stepName?: string, variableName?: string, stepNames?: string[], groupName?: string) => void
  onRunStep?: (stepName: string) => void  // Independent step execution
  stepEligibility?: RunEligibility
  parallelEligibility?: RunEligibility
  groupEligibility?: RunEligibility
  detectedGroupName?: string | null
}

export default function RunControls({
  selectedStepName,
  selectedStepNames,
  status,
  onRun,
  onRunStep,
  stepEligibility,
  parallelEligibility,
  groupEligibility,
  detectedGroupName,
}: RunControlsProps) {
  const isRunning = status === 'running'

  // Determine if step-specific actions can run
  const canRunStep = stepEligibility?.canRun ?? !isRunning
  const stepBlockReason = stepEligibility ? getBlockReasonMessage(stepEligibility) : null

  // Determine if parallel execution can run
  const canRunParallel = parallelEligibility?.canRun ?? !isRunning
  const parallelBlockReason = parallelEligibility ? getBlockReasonMessage(parallelEligibility) : null

  // Determine if group execution can run (allows in-group deps, orchestrator handles ordering)
  const canRunGroup = groupEligibility?.canRun ?? !isRunning
  const groupBlockReason = groupEligibility ? getBlockReasonMessage(groupEligibility) : null

  return (
    <div className="flex items-center gap-2">
      {/* Run All - uses global running check */}
      <button
        onClick={() => onRun('all')}
        disabled={isRunning}
        className={`
          px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
          ${isRunning
            ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
            : 'bg-green-600 hover:bg-green-500 dark:bg-green-700 dark:hover:bg-green-600'}
        `}
        title="Run entire pipeline"
      >
        <span>&#9654;</span> Run All
      </button>

      {/* Run Group - when selection matches exactly one group */}
      {selectedStepNames.length >= 2 && detectedGroupName && (
        <button
          onClick={() => onRun('group', undefined, undefined, undefined, detectedGroupName)}
          disabled={!canRunGroup}
          className={`
            px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
            ${!canRunGroup
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-teal-600 hover:bg-teal-500'}
          `}
          title={groupBlockReason || `Run all steps in group "${detectedGroupName}"`}
        >
          <span>&#9654;</span> Run {detectedGroupName}
        </button>
      )}

      {/* Run Parallel - when 2+ steps selected and not a group */}
      {selectedStepNames.length >= 2 && !detectedGroupName && (
        <button
          onClick={() => onRun('parallel', undefined, undefined, selectedStepNames)}
          disabled={!canRunParallel}
          className={`
            px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
            ${!canRunParallel
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-amber-600 hover:bg-amber-500'}
          `}
          title={parallelBlockReason || `Run ${selectedStepNames.length} selected steps in parallel`}
        >
          <span>&#8801;</span> Run Parallel ({selectedStepNames.length})
        </button>
      )}

      {/* Run Selected Step - only when exactly 1 step selected */}
      {selectedStepName && (
        <>
          <button
            onClick={() => onRunStep ? onRunStep(selectedStepName) : onRun('step', selectedStepName)}
            disabled={!canRunStep}
            className={`
              px-3 py-1.5 text-white text-sm rounded transition-colors
              ${!canRunStep
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
                : 'bg-blue-600 hover:bg-blue-500 dark:bg-blue-700 dark:hover:bg-blue-600'}
            `}
            title={stepBlockReason || `Run only "${selectedStepName}"`}
          >
            Run Step
          </button>

          <button
            onClick={() => onRun('from_step', selectedStepName)}
            disabled={!canRunStep}
            className={`
              px-3 py-1.5 text-white text-sm rounded transition-colors
              ${!canRunStep
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
                : 'bg-purple-600 hover:bg-purple-500 dark:bg-purple-700 dark:hover:bg-purple-600'}
            `}
            title={stepBlockReason || `Run from "${selectedStepName}" onwards`}
          >
            From Here
          </button>
        </>
      )}

    </div>
  )
}
