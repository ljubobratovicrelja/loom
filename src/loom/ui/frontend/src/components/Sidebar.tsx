import { useState, type ReactNode } from 'react'
import { Video, Image, Table2, Braces, FolderOpen, Folder } from 'lucide-react'
import type { TaskInfo, DataType, PipelineInfo } from '../types/pipeline'
import PipelineBrowser from './PipelineBrowser'

// Data type configuration for the palette
const DATA_TYPES: Array<{ type: DataType; icon: ReactNode; label: string }> = [
  { type: 'image', icon: <Image className="w-4 h-4" />, label: 'Image' },
  { type: 'video', icon: <Video className="w-4 h-4" />, label: 'Video' },
  { type: 'csv', icon: <Table2 className="w-4 h-4" />, label: 'CSV' },
  { type: 'json', icon: <Braces className="w-4 h-4" />, label: 'JSON' },
  { type: 'image_directory', icon: <FolderOpen className="w-4 h-4" />, label: 'Img Dir' },
  { type: 'data_folder', icon: <Folder className="w-4 h-4" />, label: 'Folder' },
]

interface SidebarProps {
  tasks: TaskInfo[]
  onAddTask: (task: TaskInfo) => void
  onAddData: (type: DataType) => void
  parameters: Record<string, unknown>
  onUpdateParameter: (name: string, value: unknown) => void
  onAddParameter: (name: string, value: unknown) => void
  // Workspace mode props
  isWorkspaceMode?: boolean
  pipelines?: PipelineInfo[]
  currentPipelinePath?: string | null
  onSelectPipeline?: (path: string) => void
  onRefreshPipelines?: () => void
  pipelinesLoading?: boolean
}

