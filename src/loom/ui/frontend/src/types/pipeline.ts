import type { Node, Edge } from '@xyflow/react'

// Execution types (defined early for use in data types)
export type StepExecutionState = 'idle' | 'running' | 'completed' | 'failed'

export type FreshnessStatus = 'fresh' | 'stale' | 'missing' | 'no_outputs' | 'unknown'

// Data types for typed data nodes
export type DataType =
  | 'image'
  | 'video'
  | 'csv'
  | 'json'
  | 'txt'
  | 'image_directory'
  | 'data_folder'

export interface StepData {
  name: string
  task: string
  inputs: Record<string, string>
  outputs: Record<string, string>
  args: Record<string, unknown>
  optional: boolean
  disabled?: boolean
  executionState?: StepExecutionState
  freshnessStatus?: FreshnessStatus
  // Type information from task schema (populated on load)
  inputTypes?: Record<string, DataType>
  outputTypes?: Record<string, DataType>
  // Index signature for React Flow compatibility
  [key: string]: unknown
}

export interface ParameterData {
  name: string
  value: unknown  // string | number | boolean
  // Index signature for React Flow compatibility
  [key: string]: unknown
}

// Data node - typed file/directory data
export interface DataNodeData {
  key: string            // Programmatic identifier for $references (e.g., "gaze_csv")
  name: string           // Display name (e.g., "Gaze Positions")
  type: DataType         // The semantic data type
  path: string           // File/directory path
  description?: string   // Optional description
  pattern?: string       // Optional file pattern for directories
  exists?: boolean       // Runtime: does path exist?
  pulseError?: boolean   // Animation flag for error state
  // Index signature for React Flow compatibility
  [key: string]: unknown
}

export type StepNode = Node<StepData, 'step'>
export type ParameterNode = Node<ParameterData, 'parameter'>
export type DataNode = Node<DataNodeData, 'data'>
export type PipelineNode = StepNode | ParameterNode | DataNode

export interface EditorOptions {
  autoSave: boolean
}

export interface ExecutionOptions {
  parallel: boolean
  maxWorkers: number | null
}

// Data section entry in YAML (for serialization)
export interface DataEntry {
  type: DataType
  path: string
  name?: string          // Display name (optional, falls back to key)
  description?: string
  pattern?: string
}

export interface PipelineGraph {
  variables: Record<string, string>
  parameters: Record<string, unknown>
  data: Record<string, DataEntry>  // NEW: Data nodes section
  nodes: PipelineNode[]
  edges: Edge[]
  editor?: EditorOptions
  execution?: ExecutionOptions
  hasLayout?: boolean  // True if positions were loaded from YAML
}

export interface EditorState {
  configPath: string | null
  tasksDir: string
  workspaceDir: string | null
  isWorkspaceMode: boolean
}

export interface PipelineInfo {
  name: string          // Display name (parent directory name)
  path: string          // Absolute path to pipeline.yml
  relative_path: string // Path relative to workspace directory
}

export interface ArgSchema {
  type: string
  default?: unknown
  description: string
  required?: boolean
  choices?: string[]
}

// Input/output schema with optional type for validation
export interface InputOutputSchema {
  description: string
  type?: DataType  // Optional type for connection validation
}

export interface TaskInfo {
  name: string
  path: string
  description: string
  inputs: Record<string, InputOutputSchema>
  outputs: Record<string, InputOutputSchema>
  args: Record<string, ArgSchema>
}

// Execution types
export type RunMode = 'step' | 'from_step' | 'to_data' | 'all' | 'parallel'

export type ExecutionStatus = 'idle' | 'running' | 'cancelled' | 'completed' | 'failed'

export interface RunRequest {
  mode: RunMode
  step_name?: string
  step_names?: string[]  // For parallel mode
  data_name?: string
}

// Per-step terminal output for parallel execution
export interface StepTerminalState {
  output: string
  status: StepExecutionState
}

// Validation types
export type ValidationLevel = 'warning' | 'error' | 'info'

export interface ValidationWarning {
  level: ValidationLevel
  message: string
  step?: string
  input_output?: string
}

export interface ValidationResult {
  warnings: ValidationWarning[]
}

// Clean types
export interface CleanPreviewPath {
  name: string
  path: string
  exists: boolean
}

export interface CleanPreview {
  paths: CleanPreviewPath[]
}

export interface CleanResultItem {
  path: string
  success: boolean
  action: 'trashed' | 'deleted' | 'skipped'
  error: string | null
}

export interface CleanResult {
  results: CleanResultItem[]
  cleaned_count: number
  failed_count: number
}

// Re-export types from hooks for convenience
export type { FreshnessInfo } from '../hooks/useFreshness'
export type { BlockReason, RunEligibility } from '../hooks/useRunEligibility'
