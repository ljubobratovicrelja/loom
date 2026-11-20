import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import RunControls from './RunControls'

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled

function renderControls(anythingRunning: boolean, onStopAll = vi.fn()) {
  const onRun = vi.fn()
  const onRunStep = vi.fn()

  render(
    <RunControls
      selectedStepName="extract"
      selectedStepNames={[]}
      selectedDataKey={null}
      anythingRunning={anythingRunning}
      onRun={onRun}
      onRunStep={onRunStep}
      onStopAll={onStopAll}
    />,
  )

  return {
    onRun,
    onRunStep,
    onStopAll,
    runAll: screen.getByRole('button', { name: /Run All/i }),
    stopAll: screen.getByRole('button', { name: /Stop All/i }),
    runStep: screen.getByRole('button', { name: /^Run Step/i }),
  }
}

describe('RunControls stop-all', () => {
  it('disables Stop All when nothing is running', () => {
    const { stopAll } = renderControls(false)

    expect(isDisabled(stopAll)).toBe(true)
  })

  it('enables Stop All and disables run buttons while anything is running', () => {
    const { stopAll, runAll, runStep } = renderControls(true)

    expect(isDisabled(stopAll)).toBe(false)
    expect(isDisabled(runAll)).toBe(true)
    expect(isDisabled(runStep)).toBe(true)
  })

  it('calls onStopAll when clicked', () => {
    const { stopAll, onStopAll } = renderControls(true)

    fireEvent.click(stopAll)

    expect(onStopAll).toHaveBeenCalledTimes(1)
  })

  it('omits Stop All when no handler is provided', () => {
    render(
      <RunControls
        selectedStepName={null}
        selectedStepNames={[]}
        selectedDataKey={null}
        anythingRunning={false}
        onRun={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Stop All/i })).toBeNull()
  })
})
