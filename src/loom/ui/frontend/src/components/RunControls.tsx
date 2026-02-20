import { Play, StepForward, ChevronsRight, ChevronsLeft, Columns2 } from 'lucide-react'
import type { ExecutionStatus, RunMode } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'
import { getBlockReasonMessage } from '../hooks/useRunEligibility'

interface RunControlsProps {
  selectedStepName: string | null
  selectedStepNames: string[]
  selectedDataKey: string | null
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
  selectedDataKey,
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

  // "Until Here" is available when a step or data node is selected
  const showUntilHere = selectedStepName || selectedDataKey

  const untilHereTooltip = selectedStepName
    ? `Run all steps leading to "${selectedStepName}"`
    : selectedDataKey
      ? `Run all steps needed to produce "${selectedDataKey}"`
      : ''

  const handleUntilHere = () => {
    if (selectedStepName) {
      onRun('to_step', selectedStepName)
    } else if (selectedDataKey) {
      onRun('to_data', undefined, selectedDataKey)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Run All */}
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
        <Play className="w-3.5 h-3.5" /> Run All
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
          <Play className="w-3.5 h-3.5" /> Run {detectedGroupName}
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
          <Columns2 className="w-3.5 h-3.5" /> Run Parallel ({selectedStepNames.length})
        </button>
      )}

      {/* Run Selected Step - only when exactly 1 step selected */}
      {selectedStepName && (
        <>
          <button
            onClick={() => onRunStep ? onRunStep(selectedStepName) : onRun('step', selectedStepName)}
            disabled={!canRunStep}
            className={`
              px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
              ${!canRunStep
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
                : 'bg-blue-600 hover:bg-blue-500 dark:bg-blue-700 dark:hover:bg-blue-600'}
            `}
            title={stepBlockReason || `Run only "${selectedStepName}"`}
          >
            <StepForward className="w-3.5 h-3.5" /> Run Step
          </button>

          <button
            onClick={() => onRun('from_step', selectedStepName)}
            disabled={!canRunStep}
            className={`
              px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
              ${!canRunStep
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
                : 'bg-purple-600 hover:bg-purple-500 dark:bg-purple-700 dark:hover:bg-purple-600'}
            `}
            title={stepBlockReason || `Run from "${selectedStepName}" to end of pipeline`}
          >
            <ChevronsRight className="w-3.5 h-3.5" /> From Here
          </button>
        </>
      )}

      {/* Until Here - when a step or data node is selected */}
      {showUntilHere && (
        <button
          onClick={handleUntilHere}
          disabled={isRunning}
          className={`
            px-3 py-1.5 text-white text-sm rounded transition-colors flex items-center gap-1.5
            ${isRunning
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : 'bg-cyan-600 hover:bg-cyan-500 dark:bg-cyan-700 dark:hover:bg-cyan-600'}
          `}
          title={untilHereTooltip}
        >
          <ChevronsLeft className="w-3.5 h-3.5" /> Until Here
        </button>
      )}

    </div>
  )
}
