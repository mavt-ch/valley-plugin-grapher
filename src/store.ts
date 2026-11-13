import type { ValleyPluginApi } from '@valley/plugin-sdk'
import type { FileBaseline } from '@valley/plugin-sdk/types'
import { React, api } from './runtime'
import { uiText } from './localization'
import { PROFILE_ICON_ORDER } from './profileIconSet'
import { availableProfileIcons, subscribeProfileIcons } from './profileIcons'
import { loadPlotEngine, type Camera, type PlotEngine, type Viewport } from './engine'
import { MAIN_GRAPH, MAX_GRAPHS, MAX_NAME, MAX_NOTE, MODES, defaultDocument, defaultGraph, graphOf, nextName, normalizeDocument, profileIds, profileOf, rowId, withGraph, withIcons, withNames, withTrailingRow, type AxisUnits, type Graph, type GrapherDocument, type Mode, type Row } from './model'

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
  /** The profile (graph) the sidebar edits: the one the focused Grapher tab shows, else the one focused last. */
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
    next.active = profileOf(next.document, next.tab)
    this.snapshot = next
    if ('document' in patch || 'tab' in patch) this.syncTitles()
    this.listeners.forEach((listener) => listener())
  }

  private readonly titles = new Map<string, string>()

  /** Each open graph tab is titled with the name of the profile it shows. */
  private syncTitles(): void {
    if (!this.snapshot.loaded) return
    let open: string[] = []
    try { open = this.api.workspace.getOpenMainTabs() } catch { return }
    for (const tab of open) {
      const title = this.profileName(profileOf(this.snapshot.document, tab))
      if (this.titles.get(tab) === title) continue
      this.titles.set(tab, title)
      this.api.workspace.setMainTabTitle(title, tab)
    }
  }

  /** The profile a tab shows. */
  profileOf(tab: string): string {
    return profileOf(this.snapshot.document, tab)
  }

  profileName(id: string): string {
    return this.snapshot.document.names?.[id] ?? uiText('graph.title')
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
    // Once the icon folder is listed, a profile whose icon file is gone gets the next free bundled one.
    this.offs.push(subscribeProfileIcons(() => {
      if (!this.snapshot.loaded) return
      const document = withIcons(this.snapshot.document, PROFILE_ICON_ORDER, availableProfileIcons())
      if (document !== this.snapshot.document) this.change(document)
    }))
    void this.read()
  }

  private async read(): Promise<void> {
    try {
      const file = await this.api.data.files.readTextBaseline(GRAPHS_FILE)
      if (this.disposed) return
      const parsed = file ? normalizeDocument(JSON.parse(file.content)) : defaultDocument()
      const document = withIcons(withNames(parsed, defaultName), PROFILE_ICON_ORDER, availableProfileIcons())
      this.baseline = file?.baseline ?? null
      this.written = file?.content ?? null
      this.writable = true
      this.adoptCameras(document)
      this.update({ loaded: true, document })
      this.problem('problem.load', null)
      // Names and icons given to profiles of an older file are saved with it.
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
      const document = withIcons(withNames(normalizeDocument(JSON.parse(file.content)), defaultName), PROFILE_ICON_ORDER, availableProfileIcons())
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
    this.change(withIcons(withName(withGraph(document, id, { mode, sheets: main.sheets, units: main.units }), id), PROFILE_ICON_ORDER, availableProfileIcons()))
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
    const id = this.tabFor(MAIN_GRAPH)
    this.focus(id)
    this.api.workspace.openMainTab({ instanceId: id, title: this.profileName(MAIN_GRAPH) })
  }

  /** A fresh graph with the example sheets, for a new tab; returns its id. */
  createGraph(mode: Mode): string {
    return this.addGraph(defaultGraph(mode))
  }

  /** A new profile; profiles are never pruned (they are the user's to delete), only capped at `MAX_GRAPHS`. */
  private addGraph(graph: Graph, name?: string): string {
    const id = `g-${rowId()}`
    this.change(withIcons(withName(withGraph(this.snapshot.document, id, graph), id, name), PROFILE_ICON_ORDER, availableProfileIcons()))
    return id
  }

  /** Whether another profile can be added (`graphs.json` keeps at most `MAX_GRAPHS` besides `main`). */
  canAddProfile(): boolean {
    return Object.keys(this.snapshot.document.graphs).length < MAX_GRAPHS
  }

  /** A new instance id for a tab that shows `profile` (opening a profile that has no tab of its own). */
  tabFor(profile: string): string {
    const tab = `t-${rowId()}`
    this.setTabProfile(tab, profile)
    return tab
  }

  /** Shows `profile` in `tab`; the sidebar follows when the tab is focused. */
  setTabProfile(tab: string, profile: string): void {
    const document = this.snapshot.document
    const tabs = { ...document.tabs }
    if (profile === tab) delete tabs[tab]
    else tabs[tab] = profile
    this.change({ ...document, tabs })
  }

  /** A new profile on `mode` with that view's example sheet, shown in `tab`; returns its id. */
  createProfile(tab: string, mode: Mode): string | null {
    if (!this.canAddProfile()) return null
    const id = this.addGraph(defaultGraph(mode))
    this.setTabProfile(tab, id)
    return id
  }

  /** A copy of a profile under "<name> copy", shown in `tab`. */
  duplicateProfile(tab: string, from: string): string | null {
    if (!this.canAddProfile()) return null
    const source = this.graph(from)
    const id = this.addGraph({ mode: source.mode, sheets: source.sheets, units: source.units }, uiText('profile.copyName', { name: this.profileName(from) }).slice(0, MAX_NAME))
    this.setTabProfile(tab, id)
    return id
  }

  /** A profile's icon (a file name in the icon folder), or null for the view's own icon. */
  setProfileIcon(id: string, icon: string | null): void {
    const document = this.snapshot.document
    const icons = { ...document.icons }
    if (icon) icons[id] = icon
    else delete icons[id]
    this.change({ ...document, icons })
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

  /** Moves the profile at `from` into the gap before `to` (gaps 0…count) of the profile list. */
  moveProfile(from: number, to: number): void {
    const ids = profileIds(this.snapshot.document)
    if (from < 0 || from >= ids.length || to === from || to === from + 1) return
    const [moved] = ids.splice(from, 1)
    ids.splice(to > from ? to - 1 : to, 0, moved)
    this.change({ ...this.snapshot.document, order: ids })
  }

  /** A profile's Markdown note; saved like any edit, a moment after typing stops. */
  setNote(id: string, text: string): void {
    const document = this.snapshot.document
    if ((document.notes?.[id] ?? '') === text) return
    const notes = { ...document.notes }
    if (text) notes[id] = text.slice(0, MAX_NOTE)
    else delete notes[id]
    this.change({ ...document, notes })
  }

  renameProfile(id: string, name: string): void {
    const trimmed = name.trim().slice(0, MAX_NAME)
    const document = this.snapshot.document
    if (!trimmed || document.names?.[id] === trimmed) return
    this.change({ ...document, names: { ...document.names, [id]: trimmed } })
  }

  /**
   * Removes a profile; the last one stays. Tabs that showed it show its neighbour (the next profile, else the previous).
   * Deleting `main` moves the neighbour into the main slot, so the top level of `graphs.json` stays a graph.
   */
  deleteProfile(id: string): void {
    const document = this.snapshot.document
    const ids = profileIds(document)
    const at = ids.indexOf(id)
    if (ids.length < 2 || at < 0) return
    const neighbour = ids[at + 1] ?? ids[at - 1]
    const graphs = { ...document.graphs }
    const names = { ...document.names }
    const tabs = { ...document.tabs }
    const icons = { ...document.icons }
    const notes = { ...document.notes }
    const moveCameras = (from: string, to: string | null): void => {
      for (const map of [this.viewports, this.cameras] as Record<string, unknown>[]) {
        for (const key of Object.keys(map)) {
          if (!key.startsWith(`${from}:`)) continue
          if (to) map[`${to}:${key.slice(from.length + 1)}`] = map[key]
          delete map[key]
        }
      }
    }
    let target = neighbour
    let base: GrapherDocument = document
    if (id === MAIN_GRAPH) {
      base = withGraph(document, MAIN_GRAPH, graphs[neighbour])
      names[MAIN_GRAPH] = names[neighbour] ?? this.profileName(neighbour)
      if (icons[neighbour]) icons[MAIN_GRAPH] = icons[neighbour]
      else delete icons[MAIN_GRAPH]
      if (notes[neighbour]) notes[MAIN_GRAPH] = notes[neighbour]
      else delete notes[MAIN_GRAPH]
      delete notes[neighbour]
      moveCameras(MAIN_GRAPH, null)
      moveCameras(neighbour, MAIN_GRAPH)
      delete graphs[neighbour]
      delete names[neighbour]
      delete icons[neighbour]
      target = MAIN_GRAPH
      for (const [tab, shown] of Object.entries(tabs)) if (shown === neighbour) tabs[tab] = MAIN_GRAPH
      tabs[neighbour] = MAIN_GRAPH
    } else {
      delete graphs[id]
      delete names[id]
      delete icons[id]
      delete notes[id]
      moveCameras(id, null)
      for (const [tab, shown] of Object.entries(tabs)) if (shown === id) tabs[tab] = target
      tabs[id] = target
    }
    for (const [tab, shown] of Object.entries(tabs)) if (tab === shown) delete tabs[tab]
    // The list keeps its order: the deleted entry goes; deleting main puts main where its neighbour was.
    const order = ids.filter((entry) => entry !== id).map((entry) => (id === MAIN_GRAPH && entry === neighbour ? MAIN_GRAPH : entry))
    this.change({ ...base, graphs, names, tabs, icons, notes, order })
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

  /** The document with the session's views and cameras of existing profiles, as `graphs.json` keeps it. */
  private saved(): GrapherDocument {
    const document = this.snapshot.document
    const ids = new Set(profileIds(document))
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

/** "Graph n" in the user's language: the name of a profile nobody named. */
const defaultName = (n: number): string => uiText('profile.default', { n })

/** The document with a name for `id` (the given one, else the next free "Graph n"). */
function withName(document: GrapherDocument, id: string, name?: string): GrapherDocument {
  if (!name && document.names?.[id]) return document
  return { ...document, names: { ...document.names, [id]: name ?? nextName(document, defaultName) } }
}

/** The key of one graph's sheet in the session-only camera maps. */
export const cameraKey = (graph: string, mode: Mode): string => `${graph}:${mode}`
