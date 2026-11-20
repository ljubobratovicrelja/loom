import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Node } from '@xyflow/react'

import PropertiesPanel from './PropertiesPanel'
import type { StepData, StepExecutionState } from '../types/pipeline'
import type { RunEligibility } from '../hooks/useRunEligibility'

const stepNode: Node = {
  id: 'extract',
  type: 'step',
  position: { x: 0, y: 0 },
  data: {
    name: 'extract',
    task: 'tasks/extract.py',
    inputs: {},
    outputs: {},
    args: {},
    optional: false,
  } satisfies StepData,
}

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled

interface RenderOptions {
  status?: StepExecutionState
  eligibility?: RunEligibility
}

function renderPanel({ status = 'idle', eligibility }: RenderOptions = {}) {
  const onRunStep = vi.fn()
  const onCancelStep = vi.fn()

  render(
    <PropertiesPanel
      selectedNode={stepNode}
      edges={[]}
      onUpdateNode={vi.fn()}
      onDeleteNode={vi.fn()}
      onRunStep={onRunStep}
      onCancelStep={onCancelStep}
      getStepStatus={() => status}
      parameters={{}}
      tasks={[]}
      runEligibility={eligibility}
    />,
  )

  return {
    onRunStep,
    onCancelStep,
    runButton: screen.getByRole('button', { name: /Run This Step/i }),
    stopButton: screen.getByRole('button', { name: /Stop This Step/i }),
  }
}

describe('PropertiesPanel execution controls', () => {
  it('enables Run This Step and disables Stop This Step while idle', () => {
    const { runButton, stopButton } = renderPanel()

    expect(isDisabled(runButton)).toBe(false)
    expect(isDisabled(stopButton)).toBe(true)
  })

  it('disables Run This Step and enables Stop This Step while running', () => {
    const { runButton, stopButton } = renderPanel({ status: 'running' })

    expect(isDisabled(runButton)).toBe(true)
    expect(isDisabled(stopButton)).toBe(false)
  })

  it('calls onCancelStep when Stop This Step is clicked', () => {
    const { onCancelStep, stopButton } = renderPanel({ status: 'running' })

    fireEvent.click(stopButton)

    expect(onCancelStep).toHaveBeenCalledWith('extract')
  })

  it('calls onRunStep when Run This Step is clicked', () => {
    const { onRunStep, runButton } = renderPanel()

    fireEvent.click(runButton)

    expect(onRunStep).toHaveBeenCalledWith('extract')
  })

  it('keeps Run This Step disabled when eligibility blocks it', () => {
    const { runButton, stopButton } = renderPanel({
      eligibility: { canRun: false, reason: 'upstream_running', blockedBy: ['upstream'] },
    })

    expect(isDisabled(runButton)).toBe(true)
    expect(isDisabled(stopButton)).toBe(true)
  })
})
