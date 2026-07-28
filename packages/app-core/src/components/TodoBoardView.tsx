import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import type { PaneMode } from '../lib/pane-mode'
import { paneModeForPath } from '../lib/pane-mode'
import type { TODOs, TodoTask } from '@shared/todo-board'
import { todosTitleFromPath } from '@shared/todo-board'
import { TodoBoardColumn } from './TodoBoardColumn'

const COLUMNS: Array<{ title: string; status: string }> = [
  { title: 'Pending', status: 'pending' },
  { title: 'In Progress', status: 'partial' },
  { title: 'Completed', status: 'completed' },
  { title: 'Blocked', status: 'blocked' }
]

interface Props {
  path: string
  paneId: string
}

export function TodoBoardView({ path, paneId }: Props): JSX.Element {
  const [rawJson, setRawJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const paneModes = useStore((s) => s.paneModes[paneId])
  const setPaneModeForPath = useStore((s) => s.setPaneModeForPath)

  const readFromDisk = useCallback(async () => {
    try {
      const res = await window.zen.readNote(path)
      if (res) setRawJson(res.body ?? '')
    } catch {
      setRawJson('')
    }
  }, [path])

  useEffect(() => {
    setLoading(true)
    readFromDisk().finally(() => setLoading(false))
  }, [readFromDisk])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    await readFromDisk()
    setSyncing(false)
  }, [readFromDisk])

  const parsed = useMemo<{ ok: true; data: TODOs } | { ok: false; error: string }>(() => {
    if (!rawJson) return { ok: false, error: 'No content' }
    try {
      const data = JSON.parse(rawJson) as TODOs
      if (!data.tasks || !Array.isArray(data.tasks)) {
        return { ok: false, error: 'Missing "tasks" array in TODOs.json' }
      }
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err instanceof SyntaxError ? err.message : 'Invalid JSON' }
    }
  }, [rawJson])

  const mode: PaneMode = paneModeForPath(paneModes ?? {}, path)

  const setMode = useCallback(
    (next: PaneMode) => {
      setPaneModeForPath(paneId, path, next)
    },
    [paneId, path, setPaneModeForPath]
  )

  const tasksByStatus = useMemo(() => {
    if (!parsed.ok) return new Map<string, TodoTask[]>()
    const map = new Map<string, TodoTask[]>()
    for (const col of COLUMNS) map.set(col.status, [])
    for (const task of parsed.data.tasks) {
      const list = map.get(task.status)
      if (list) list.push(task)
    }
    return map
  }, [parsed])

  const showEditor = mode !== 'preview'
  const showPreview = mode !== 'edit'
  const splitMode = mode === 'split'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="glass-header flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink-800">
            {parsed.ok ? parsed.data.project.name : todosTitleFromPath(path)}
          </span>
          {parsed.ok && (
            <span className="shrink-0 rounded bg-paper-300/50 px-1.5 py-0.5 text-2xs text-ink-500">
              {parsed.data.tasks.length} tasks
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-600 disabled:opacity-50"
            title="Reload from disk"
          >
            <svg
              className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 8a6 6 0 0 1 11.4-3M14 8a6 6 0 0 1-11.4 3" />
              <path d="M13.5 1.5V4.5H10.5" />
              <path d="M2.5 14.5V11.5H5.5" />
            </svg>
          </button>
          <div className="flex items-center gap-1 rounded-md bg-paper-200/70 p-0.5 text-xs">
            {([
              { mode: 'edit' as PaneMode, label: 'Edit' },
              { mode: 'split' as PaneMode, label: 'Split' },
              { mode: 'preview' as PaneMode, label: 'Preview' }
            ] as const).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setMode(opt.mode)}
                className={[
                  'rounded px-2 py-1 transition-colors',
                  mode === opt.mode
                    ? 'bg-paper-100 text-ink-800 shadow-sm'
                    : 'text-ink-400 hover:text-ink-600'
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div
        className={[
          'min-h-0 min-w-0 flex-1 overflow-hidden',
          splitMode ? 'flex flex-row' : 'flex flex-col'
        ].join(' ')}
      >
        {showEditor && (
          <div
            className={[
              'relative min-h-0 min-w-0',
              splitMode
                ? 'flex min-w-0 flex-[1.05] flex-col border-r border-paper-300/70'
                : 'flex flex-1 flex-col'
            ].join(' ')}
          >
            <textarea
              value={rawJson}
              readOnly
              className="min-h-0 flex-1 resize-none border-0 bg-transparent p-4 font-mono text-xs leading-relaxed text-ink-800 outline-none"
              spellCheck={false}
            />
          </div>
        )}

        {showPreview && (
          <div
            className={[
              'min-h-0 min-w-0 overflow-y-auto',
              splitMode ? 'flex min-w-0 flex-1 flex-col bg-paper-50/10' : 'flex-1'
            ].join(' ')}
          >
            {loading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 8a6 6 0 0 1 11.4-3M14 8a6 6 0 0 1-11.4 3" />
                  </svg>
                  Loading...
                </div>
              </div>
            ) : !parsed.ok ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-6 py-4 text-sm text-rose-400">
                  {parsed.error}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
                {COLUMNS.map((col) => (
                  <TodoBoardColumn
                    key={col.status}
                    title={col.title}
                    status={col.status}
                    tasks={tasksByStatus.get(col.status) ?? []}
                    count={tasksByStatus.get(col.status)?.length ?? 0}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