export default function Sidebar({
  tasks,
  onAddTask,
  onAddData,
  parameters,
  onUpdateParameter,
  onAddParameter,
  isWorkspaceMode = false,
  pipelines = [],
  currentPipelinePath = null,
  onSelectPipeline,
  onRefreshPipelines,
  pipelinesLoading = false,
}: SidebarProps) {
  const [editingParam, setEditingParam] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [addingParam, setAddingParam] = useState(false)
  const [newParamName, setNewParamName] = useState('')
  const [newParamValue, setNewParamValue] = useState('')

  const handleStartEdit = (name: string, value: unknown) => {
    setEditingParam(name)
    setEditValue(String(value))
  }

  const handleSaveEdit = (name: string) => {
    // Try to preserve type: number, boolean, or string
    let parsedValue: unknown = editValue
    if (editValue === 'true') parsedValue = true
    else if (editValue === 'false') parsedValue = false
    else if (!isNaN(Number(editValue)) && editValue.trim() !== '') {
      parsedValue = Number(editValue)
    }
    onUpdateParameter(name, parsedValue)
    setEditingParam(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent, name: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(name)
    } else if (e.key === 'Escape') {
      setEditingParam(null)
    }
  }

  const handleAddParameter = () => {
    if (!newParamName.trim()) return

    // Parse value type
    let parsedValue: unknown = newParamValue
    if (newParamValue === 'true') parsedValue = true
    else if (newParamValue === 'false') parsedValue = false
    else if (!isNaN(Number(newParamValue)) && newParamValue.trim() !== '') {
      parsedValue = Number(newParamValue)
    }

    onAddParameter(newParamName.trim(), parsedValue)
    setNewParamName('')
    setNewParamValue('')
    setAddingParam(false)
  }

  const handleNewParamKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddParameter()
    } else if (e.key === 'Escape') {
      setAddingParam(false)
      setNewParamName('')
      setNewParamValue('')
    }
  }

  return (
    <div className="flex-1 bg-slate-100 dark:bg-slate-900 border-r border-slate-300 dark:border-slate-700 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-slate-300 dark:border-slate-700 shrink-0">
        <h2 className="text-slate-900 dark:text-white font-semibold text-sm uppercase tracking-wide">Add Nodes</h2>
      </div>

      {/* Pipeline Browser (workspace mode only) */}
      {isWorkspaceMode && onSelectPipeline && onRefreshPipelines && (
        <PipelineBrowser
          pipelines={pipelines}
          currentPipelinePath={currentPipelinePath}
          onSelectPipeline={onSelectPipeline}
          onRefresh={onRefreshPipelines}
          loading={pipelinesLoading}
        />
      )}

      {/* Data Types Palette */}
      <div className="p-3 border-t border-slate-300 dark:border-slate-700 shrink-0">
        <h3 className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide mb-2">Data Types</h3>
        <div className="grid grid-cols-2 gap-1">
          {DATA_TYPES.map((dt) => (
            <button
              key={dt.type}
              onClick={() => onAddData(dt.type)}
              className="px-2 py-2 bg-teal-100 hover:bg-teal-200 dark:bg-teal-900/50 dark:hover:bg-teal-800/50 text-teal-700 dark:text-teal-300 text-xs rounded text-left transition-colors flex items-center gap-1"
            >
              <span>{dt.icon}</span>
              <span>{dt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Tasks */}
        <div className="p-3 border-t border-slate-300 dark:border-slate-700">
          <h3 className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide mb-2">Tasks</h3>
          <div className="space-y-1">
            {tasks.map((task) => (
              <button
                key={task.name}
                onClick={() => onAddTask(task)}
                className="w-full px-3 py-2 bg-white hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded text-left transition-colors"
              >
                {task.name}
              </button>
            ))}
            {tasks.length === 0 && (
              <p className="text-slate-400 dark:text-slate-500 text-xs">No tasks found</p>
            )}
          </div>
        </div>

        {/* Parameters */}
        <div className="p-3 border-t border-slate-300 dark:border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Parameters</h3>
            {!addingParam && (
              <button
                onClick={() => setAddingParam(true)}
                className="text-purple-600 hover:text-purple-500 dark:text-purple-400 dark:hover:text-purple-300 text-xs"
                title="Add parameter"
              >
                + Add
              </button>
            )}
          </div>

          {/* Add new parameter form */}
          {addingParam && (
            <div className="bg-white dark:bg-slate-800 rounded p-2 mb-2 border border-purple-500/50">
              <input
                type="text"
                value={newParamName}
                onChange={(e) => setNewParamName(e.target.value)}
                onKeyDown={handleNewParamKeyDown}
                placeholder="name"
                autoFocus
                className="w-full px-2 py-1 mb-1 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs font-mono focus:outline-none focus:border-purple-500"
              />
              <input
                type="text"
                value={newParamValue}
                onChange={(e) => setNewParamValue(e.target.value)}
                onKeyDown={handleNewParamKeyDown}
                placeholder="value"
                className="w-full px-2 py-1 mb-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs font-mono focus:outline-none focus:border-purple-500"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleAddParameter}
                  className="flex-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAddingParam(false)
                    setNewParamName('')
                    setNewParamValue('')
                  }}
                  className="flex-1 px-2 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-xs rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {Object.entries(parameters).map(([name, value]) => (
              <div
                key={name}
                className="bg-white dark:bg-slate-800 rounded p-2 cursor-grab active:cursor-grabbing hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/loom-parameter',
                    JSON.stringify({ name, value })
                  )
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-purple-600 dark:text-purple-300 text-xs font-medium">${name}</div>
                  <span className="text-purple-400 dark:text-purple-500 text-[10px]" title="Drag to canvas">
                    &#8943;&#8943;
                  </span>
                </div>
                {editingParam === name ? (
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleSaveEdit(name)}
                    onKeyDown={(e) => handleKeyDown(e, name)}
                    autoFocus
                    className="w-full px-2 py-1 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white text-xs font-mono focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <div
                    onClick={() => handleStartEdit(name, value)}
                    className="text-slate-600 dark:text-slate-300 text-xs font-mono truncate cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    title="Click to edit"
                  >
                    {String(value)}
                  </div>
                )}
              </div>
            ))}
            {Object.keys(parameters).length === 0 && !addingParam && (
              <p className="text-slate-400 dark:text-slate-500 text-xs">No parameters defined</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
