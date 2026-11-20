import type { ValleyPluginApi } from '@valley/plugin-sdk'
import type { FileBaseline } from '@valley/plugin-sdk/types'
import { React, api } from './runtime'
import { uiText } from './localization'
import { exampleBookmarks } from './bookmarkExamples'
import { loadPlotEngine, type Camera, type PlotEngine, type Viewport } from './engine'
import { NO_BOOKMARKS, addGroup, bookmarkId, deleteGroup, filedIn, moveBookmark, moveGroup, sameExpression, type BookmarkDrop } from './bookmarks'
import { BOOKMARK_GROUP_NAME_MAX, MAIN_GRAPH, MAX_BOOKMARKS, MAX_BOOKMARK_GROUPS, MAX_GRAPHS, MAX_NOTE, MODES, defaultDocument, filled, defaultGraph, graphIdOf, graphIds, graphOf, normalizeDocument, rowId, withGraph, withTrailingRow, type AxisUnits, type BookmarkGroup, type Bookmarks, type Graph, type GrapherDocument, type Mode, type Row } from './model'

/** The sheets live in `.valley/plugins/data/grapher/graphs.json`. */
export const GRAPHS_FILE = 'graphs.json'
const SAVE_DELAY = 400
/** Waits before retrying the engine: the frame's module list arrives with the host's first snapshot. */
const ENGINE_RETRIES = [250, 1000, 3000]

export interface GrapherProblem {
  key: 'problem.load' | 'problem.save' | 'problem.engine'
  message: string
}

