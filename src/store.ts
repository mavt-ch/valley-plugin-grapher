import type { ValleyPluginApi } from '@valley/plugin-sdk'
import type { FileBaseline } from '@valley/plugin-sdk/types'
import { React, api } from './runtime'
import { loadPlotEngine, type Camera, type PlotEngine, type Viewport } from './engine'
import { defaultDocument, normalizeDocument, withTrailingRow, type AxisUnits, type GrapherDocument, type Mode, type Row } from './model'

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
  private snapshot: GrapherSnapshot = { loaded: false, document: defaultDocument(), engine: null, problems: [] }
  private readonly listeners = new Set<() => void>()
  private baseline: FileBaseline | null = null
  private written: string | null = null
  private writable = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<void> = Promise.resolve()
  private disposed = false
  private engineRequested = false
  private readonly offs: (() => void)[] = []
  /** Session-only view of each sheet, so switching modes or reopening the tab keeps the camera. */
  readonly viewports: Partial<Record<Mode, Viewport>> = {}
  /** Session-only camera of each 3D sheet. */
  readonly cameras: Partial<Record<Mode, Camera>> = {}

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
    } catch (error) {
      if (this.disposed) return
      this.writable = false
      this.update({ loaded: true })
      this.problem('problem.load', error)
    }
  }

  /** Another window wrote the file: adopt it unless this window has unsaved edits. */
  private async reload(): Promise<void> {
    if (this.timer !== null) return
    await this.pending
    const file = await this.api.data.files.readTextBaseline(GRAPHS_FILE).catch(() => null)
    if (this.disposed || this.timer !== null || !file || file.content === this.written) return
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

  setMode(mode: Mode): void {
    if (mode === this.snapshot.document.mode) return
    this.change({ ...this.snapshot.document, mode })
  }

  setUnits(mode: Mode, units: AxisUnits): void {
    const document = this.snapshot.document
    if (document.units[mode] === units) return
    this.change({ ...document, units: { ...document.units, [mode]: units } })
  }

  updateRows(mode: Mode, edit: (rows: Row[]) => Row[]): void {
    const document = this.snapshot.document
    this.change({ ...document, sheets: { ...document.sheets, [mode]: withTrailingRow(edit([...document.sheets[mode]])) } })
  }

  private change(document: GrapherDocument): void {
    this.update({ document })
    if (!this.writable) return
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
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
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
