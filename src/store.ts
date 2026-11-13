import type { ValleyPluginApi } from '@valley/plugin-sdk'
import type { FileBaseline } from '@valley/plugin-sdk/types'
import { React, api } from './runtime'
import { uiText } from './localization'
import { loadPlotEngine, type Camera, type PlotEngine, type Viewport } from './engine'
import { MAIN_GRAPH, MODES, defaultDocument, defaultGraph, graphOf, normalizeDocument, rowId, withGraph, withTrailingRow, type AxisUnits, type Graph, type GrapherDocument, type Mode, type Row } from './model'

/** The sheets live in `.valley/plugins/data/grapher/graphs.json`. */
export const GRAPHS_FILE = 'graphs.json'
const SAVE_DELAY = 400
/** Graphs of closed tabs are kept (reopening a tab brings its graph back) until there are more than this many. */
const KEPT_GRAPHS = 40
/** Waits before retrying the engine: the frame's module list arrives with the host's first snapshot. */
const ENGINE_RETRIES = [250, 1000, 3000]

export interface GrapherProblem {
  key: 'problem.load' | 'problem.save' | 'problem.engine'
  message: string
}

export interface GrapherSnapshot {
  loaded: boolean
  document: GrapherDocument
  /** The graph the sidebar edits: the focused Grapher tab's, else the one focused last. */
  active: string
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
  private snapshot: GrapherSnapshot = { loaded: false, document: defaultDocument(), active: MAIN_GRAPH, engine: null, problems: [] }
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
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
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
      const document = file ? normalizeDocument(JSON.parse(file.content)) : defaultDocument()
      this.baseline = file?.baseline ?? null
      this.written = file?.content ?? null
      this.writable = true
      this.update({ loaded: true, document })
      this.problem('problem.load', null)
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
      const document = normalizeDocument(JSON.parse(file.content))
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
    if (id !== this.snapshot.active) this.update({ active: id })
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
    if (!this.snapshot.loaded || id === MAIN_GRAPH || document.graphs[id]) return
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

  /** A copy of one graph under a new id; returns the id. */
  forkGraph(from: string): string {
    const source = this.graph(from)
    return this.addGraph({ mode: source.mode, sheets: source.sheets, units: source.units })
  }

  /** A fresh graph with the example sheets, for a new tab; returns its id. */
  createGraph(mode: Mode): string {
    return this.addGraph(defaultGraph(mode))
  }

  private addGraph(graph: Graph): string {
    const id = `g-${rowId()}`
    const open = new Set(this.api.workspace.getOpenMainTabs())
    const graphs = { ...this.snapshot.document.graphs }
    const closed = Object.keys(graphs).filter((key) => !open.has(key) && key !== this.snapshot.active)
    while (Object.keys(graphs).length >= KEPT_GRAPHS && closed.length) delete graphs[closed.shift()!]
    this.change(withGraph({ ...this.snapshot.document, graphs }, id, graph))
    return id
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

  private save(): Promise<void> {
    const content = JSON.stringify(this.snapshot.document, null, 2) + '\n'
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

/** The key of one graph's sheet in the session-only camera maps. */
export const cameraKey = (graph: string, mode: Mode): string => `${graph}:${mode}`
