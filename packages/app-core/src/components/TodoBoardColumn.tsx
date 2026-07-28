import { type TodoTask } from '@shared/todo-board'
import { TodoBoardCard } from './TodoBoardCard'

interface TodoBoardColumnProps {
  title: string
  status: string
  tasks: TodoTask[]
  count: number
  accent?: string
  onOpenTask?: (task: TodoTask) => void
}

const STATUS_ACCENTS: Record<string, string> = {
  pending: '#e0a34a',
  partial: '#57a55a',
  completed: '#4a9ec0',
  blocked: '#d9788f'
}

export function TodoBoardColumn({ title, status, tasks, count, accent, onOpenTask }: TodoBoardColumnProps): JSX.Element {
  const columnAccent = accent ?? STATUS_ACCENTS[status]
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg border border-paper-300/60 bg-paper-100/60">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-paper-300/45 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {columnAccent && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: columnAccent }}
            />
          )}
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-ink-700">
            {title}
          </span>
        </div>
        <span className="shrink-0 text-xs text-ink-400">{count}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-paper-300/60 px-2 py-3 text-center text-xs text-ink-400">
            no tasks
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <TodoBoardCard
                key={task.id}
                task={task}
                onOpen={onOpenTask ? () => onOpenTask(task) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
