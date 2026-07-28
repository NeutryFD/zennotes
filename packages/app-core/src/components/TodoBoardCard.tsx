import { type TodoTask } from '@shared/todo-board'

interface TodoBoardCardProps {
  task: TodoTask
  onOpen?: () => void
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-rose-500 border-l-rose-500/80',
  high: 'text-orange-500 border-l-orange-500/70',
  medium: 'text-amber-500 border-l-amber-500/60',
  low: 'text-sky-500 border-l-sky-500/50'
}

const PRIORITY_BG: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-amber-500/15 text-amber-400',
  low: 'bg-sky-500/15 text-sky-400'
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-ink-600',
  partial: 'text-amber-500',
  completed: 'text-green-500',
  blocked: 'text-rose-500'
}

export function TodoBoardCard({ task, onOpen }: TodoBoardCardProps): JSX.Element {
  return (
    <div
      onClick={onOpen}
      className={[
        'group cursor-pointer rounded-md border border-paper-300/50 border-l-2 bg-paper-100/85 px-3 py-2.5 transition-colors hover:border-paper-300/75 hover:bg-paper-200/60',
        PRIORITY_COLORS[task.priority] ?? 'border-l-paper-300/50'
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-ink-800">
          {task.title}
        </span>
        <span className="shrink-0 rounded bg-paper-300/50 px-1.5 py-0.5 font-mono text-2xs text-ink-500">
          {task.id}
        </span>
      </div>

      <div className="mt-1.5 text-xs leading-relaxed text-ink-600 line-clamp-2">
        {task.summary}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-paper-300/50 px-1.5 py-0.5 text-2xs font-medium text-ink-500">
          {task.area}
        </span>

        <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${PRIORITY_BG[task.priority] ?? ''}`}>
          {task.priority}
        </span>

        <span className={`text-2xs font-medium ${STATUS_COLORS[task.status] ?? ''}`}>
          {task.status}
        </span>

        {task.verification !== 'not_verified' && (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-2xs font-medium text-accent">
            {task.verification}
          </span>
        )}

        {task.dependencies.length > 0 && (
          <span className="text-2xs text-ink-400" title={task.dependencies.join(', ')}>
            {task.dependencies.length} dep{task.dependencies.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