export interface GrapherSnapshot {
  loaded: boolean
  document: GrapherDocument
  /** The graph the sidebar edits: the one the focused Grapher tab shows, else the one focused last. */
  active: string
  /** The focused Grapher tab's instance id (`main` for a tab without one). */
  tab: string
  engine: PlotEngine | null
  problems: GrapherProblem[]
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * One store per load session, shared by the sidebar and the graph tab (both render in this plugin's frame).
 * Edits apply at once and are written to the data file after a short pause; a file that is not a Grapher
 * document is left untouched until the user repairs or removes it.
 */
export class GrapherStore {
  private snapshot: GrapherSnapshot = { loaded: false, document: defaultDocument(), active: MAIN_GRAPH, tab: MAIN_GRAPH, engine: null, problems: [] }
  private readonly listeners = new Set<() => void>()
  private baseline: FileBaseline | null = null
  private written: string | null = null
  private writable = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Quiet edits (an animated slider's frames) not yet scheduled for saving. */
  private unsaved = false
  private pending: Promise<void> = Promise.resolve()
  private disposed = false
  private engineRequested = false
  private adoptedAt = 0
  private readonly offs: (() => void)[] = []
  /** Session-only view of each graph's sheets (`graph:mode`), so switching modes or reopening the tab keeps the camera. */
  readonly viewports: Record<string, Viewport> = {}
  /** Session-only camera of each graph's 3D sheets (`graph:mode`). */
  readonly cameras: Record<string, Camera> = {}

  constructor(private readonly api: ValleyPluginApi) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.requestEngine()
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): GrapherSnapshot => this.snapshot

  private update(patch: Partial<GrapherSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    next.active = graphIdOf(next.document, next.tab)
    this.snapshot = next
    if ('document' in patch || 'tab' in patch) this.syncTitles()
    this.listeners.forEach((listener) => listener())
  }

  private readonly titles = new Map<string, string>()

  /** Every open graph tab is titled Grapher (a tab still titled with the name of an earlier per-tab graph is renamed). */
  private syncTitles(): void {
    if (!this.snapshot.loaded) return
    let open: string[] = []
    try { open = this.api.workspace.getOpenMainTabs() } catch { return }
    const title = uiText('graph.title')
    for (const tab of open) {
      if (this.titles.get(tab) === title) continue
      this.titles.set(tab, title)
      this.api.workspace.setMainTabTitle(title, tab)
    }
  }

  /** The graph a tab shows. */
  graphIdOf(tab: string): string {
    return graphIdOf(this.snapshot.document, tab)
  }

  private problem(key: GrapherProblem['key'], error: unknown | null): void {
    const problems = this.snapshot.problems.filter((problem) => problem.key !== key)
    if (error === null && problems.length === this.snapshot.problems.length) return
    if (error !== null) problems.push({ key, message: messageOf(error) })
    this.update({ problems })
  }

  /** The engine loads when the first view subscribes, by which time the frame knows its declared modules. */
  private requestEngine(): void {
    if (this.engineRequested) return
    this.engineRequested = true
    const attempt = (retry: number): void => {
      loadPlotEngine(this.api).then(
        (engine) => {
          if (this.disposed) return
          this.update({ engine })
          this.problem('problem.engine', null)
        },
        (error: unknown) => {
          if (this.disposed) return
          if (retry < ENGINE_RETRIES.length) setTimeout(() => attempt(retry + 1), ENGINE_RETRIES[retry])
          else this.problem('problem.engine', error)
        }
      )
    }
    attempt(0)
  }

  start(): void {
    this.offs.push(this.api.data.files.onChanged((path) => { if (path === GRAPHS_FILE) void this.reload() }))
    this.offs.push(this.api.runtime.onBeforeUnload(() => this.flush()))
    this.offs.push(this.api.subscribeState(['activePluginTab'], ({ state: { activePluginTab } }) => {
      if (activePluginTab?.pluginId !== this.api.pluginId) return
      this.focus(activePluginTab.instanceId ?? MAIN_GRAPH)
      this.adoptUntitledTab()
    }))
    void this.read()
  }

  private async read(): Promise<void> {
    try {
      const file = await this.api.data.files.readTextBaseline(GRAPHS_FILE)
      if (this.disposed) return
      const parsed = file ? normalizeDocument(JSON.parse(file.content)) : defaultDocument()
      const document = withExamples(parsed)
      this.baseline = file?.baseline ?? null
      this.written = file?.content ?? null
      this.writable = true
      this.adoptCameras(document)
      this.update({ loaded: true, document })
      this.problem('problem.load', null)
      // The example bookmarks given to a file without bookmarks are saved with it.
      if (file && document !== parsed) this.schedule()
      this.ensureGraph(this.snapshot.active)
      this.adoptUntitledTab()
    } catch (error) {
      if (this.disposed) return
      this.writable = false
      this.update({ loaded: true })
      this.problem('problem.load', error)
    }
  }

  /** Another window wrote the file: adopt it unless this window has unsaved edits. */
  private async reload(): Promise<void> {
    if (this.timer !== null || this.unsaved) return
    await this.pending
    const file = await this.api.data.files.readTextBaseline(GRAPHS_FILE).catch(() => null)
    if (this.disposed || this.timer !== null || this.unsaved || !file || file.content === this.written) return
    try {
      const document = withExamples(normalizeDocument(JSON.parse(file.content)))
      this.adoptCameras(document)
      this.baseline = file.baseline
      this.written = file.content
      this.writable = true
      this.update({ document })
      this.problem('problem.load', null)
    } catch (error) {
      this.problem('problem.load', error)
    }
  }

  /** The sidebar follows the focused Grapher tab. */
  focus(id: string): void {
    if (id !== this.snapshot.tab) this.update({ tab: id })
    this.ensureGraph(id)
  }

  graph(id: string): Graph {
    return graphOf(this.snapshot.document, id)
  }

  /**
   * A tab whose graph is not stored yet (an older tab, or one restored after its graph was dropped) starts as a
   * copy of the main graph, on the view its id names when it is one.
   */
  ensureGraph(id: string): void {
    const document = this.snapshot.document
    if (!this.snapshot.loaded || id === MAIN_GRAPH || document.graphs[id] || document.tabs?.[id]) return
    const main = graphOf(document, MAIN_GRAPH)
    const mode = MODES.includes(id as Mode) ? (id as Mode) : main.mode
    this.change(withGraph(document, id, { mode, sheets: main.sheets, units: main.units }))
  }

  /**
   * A Grapher tab opened without an instance id (the rail, a menu, an older layout) cannot be told apart from another
   * one, so the focused one is re-keyed in place to a copy of the main graph; from then on it keeps its own graph.
   */
  private adoptUntitledTab(): void {
    const tab = this.api.getState().activePluginTab
    if (!this.snapshot.loaded || tab?.pluginId !== this.api.pluginId || tab.instanceId) return
    const now = Date.now()
    if (now - this.adoptedAt < 1000) return
    this.adoptedAt = now
    const id = this.forkGraph(MAIN_GRAPH)
    this.focus(id)
    this.api.workspace.openMainTab({ instanceId: id, title: uiText('graph.title') })
  }

  /** A copy of one graph under a new id (the id of the tab that will show it); returns the id. */
  forkGraph(from: string): string {
    const source = this.graph(from)
    return this.addGraph({ mode: source.mode, sheets: source.sheets, units: source.units })
  }

  /** A fresh graph with the example sheets, for a new tab; returns its id. */
  createGraph(mode: Mode): string {
    return this.addGraph(defaultGraph(mode))
  }

  /** Stores a graph for a new tab. At `MAX_GRAPHS` the graphs of tabs that are no longer open make room, oldest first. */
  private addGraph(graph: Graph): string {
    const id = `g-${rowId()}`
    let open = new Set<string>()
    try { open = new Set(this.api.workspace.getOpenMainTabs()) } catch { /* no workspace: nothing is known to be closed */ }
    const document = this.snapshot.document
    const graphs = { ...document.graphs }
    const shown = new Set(Object.entries(document.tabs ?? {}).filter(([tab]) => open.has(tab)).map(([, graph]) => graph))
    const closed = Object.keys(graphs).filter((key) => !open.has(key) && !shown.has(key) && key !== this.snapshot.active)
    while (Object.keys(graphs).length >= MAX_GRAPHS && closed.length) delete graphs[closed.shift()!]
    this.change(withGraph({ ...document, graphs }, id, graph))
    return id
  }

  /** The saved 2D views and 3D cameras of a loaded file become the session's, so a restart opens where it was left. */
  private adoptCameras(document: GrapherDocument): void {
    for (const [key, camera] of Object.entries(document.cameras ?? {})) {
      if ('scale' in camera) this.viewports[key] = { cx: camera.cx, cy: camera.cy, scale: camera.scale }
      else this.cameras[key] = { yaw: camera.yaw, pitch: camera.pitch, range: camera.range }
    }
  }

  /** A pan, zoom or orbit moved a view: saved with the rest once the movement stops (the snapshot is not touched). */
  noteCamera(): void {
    if (this.writable && this.snapshot.loaded) this.schedule()
  }

  /** A graph's Markdown note; saved like any edit, a moment after typing stops. */
  setNote(id: string, text: string): void {
    const document = this.snapshot.document
    if ((document.notes?.[id] ?? '') === text) return
    const notes = { ...document.notes }
    if (text) notes[id] = text.slice(0, MAX_NOTE)
    else delete notes[id]
    this.change({ ...document, notes })
  }

  private editGraph(id: string, edit: (graph: Graph) => Graph | null, quiet = false): void {
    const next = edit(this.graph(id))
    if (next) this.change(withGraph(this.snapshot.document, id, next), quiet)
  }

  setMode(id: string, mode: Mode): void {
    this.editGraph(id, (graph) => (graph.mode === mode ? null : { ...graph, mode }))
  }

  setUnits(id: string, mode: Mode, units: AxisUnits): void {
    this.editGraph(id, (graph) => (graph.units[mode] === units ? null : { ...graph, units: { ...graph.units, [mode]: units } }))
  }

  /** `quiet` applies the edit at once but leaves saving to {@link commit}: an animated slider changes its row every frame
   * and saves once when it stops. */
  updateRows(id: string, mode: Mode, edit: (rows: Row[]) => Row[], options: { quiet?: boolean } = {}): void {
    this.editGraph(id, (graph) => ({ ...graph, sheets: { ...graph.sheets, [mode]: withTrailingRow(edit([...graph.sheets[mode]])) } }), options.quiet)
  }

  bookmarks(): Bookmarks {
    return this.snapshot.document.bookmarks ?? NO_BOOKMARKS
  }

  private setBookmarks(bookmarks: Bookmarks, undoLabel?: string): void {
    const previous = this.bookmarks()
    this.change({ ...this.snapshot.document, bookmarks })
    if (!undoLabel) return
    const apply = (value: Bookmarks) => async () => { this.change({ ...this.snapshot.document, bookmarks: value }); return { ok: true } }
    try { this.api.undo.push({ label: undoLabel, undo: apply(previous), redo: apply(bookmarks) }) } catch { /* the stack is optional */ }
  }

  /** Whether another bookmark (or group) fits. */
  canBookmark(): boolean {
    return this.bookmarks().items.length < MAX_BOOKMARKS
  }

  canAddBookmarkGroup(): boolean {
    return this.bookmarks().groups.length < MAX_BOOKMARK_GROUPS
  }

  /** Files a copy of an expression row in `group` (the top level when absent); an identical one already there is kept as it is. */
  addBookmark(mode: Mode, row: Row, group?: string): void {
    const bookmarks = this.bookmarks()
    if (!this.canBookmark() || !filled(row) || filedIn(bookmarks, mode, row).has(group ?? '')) return
    if (group && !bookmarks.groups.some((entry) => entry.id === group)) return
    const { hidden: _, ...copy } = row
    const item = { id: bookmarkId('b'), mode, row: { ...copy, hidden: false }, ...(group ? { group } : {}) }
    this.setBookmarks({ ...bookmarks, items: [...bookmarks.items, item] })
  }

  /** A new open group (a subgroup under `parent`); returns its id, or null when there is no room. */
  addBookmarkGroup(name: string, parent?: string): string | null {
    const bookmarks = this.bookmarks()
    if (!this.canAddBookmarkGroup()) return null
    const id = bookmarkId('group')
    const groups = addGroup(bookmarks.groups.map((group) => (group.id === parent ? withoutCollapsed(group) : group)), { id, name, ...(parent ? { parent } : {}) })
    if (!groups.some((group) => group.id === id)) return null
    this.setBookmarks({ ...bookmarks, groups })
    return id
  }

  renameBookmarkGroup(id: string, name: string): void {
    const trimmed = name.trim().slice(0, BOOKMARK_GROUP_NAME_MAX)
    const bookmarks = this.bookmarks()
    if (!trimmed || bookmarks.groups.find((group) => group.id === id)?.name === trimmed) return
    this.setBookmarks({ ...bookmarks, groups: bookmarks.groups.map((group) => (group.id === id ? { ...group, name: trimmed } : group)) })
  }

  /** Opens or closes a group in the list; `null` opens or closes every group. */
  setBookmarkGroupCollapsed(id: string | null, collapsed: boolean): void {
    const bookmarks = this.bookmarks()
    this.setBookmarks({ ...bookmarks, groups: bookmarks.groups.map((group) => (id === null || group.id === id ? (collapsed ? { ...group, collapsed: true } : withoutCollapsed(group)) : group)) })
  }

  deleteBookmarkGroup(id: string): void {
    const bookmarks = this.bookmarks()
    const name = bookmarks.groups.find((group) => group.id === id)?.name
    if (name === undefined) return
    this.setBookmarks(deleteGroup(bookmarks, id), uiText('bookmarks.undo.deleteGroup', { name }))
  }

  deleteBookmark(id: string): void {
    const bookmarks = this.bookmarks()
    if (!bookmarks.items.some((item) => item.id === id)) return
    this.setBookmarks({ ...bookmarks, items: bookmarks.items.filter((item) => item.id !== id) }, uiText('bookmarks.undo.delete'))
  }

  /** Moves a dragged bookmark or group; returns whether anything moved. A bookmark dropped into a closed group opens it. */
  moveInBookmarks(kind: 'bookmark' | 'group', id: string, drop: BookmarkDrop): boolean {
    const bookmarks = this.bookmarks()
    if (kind === 'group') {
      const groups = moveGroup(bookmarks.groups, id, drop)
      if (groups) this.setBookmarks({ ...bookmarks, groups })
      return groups !== null
    }
    const items = moveBookmark(bookmarks.items, bookmarks.groups, id, drop)
    if (!items) return false
    const opened = drop.kind === 'group' && drop.position === 'inside' ? drop.id : null
    this.setBookmarks({ groups: opened ? bookmarks.groups.map((group) => (group.id === opened ? withoutCollapsed(group) : group)) : bookmarks.groups, items })
    return true
  }

  /** Whether a drag would move anything (the list shows a drop marker only then). */
  canMoveInBookmarks(kind: 'bookmark' | 'group', id: string, drop: BookmarkDrop): boolean {
    const bookmarks = this.bookmarks()
    return kind === 'group' ? moveGroup(bookmarks.groups, id, drop) !== null : moveBookmark(bookmarks.items, bookmarks.groups, id, drop) !== null
  }

  /** Whether a graph's sheet of the bookmark's view holds the bookmarked expression. */
  bookmarkInGraph(graph: string, id: string): boolean {
    const item = this.bookmarks().items.find((entry) => entry.id === id)
    return item !== undefined && this.graph(graph).sheets[item.mode].some((row) => filled(row) && sameExpression(row, item.row))
  }

  /**
   * A click on a bookmark: one not in the graph is added (switching the graph to its view); one in the graph on another
   * view is shown by switching to that view; one in the graph on the view shown is taken out of it again (the bookmark
   * stays). Returns what happened.
   */
  toggleBookmarkInGraph(graph: string, id: string): 'added' | 'shown' | 'removed' | null {
    const item = this.bookmarks().items.find((entry) => entry.id === id)
    if (!item) return null
    if (!this.bookmarkInGraph(graph, id)) return this.insertBookmark(graph, id) ? 'added' : null
    if (this.graph(graph).mode !== item.mode) {
      this.setMode(graph, item.mode)
      return 'shown'
    }
    this.updateRows(graph, item.mode, (rows) => rows.filter((row) => !(filled(row) && sameExpression(row, item.row))))
    return 'removed'
  }

  /** Adds a copy of a bookmark to the end of a graph's sheet of the bookmark's view, switching the graph to that view;
   * returns the new row's id. */
  insertBookmark(graph: string, id: string): string | null {
    const item = this.bookmarks().items.find((entry) => entry.id === id)
    if (!item) return null
    const row = { ...item.row, id: rowId(), hidden: false }
    this.editGraph(graph, (current) => {
      const rows = current.sheets[item.mode]
      const kept = rows.length && !filled(rows[rows.length - 1]) ? rows.slice(0, -1) : rows
      return { ...current, mode: item.mode, sheets: { ...current.sheets, [item.mode]: withTrailingRow([...kept, row]) } }
    })
    return row.id
  }

  /** Schedules the save of quiet edits. */
  commit(): void {
    if (this.unsaved && this.writable) this.schedule()
  }

  private change(document: GrapherDocument, quiet = false): void {
    this.update({ document })
    if (!this.writable) return
    if (quiet) {
      this.unsaved = true
      return
    }
    this.schedule()
  }

  private schedule(): void {
    this.unsaved = false
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, SAVE_DELAY)
  }

  /** The document with the session's views and cameras of existing graphs, as `graphs.json` keeps it. */
  private saved(): GrapherDocument {
    const document = this.snapshot.document
    const ids = new Set(graphIds(document))
    const cameras: Record<string, Record<string, number>> = {}
    for (const [key, value] of [...Object.entries(this.viewports), ...Object.entries(this.cameras)]) {
      if (ids.has(key.slice(0, key.lastIndexOf(':')))) cameras[key] = { ...value }
    }
    const rest: GrapherDocument = { ...document }
    delete rest.cameras
    return Object.keys(cameras).length ? { ...rest, cameras } : rest
  }

  private save(): Promise<void> {
    const content = JSON.stringify(this.saved(), null, 2) + '\n'
    const run = async (): Promise<void> => {
      if (content === this.written) return
      const result = await this.api.data.files.writeTextGuarded(GRAPHS_FILE, content, this.baseline)
      if (!result.ok) throw new Error('graphs.json changed in another window. Reload Grapher before editing again.')
      this.baseline = result.baseline
      this.written = content
    }
    const next = this.pending.then(run)
    this.pending = next.then(
      () => { if (!this.disposed) this.problem('problem.save', null) },
      (error: unknown) => { if (!this.disposed) this.problem('problem.save', error) }
    )
    return next
  }

  async flush(): Promise<void> {
    if (this.timer !== null || this.unsaved) {
      if (this.timer !== null) clearTimeout(this.timer)
      this.timer = null
      this.unsaved = false
      await this.save()
    }
    await this.pending
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.offs.splice(0).forEach((off) => off())
  }
}

export function getStore(): GrapherStore {
  return api.runtime.getOrCreate('grapher.store', () => {
    const store = new GrapherStore(api)
    store.start()
    return store
  })
}

export function useGrapher(): GrapherSnapshot {
  const store = getStore()
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** A file without bookmarks (older, or new) gets the example bookmarks once; one whose bookmarks were all deleted keeps none. */
function withExamples(document: GrapherDocument): GrapherDocument {
  return document.bookmarks ? document : { ...document, bookmarks: exampleBookmarks((key) => uiText(`bookmarks.example.${key}`)) }
}

function withoutCollapsed(group: BookmarkGroup): BookmarkGroup {
  const { collapsed: _, ...rest } = group
  return rest
}

/** The key of one graph's sheet in the session-only camera maps. */
export const cameraKey = (graph: string, mode: Mode): string => `${graph}:${mode}`
