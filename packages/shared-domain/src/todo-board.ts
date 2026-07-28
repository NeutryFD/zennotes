export const TODOS_EXT = '.todos.json'

export function isTodosJsonPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.toLowerCase().endsWith(TODOS_EXT)
}

export function todosTitleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.toLowerCase().endsWith(TODOS_EXT)
    ? base.slice(0, -TODOS_EXT.length)
    : base
}

export type TaskStatus = 'pending' | 'partial' | 'completed' | 'blocked'
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type VerificationState =
  | 'not_verified'
  | 'user_reported'
  | 'helm_lint_validated'
  | 'rendered_client_validated'
  | 'live_cluster_verified'
  | 'repository_evidence'

export interface TodoTask {
  id: string
  area: string
  title: string
  priority: TaskPriority
  status: TaskStatus
  dependencies: string[]
  summary: string
  affectedFiles: string[]
  verification: VerificationState
  blockedReason?: string
  verifiedAt?: string
  verificationEvidence?: string[]
  commit?: string
  reviewAfter?: string
}

export interface TodoProject {
  name: string
  description: string
  repository: string
  documentation: string[]
}

export interface TodoSource {
  document: string
  date: string
}

export interface StatusDefinitions {
  pending: string
  partial: string
  completed: string
  blocked: string
}

export interface TODOs {
  schemaVersion: number
  project: TodoProject
  source: TodoSource
  lastUpdated: string
  statusDefinitions: StatusDefinitions
  tasks: TodoTask[]
}
