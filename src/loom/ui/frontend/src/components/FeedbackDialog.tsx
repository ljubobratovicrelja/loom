import { useState, useEffect, useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import type { StepData } from '../types/pipeline'

export interface FeedbackResult {
  sourceStepName: string
  sourceOutputFlag: string
  targetStepName: string
  targetInputFlag: string
  conditionScript: string
  dataNodeId: string
}

interface FeedbackDialogProps {
  steps: [StepData, StepData]
  nodes: Node[]
  edges: Edge[]
  existingMultiPass?: Record<string, unknown>
  groupName: string
  onConfirm: (result: FeedbackResult) => void
  onCancel: () => void
}

interface OutputOption {
  stepName: string
  flag: string
}

interface InputOption {
  stepName: string
  flag: string
}

export default function FeedbackDialog({
  steps,
  nodes,
  edges,
  existingMultiPass,
  groupName,
  onConfirm,
  onCancel,
}: FeedbackDialogProps) {
  const [selectedOutput, setSelectedOutput] = useState<OutputOption | null>(null)
  const [selectedInput, setSelectedInput] = useState<InputOption | null>(null)

  // Pre-fill condition script from existing config if available
  const existingCondition = existingMultiPass?.condition as Record<string, unknown> | undefined
  const [conditionScript, setConditionScript] = useState(
    (existingCondition?.script as string) || ''
  )

  // Build output options from both steps
  const outputOptions: { stepName: string; flags: string[] }[] = steps.map((step) => ({
    stepName: step.name,
    flags: Object.keys(step.outputs || {}),
  }))

  // Build input options: file inputs + args from both steps
  const inputOptions: { stepName: string; flags: string[] }[] = steps.map((step) => ({
    stepName: step.name,
    flags: [
      ...Object.keys(step.inputs || {}),
      ...Object.keys(step.args || {}),
    ],
  }))

  const canCreate = selectedOutput !== null && selectedInput !== null

  const handleCreate = useCallback(() => {
    if (!selectedOutput || !selectedInput) return

    // Walk edges to find the data node produced by the source output
    const sourceStepNode = nodes.find(
      (n) => n.type === 'step' && (n.data as StepData).name === selectedOutput.stepName
    )
    if (!sourceStepNode) return

    // Find edge from source step output to a data node
    const dataEdge = edges.find(
      (e) => e.source === sourceStepNode.id && e.sourceHandle === selectedOutput.flag && e.target.startsWith('data_')
    )
    if (!dataEdge) {
      alert(`No data node found for output ${selectedOutput.flag} of ${selectedOutput.stepName}. The output must be connected to a data node.`)
      return
    }

    onConfirm({
      sourceStepName: selectedOutput.stepName,
      sourceOutputFlag: selectedOutput.flag,
      targetStepName: selectedInput.stepName,
      targetInputFlag: selectedInput.flag,
      conditionScript,
      dataNodeId: dataEdge.target,
    })
  }, [selectedOutput, selectedInput, conditionScript, nodes, edges, onConfirm])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-300 dark:border-slate-700 w-full max-w-lg mx-4">
        {/* Header */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Create Feedback Connection
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Group: <span className="font-mono text-purple-500 dark:text-purple-400">{groupName}</span>
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-2 gap-0 border-t border-b border-slate-200 dark:border-slate-700">
          {/* Left column: outputs */}
          <div className="border-r border-slate-200 dark:border-slate-700 p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              Feed from (output)
            </div>
            <div className="space-y-3">
              {outputOptions.map(({ stepName, flags }) => (
                <div key={stepName}>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {stepName}
                  </div>
                  {flags.length === 0 ? (
                    <div className="text-xs text-slate-400 dark:text-slate-500 italic ml-2">no outputs</div>
                  ) : (
                    flags.map((flag) => {
                      const isSelected =
                        selectedOutput?.stepName === stepName && selectedOutput?.flag === flag
                      return (
                        <button
                          key={flag}
                          onClick={() => setSelectedOutput({ stepName, flag })}
                          className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                            isSelected
                              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-purple-500' : 'border-slate-400 dark:border-slate-500'
                          }`}>
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                          </span>
                          <span className="font-mono text-xs">{flag.replace(/^-+/, '')}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right column: inputs */}
          <div className="p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              Feed into (input)
            </div>
            <div className="space-y-3">
              {inputOptions.map(({ stepName, flags }) => (
                <div key={stepName}>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {stepName}
                  </div>
                  {flags.length === 0 ? (
                    <div className="text-xs text-slate-400 dark:text-slate-500 italic ml-2">no inputs/args</div>
                  ) : (
                    flags.map((flag) => {
                      const isSelected =
                        selectedInput?.stepName === stepName && selectedInput?.flag === flag
                      return (
                        <button
                          key={flag}
                          onClick={() => setSelectedInput({ stepName, flag })}
                          className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                            isSelected
                              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-purple-500' : 'border-slate-400 dark:border-slate-500'
                          }`}>
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                          </span>
                          <span className="font-mono text-xs">{flag.replace(/^-+/, '')}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Condition script */}
        <div className="px-6 py-4">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            Condition script (optional)
          </label>
          <input
            type="text"
            value={conditionScript}
            onChange={(e) => setConditionScript(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            placeholder="conditions/has_converged.py"
          />
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
            Python script with evaluate() function, called after each iteration
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className={`px-4 py-2 text-sm rounded transition-colors ${
              canCreate
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
