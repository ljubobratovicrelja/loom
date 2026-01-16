import type { DataType, FreshnessStatus, StepExecutionState } from '../types/pipeline'

/**
 * Centralized color definitions for the Loom UI.
 * These work with Tailwind's dark mode via the 'media' strategy.
 */

/**
 * Colors for data types - used in nodes, badges, and handles.
 * Accent colors remain consistent across light/dark themes.
 */
export const TYPE_COLORS: Record<DataType, { bg: string; border: string; text: string; handle: string }> = {
  video: {
    bg: '!bg-rose-400',
    border: '!border-rose-400',
    text: 'text-rose-500 dark:text-rose-400',
    handle: '!bg-rose-400',
  },
  image: {
    bg: '!bg-amber-400',
    border: '!border-amber-400',
    text: 'text-amber-500 dark:text-amber-400',
    handle: '!bg-amber-400',
  },
  csv: {
    bg: '!bg-emerald-400',
    border: '!border-emerald-400',
    text: 'text-emerald-500 dark:text-emerald-400',
    handle: '!bg-emerald-400',
  },
  json: {
    bg: '!bg-sky-400',
    border: '!border-sky-400',
    text: 'text-sky-500 dark:text-sky-400',
    handle: '!bg-sky-400',
  },
  image_directory: {
    bg: '!bg-orange-400',
    border: '!border-orange-400',
    text: 'text-orange-500 dark:text-orange-400',
    handle: '!bg-orange-400',
  },
  data_folder: {
    bg: '!bg-teal-400',
    border: '!border-teal-400',
    text: 'text-teal-500 dark:text-teal-400',
    handle: '!bg-teal-400',
  },
}

/**
 * Default handle colors for untyped inputs/outputs.
 */
export const DEFAULT_INPUT_COLOR = {
  bg: '!bg-blue-400',
  border: '!border-blue-400',
  text: 'text-blue-500 dark:text-blue-400',
}

export const DEFAULT_OUTPUT_COLOR = {
  bg: '!bg-green-400',
  border: '!border-green-400',
  text: 'text-green-500 dark:text-green-400',
}

/**
 * Colors for execution status indicators.
 */
export const STATUS_COLORS: Record<StepExecutionState, { border: string; shadow: string; indicator: string }> = {
  idle: {
    border: 'border-slate-400 dark:border-slate-600',
    shadow: '',
    indicator: 'bg-slate-400 dark:bg-slate-500',
  },
  running: {
    border: 'border-cyan-400',
    shadow: 'shadow-cyan-400/50 shadow-lg',
    indicator: 'bg-cyan-400 animate-ping',
  },
  completed: {
    border: 'border-green-500',
    shadow: 'shadow-green-500/30 shadow-md',
    indicator: 'bg-green-500',
  },
  failed: {
    border: 'border-red-500',
    shadow: 'shadow-red-500/30 shadow-md',
    indicator: 'bg-red-500',
  },
}

/**
 * Colors for freshness status badges.
 */
export const FRESHNESS_COLORS: Record<FreshnessStatus, string> = {
  fresh: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
  stale: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
  missing: 'bg-slate-500/20 text-slate-600 dark:text-slate-400 border-slate-500/30',
  no_outputs: 'bg-slate-600/20 text-slate-500 border-slate-600/30',
}

/**
 * Colors for freshness indicator dots on nodes.
 */
export const FRESHNESS_INDICATOR_COLORS: Record<FreshnessStatus, string> = {
  fresh: 'bg-green-500',
  stale: 'bg-amber-500',
  missing: 'bg-slate-400',
  no_outputs: 'bg-slate-600',
}

/**
 * Badge colors for data types in the properties panel.
 */
export const TYPE_BADGE_COLORS: Record<DataType, string> = {
  video: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-600',
  image: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-600',
  csv: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-600',
  json: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-600',
  image_directory: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600',
  data_folder: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-600',
}
