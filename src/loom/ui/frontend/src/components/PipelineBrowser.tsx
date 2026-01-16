import { useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, FolderOpen } from 'lucide-react'
import type { PipelineInfo } from '../types/pipeline'

interface PipelineBrowserProps {
  pipelines: PipelineInfo[]
  currentPipelinePath: string | null
  onSelectPipeline: (path: string) => void
  onRefresh: () => void
  loading?: boolean
}

export default function PipelineBrowser({
  pipelines,
  currentPipelinePath,
  onSelectPipeline,
  onRefresh,
  loading = false,
}: PipelineBrowserProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="border-b border-slate-700">
      {/* Header */}
      <div className="p-3 flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-slate-400 text-xs uppercase tracking-wide hover:text-slate-200"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          <FolderOpen className="w-4 h-4" />
          <span>Pipelines</span>
        </button>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
          title="Refresh pipeline list"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Pipeline list */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
          {pipelines.length === 0 ? (
            <p className="text-slate-500 text-xs">No pipelines found</p>
          ) : (
            pipelines.map((pipeline) => {
              const isActive = pipeline.path === currentPipelinePath
              return (
                <button
                  key={pipeline.path}
                  onDoubleClick={() => onSelectPipeline(pipeline.path)}
                  className={`w-full px-2 py-1.5 rounded text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-slate-800/50 hover:bg-slate-700/50 text-slate-300'
                  }`}
                  title={`Double-click to open: ${pipeline.path}`}
                >
                  <div className="font-medium truncate">{pipeline.name}</div>
                  {pipeline.relative_path && (
                    <div className="text-xs text-slate-500 truncate">
                      {pipeline.relative_path}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
