import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { PaneMode } from '../lib/pane-mode'
import { paneModeForPath } from '../lib/pane-mode'
import type { TODOs, TodoTask } from '@shared/todo-board'
import { todosTitleFromPath } from '@shared/todo-board'
import { TodoBoardColumn } from './TodoBoardColumn'

import { Annotation, Compartment, EditorState, StateEffect, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { Vim, getCM, vim } from '@replit/codemirror-vim'
import {
  history,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp
} from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { vimAwareDefaultKeymap } from '../lib/cm-vim-default-keymap'
import { toCodeMirrorKey, vimHalfPageKeymap } from '../lib/vim-half-page-keymap'
import { scrollOff } from '../lib/cm-scrolloff'
import { completionKeymapForEditor } from '../lib/cm-completion-nav'
import { getKeymapBinding, type KeymapOverrides } from '../lib/keymaps'
import type { LineNumberMode } from '../store'

const COLUMNS: Array<{ title: string; status: string }> = [
  { title: 'Pending', status: 'pending' },
  { title: 'In Progress', status: 'partial' },
  { title: 'Completed', status: 'completed' },
  { title: 'Blocked', status: 'blocked' },
  { title: 'Rejected', status: 'rejected' }
]

const programmatic = Annotation.define<boolean>()

const SAVE_DEBOUNCE_MS = 700

interface Props {
  path: string
  paneId: string
}

function lineNumberExtension(mode: LineNumberMode): Extension {
  if (mode === 'off') return []
  return [
    lineNumbers({
      formatNumber: (lineNo, state) => {
        if (mode === 'absolute') return String(lineNo)
        const activeLine = state.doc.lineAt(state.selection.main.head).number
        return lineNo === activeLine ? String(lineNo) : String(Math.abs(lineNo - activeLine))
      }
    }),
    highlightActiveLineGutter()
  ]
}

function buildEditorKeymap(vimMode: boolean, overrides: KeymapOverrides): Extension {
  return keymap.of([
    {
      key: 'Mod-f',
      run: () => {
        const state = useStore.getState()
        if (state.vimMode) return false
        state.setSearchOpen(true)
        return true
      }
    },
    {
      key: toCodeMirrorKey(getKeymapBinding(overrides, 'editor.moveLineUp')),
      run: moveLineUp
    },
    {
      key: toCodeMirrorKey(getKeymapBinding(overrides, 'editor.moveLineDown')),
      run: moveLineDown
    },
    ...vimHalfPageKeymap(vimMode, overrides),
    indentWithTab,
    ...vimAwareDefaultKeymap(vimMode),
    ...historyKeymap,
    ...searchKeymap,
    ...completionKeymapForEditor
  ])
}

export function TodoBoardView({ path, paneId }: Props): JSX.Element {
  const [rawJson, setRawJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TodoTask | null>(null)
  const [editedJson, setEditedJson] = useState<string>('')

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const cmViewRef = useRef<EditorView | null>(null)
  const latestDocRef = useRef<string>('')
  const lastSavedRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path

  const vimCompartmentRef = useRef(new Compartment())
  const keymapCompartmentRef = useRef(new Compartment())
  const wordWrapCompartmentRef = useRef(new Compartment())
  const lineNumberCompartmentRef = useRef(new Compartment())
  const drawSelectionCompartmentRef = useRef(new Compartment())
  const scrollOffCompartmentRef = useRef(new Compartment())

  const paneModes = useStore((s) => s.paneModes[paneId])
  const setPaneModeForPath = useStore((s) => s.setPaneModeForPath)
  const setEditorViewRef = useStore((s) => s.setEditorViewRef)
  const activePaneId = useStore((s) => s.activePaneId)
  const vimMode = useStore((s) => s.vimMode)
  const keymapOverrides = useStore((s) => s.keymapOverrides)
  const wordWrap = useStore((s) => s.wordWrap)
  const lineNumberMode = useStore((s) => s.lineNumberMode)
  const cursorBlink = useStore((s) => s.cursorBlink)
  const editorScrollOff = useStore((s) => s.editorScrollOff)

  const writeDoc = useCallback((savePath: string): void => {
    const doc = latestDocRef.current
    if (doc === lastSavedRef.current) return
    lastSavedRef.current = doc
    void window.zen.writeNote(savePath, doc)
  }, [])

  const flushPendingSave = useCallback(
    (savePath: string = pathRef.current): void => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      writeDoc(savePath)
    },
    [writeDoc]
  )

  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      writeDoc(pathRef.current)
    }, SAVE_DEBOUNCE_MS)
  }, [writeDoc])

  const readFromDisk = useCallback(async () => {
    try {
      const res = await window.zen.readNote(path)
      const body = res?.body ?? ''
      setRawJson(body)
      setEditedJson(body)
    } catch {
      setRawJson('')
      setEditedJson('')
    }
  }, [path])

  useEffect(() => {
    setLoading(true)
    readFromDisk().finally(() => setLoading(false))
    return () => {
      flushPendingSave(path)
    }
  }, [readFromDisk, flushPendingSave, path])

  useEffect(() => {
    if (!editorContainerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      if (update.transactions.some((tr) => tr.annotation(programmatic))) return
      const doc = update.state.doc.toString()
      setEditedJson(doc)
      latestDocRef.current = doc
      scheduleSave()
    })

    const state = EditorState.create({
      doc: editedJson,
      extensions: [
        json(),
        vimCompartmentRef.current.of(vimMode ? vim() : []),
        history(),
        drawSelectionCompartmentRef.current.of(
          drawSelection({ cursorBlinkRate: cursorBlink ? 1200 : 0 })
        ),
        highlightActiveLine(),
        wordWrapCompartmentRef.current.of(wordWrap ? EditorView.lineWrapping : []),
        scrollOffCompartmentRef.current.of(scrollOff(editorScrollOff)),
        lineNumberCompartmentRef.current.of(lineNumberExtension(lineNumberMode)),
        keymapCompartmentRef.current.of(buildEditorKeymap(vimMode, keymapOverrides)),
        syntaxHighlighting(defaultHighlightStyle),
        updateListener,
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (event.key !== 'Escape') return false
            const state = useStore.getState()
            if (!state.vimMode) return false
            const cm = getCM(view)
            if (!cm?.state.vim?.insertMode) return false
            event.preventDefault()
            event.stopPropagation()
            Vim.exitInsertMode(cm as Parameters<typeof Vim.exitInsertMode>[0], true)
            return true
          }
        }),
        EditorView.theme({
          '&': { backgroundColor: 'transparent', flex: 1, minHeight: 0, minWidth: 0 },
          '.cm-scroller': { fontFamily: 'inherit', padding: '0', overflow: 'auto' },
          '.cm-content': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '12px',
            lineHeight: '1.65',
            padding: '4px 8px',
            maxWidth: 'none',
            margin: '0',
            width: '100%',
            minWidth: '100%'
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            borderRight: 'none',
            color: 'rgba(0,0,0,0.2)',
            fontSize: '11px'
          },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(0,0,0,0.03)' },
          '.cm-cursor': { borderLeftColor: 'rgba(0,0,0,0.5)' }
        })
      ]
    })

    const view = new EditorView({ state, parent: editorContainerRef.current })
    cmViewRef.current = view

    return () => {
      view.destroy()
      cmViewRef.current = null
    }
    // Only create on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc === editedJson) return
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: editedJson },
      annotations: programmatic.of(true)
    })
  }, [editedJson])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    const effects: Array<StateEffect<unknown>> = [
      vimCompartmentRef.current.reconfigure(vimMode ? vim() : []),
      keymapCompartmentRef.current.reconfigure(buildEditorKeymap(vimMode, keymapOverrides))
    ]
    view.dispatch({ effects })
  }, [vimMode, keymapOverrides])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    view.dispatch({
      effects: wordWrapCompartmentRef.current.reconfigure(wordWrap ? EditorView.lineWrapping : [])
    })
  }, [wordWrap])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    view.dispatch({
      effects: lineNumberCompartmentRef.current.reconfigure(lineNumberExtension(lineNumberMode))
    })
  }, [lineNumberMode])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    view.dispatch({
      effects: drawSelectionCompartmentRef.current.reconfigure(
        drawSelection({ cursorBlinkRate: cursorBlink ? 1200 : 0 })
      )
    })
  }, [cursorBlink])

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    view.dispatch({
      effects: scrollOffCompartmentRef.current.reconfigure(scrollOff(editorScrollOff))
    })
  }, [editorScrollOff])

  const isActivePane = activePaneId === paneId

  useEffect(() => {
    const view = cmViewRef.current
    if (!view) return
    if (isActivePane) {
      setEditorViewRef(view)
      return
    }
    if (useStore.getState().editorViewRef === view) setEditorViewRef(null)
  }, [isActivePane, setEditorViewRef])

  const handleSync = useCallback(async () => {
    flushPendingSave()
    setSyncing(true)
    await readFromDisk()
    setSyncing(false)
  }, [flushPendingSave, readFromDisk])

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

  useEffect(() => {
    if (mode !== 'preview') {
      cmViewRef.current?.requestMeasure()
    }
  }, [mode])

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

  const handleOpenTask = useCallback((task: TodoTask) => {
    setSelectedTask(task)
  }, [])

  const handleEditTask = useCallback((task: TodoTask) => {
    setMode('edit')
    const taskIdLine = rawJson.indexOf(`"${task.id}"`)
    if (taskIdLine >= 0) {
      const before = rawJson.slice(0, taskIdLine)
      const lineNumber = before.split('\n').length
      setTimeout(() => {
        const view = cmViewRef.current
        if (view) {
          const line = view.state.doc.line(lineNumber)
          view.dispatch({
            selection: { anchor: line.from, head: line.to },
            scrollIntoView: true,
            annotations: programmatic.of(true)
          })
          view.focus()
        }
      }, 100)
    }
  }, [rawJson, setMode])

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
        <div
          ref={editorContainerRef}
          className={[
            'min-h-0 min-w-0',
            !showEditor && 'hidden',
            splitMode
              ? 'flex min-w-0 flex-[1.05] flex-col border-r border-paper-300/70'
              : 'flex flex-1 flex-col'
          ].join(' ')}
        />

        {showPreview && (
          <div
            className={[
              'min-h-0 min-w-0 overflow-auto',
              splitMode ? 'flex min-w-0 flex-1 flex-col bg-paper-50/10' : 'flex flex-1 flex-col'
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
              <div className="flex gap-2 p-3">
                {COLUMNS.map((col) => (
                  <TodoBoardColumn
                    key={col.status}
                    title={col.title}
                    status={col.status}
                    tasks={tasksByStatus.get(col.status) ?? []}
                    count={tasksByStatus.get(col.status)?.length ?? 0}
                    onOpenTask={handleOpenTask}
                    onEditTask={handleEditTask}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="mx-4 max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-paper-300/70 bg-paper-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-paper-300/50 px-5 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink-800">
                  {selectedTask.title}
                </span>
                <span className="shrink-0 rounded bg-paper-300/50 px-1.5 py-0.5 font-mono text-2xs text-ink-500">
                  {selectedTask.id}
                </span>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-paper-300/60 hover:text-ink-600"
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div>
                <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Summary</span>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">
                  {selectedTask.summary}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div>
                  <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Area</span>
                  <p className="mt-0.5 text-sm font-medium text-ink-700">{selectedTask.area}</p>
                </div>
                <div>
                  <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Priority</span>
                  <p className="mt-0.5 text-sm font-medium text-ink-700">{selectedTask.priority}</p>
                </div>
                <div>
                  <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Status</span>
                  <p className="mt-0.5 text-sm font-medium text-ink-700">{selectedTask.status}</p>
                </div>
                {selectedTask.verification !== 'not_verified' && (
                  <div>
                    <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Verification</span>
                    <p className="mt-0.5 text-sm font-medium text-accent">{selectedTask.verification}</p>
                  </div>
                )}
              </div>

              {selectedTask.affectedFiles.length > 0 && (
                <div>
                  <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Affected files</span>
                  <ul className="mt-1 space-y-0.5">
                    {selectedTask.affectedFiles.map((f, i) => (
                      <li key={i} className="font-mono text-xs text-ink-600">· {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedTask.dependencies.length > 0 && (
                <div>
                  <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">Dependencies</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedTask.dependencies.map((dep) => (
                      <span key={dep} className="rounded bg-paper-300/50 px-1.5 py-0.5 font-mono text-2xs text-ink-500">
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-paper-300/50 px-5 py-3">
              <button
                onClick={() => { setSelectedTask(null); handleEditTask(selectedTask) }}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Edit in JSON
              </button>
              <button
                onClick={() => setSelectedTask(null)}
                className="rounded-md bg-paper-300/50 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-paper-300/70"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
