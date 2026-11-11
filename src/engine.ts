import type { ValleyPluginApi } from '@valley/plugin-sdk'
import { STRIDE } from './draw'
import type { Row } from './model'
import { viewOf, type Mode } from './views'

export { STRIDE }

/** The Rust kernel (`src/wasm`, declared as `plot` in config.json): parsing, analysis and sampling. */
const MODULE_ID = 'plot'
const RECORD = '\u001e'
const FIELD = '\u001f'
export type RowKind = 'empty' | 'error' | 'param' | 'value' | 'function' | 'definition' | 'polar' | 'curve' | 'point' | 'implicit' | 'surface' | 'curve3' | 'point3' | 'region' | 'cpoint' | 'csurface'

export interface RowError {
  key: string
  param: string
  /** Undefined names the sidebar offers sliders for. */
  missing: string[]
}

export interface RowAnalysis {
  kind: RowKind
  error?: RowError
  /** Parameter or function name. */
  name?: string
  value?: number
  slider?: boolean
  /** `function` rows: the independent variable; `surface` rows: the coordinate the expression gives. */
  axis?: 'x' | 'y' | 'z'
  from?: number
  to?: number
  /** Coordinates of a point; real and imaginary part of a `cpoint`. */
  x?: number
  y?: number
  z?: number
  /** `region` rows: a strict inequality, drawn with a dashed boundary. */
  strict?: boolean
}

export type PathKind = 'line' | 'point' | 'region'

export interface SamplePath {
  row: number
  kind: PathKind
  points: Float64Array
}

export interface Viewport {
  cx: number
  cy: number
  /** Pixels per unit on both axes. */
  scale: number
}

/** The orbiting camera of a 3D sheet: the visible world is the cube [-range, range]³. */
export interface Camera {
  yaw: number
  pitch: number
  range: number
}

/** One record of a rendered 3D sheet (see the kernel's `space` module): frame lines and labels, then items back to front. */
export interface SpaceRecord {
  kind: number
  /** Row index for items, axis index (0 x, 1 y, 2 z) for axes and labels. */
  row: number
  /** Shade for items, tick value for labels. */
  value: number
  /** Screen points as x, y pairs. */
  points: Float64Array
}

export const SPACE = { polygon: 0, segment: 1, point: 2, huePolygon: 3, box: 10, grid: 11, gridMajor: 12, axis: 13, tick: 14, axisName: 15 } as const

export interface PlotEngine {
  analyze(mode: Mode, rows: readonly Row[]): RowAnalysis[]
  space(mode: Mode, rows: readonly Row[], width: number, height: number, camera: Camera): SpaceRecord[]
  sample(mode: Mode, rows: readonly Row[], width: number, height: number, view: Viewport): SamplePath[]
  /** `f(value)` of a function row, for tracing under the pointer. */
  evaluate(mode: Mode, rows: readonly Row[], row: number, value: number): number
}

interface PlotExports {
  plot_input(len: number): number
  plot_analyze(mode: number): number
  plot_text(): number
  plot_sample(width: number, height: number, cx: number, cy: number, scale: number): number
  plot_samples(): number
  plot_eval(row: number, value: number): number
  plot_space(width: number, height: number, yaw: number, pitch: number, range: number): number
}

const EXPORTS: (keyof PlotExports)[] = ['plot_input', 'plot_analyze', 'plot_text', 'plot_sample', 'plot_samples', 'plot_eval', 'plot_space']
const clean = (value: string): string => value.replace(/[\u001e\u001f]/g, ' ')

export function encodeRows(rows: readonly Row[]): string {
  return rows.map((row) => [clean(row.text), clean(row.from), clean(row.to), row.hidden ? '1' : '0'].join(FIELD)).join(RECORD)
}

export function decodeOutcomes(text: string, count: number): RowAnalysis[] {
  const records = count ? text.split(RECORD) : []
  return Array.from({ length: count }, (_, index): RowAnalysis => {
    const [kind = 'empty', a = '', b = '', c = ''] = (records[index] ?? 'empty').split(FIELD)
    switch (kind) {
      case 'error': return { kind, error: { key: a, param: b, missing: c ? c.split(',') : [] } }
      case 'param': return { kind, name: a, value: Number(b), slider: c === '1' }
      case 'value': return { kind, value: Number(a) }
      case 'function': return { kind, axis: a === 'y' ? 'y' : 'x' }
      case 'surface': return { kind, axis: a === 'x' ? 'x' : a === 'y' ? 'y' : 'z' }
      case 'curve3': return { kind, from: Number(a), to: Number(b) }
      case 'point3': return { kind, x: Number(a), y: Number(b), z: Number(c) }
      case 'region': return { kind, strict: a === 'strict' }
      case 'cpoint': return { kind, x: Number(a), y: Number(b), ...(c ? { name: c } : {}) }
      case 'csurface': return { kind }
      case 'definition': return { kind, name: a }
      case 'polar':
      case 'curve': return { kind, from: Number(a), to: Number(b) }
      case 'point': return { kind, x: Number(a), y: Number(b) }
      case 'implicit': return { kind }
      default: return { kind: 'empty' }
    }
  })
}

export function decodePaths(data: Float64Array): SamplePath[] {
  const paths: SamplePath[] = []
  let at = 0
  while (at + 3 <= data.length) {
    const count = data[at + 2]
    const end = at + 3 + count * STRIDE
    if (!Number.isInteger(count) || end > data.length) break
    const kind: PathKind = data[at + 1] === 1 ? 'point' : data[at + 1] === 3 ? 'region' : 'line'
    paths.push({ row: data[at], kind, points: data.subarray(at + 3, end) })
    at = end
  }
  return paths
}

export function decodeSpace(data: Float64Array): SpaceRecord[] {
  const records: SpaceRecord[] = []
  let at = 0
  while (at + 4 <= data.length) {
    const count = data[at + 3]
    const end = at + 4 + count * 2
    if (!Number.isInteger(count) || end > data.length) break
    records.push({ kind: data[at], row: data[at + 1], value: data[at + 2], points: data.subarray(at + 4, end) })
    at = end
  }
  return records
}

export class PlotEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlotEngineError'
  }
}

export function createPlotEngine(exports: PlotExports, memory: WebAssembly.Memory): PlotEngine {
  let key: string | null = null
  let analyses: RowAnalysis[] = []
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const load = (mode: Mode, rows: readonly Row[]): RowAnalysis[] => {
    const input = encodeRows(rows)
    const kernel = viewOf(mode).kernel
    const next = `${kernel}${RECORD}${input}`
    if (next === key) return analyses
    const bytes = encoder.encode(input)
    // Every call may grow the memory and detach earlier buffers, so each view is taken after its call.
    const target = exports.plot_input(bytes.length)
    new Uint8Array(memory.buffer, target, bytes.length).set(bytes)
    const length = exports.plot_analyze(kernel)
    const text = decoder.decode(new Uint8Array(memory.buffer, exports.plot_text(), length).slice())
    analyses = decodeOutcomes(text, rows.length)
    key = next
    return analyses
  }
  return {
    analyze: load,
    sample(mode, rows, width, height, view) {
      load(mode, rows)
      const count = exports.plot_sample(width, height, view.cx, view.cy, view.scale)
      const at = exports.plot_samples()
      return decodePaths(new Float64Array(memory.buffer, at, count).slice())
    },
    space(mode, rows, width, height, camera) {
      load(mode, rows)
      const count = exports.plot_space(width, height, camera.yaw, camera.pitch, camera.range)
      const at = exports.plot_samples()
      return decodeSpace(new Float64Array(memory.buffer, at, count).slice())
    },
    evaluate(mode, rows, row, value) {
      load(mode, rows)
      return exports.plot_eval(row, value)
    }
  }
}

/**
 * Instantiates the declared module through `api.wasm` once per load session. A failed attempt is not kept, so a
 * later call retries: a frame learns its declared modules from the host's first snapshot, after `register()`.
 */
export function loadPlotEngine(api: Pick<ValleyPluginApi, 'wasm' | 'runtime'>): Promise<PlotEngine> {
  const holder = api.runtime.getOrCreate('grapher.engine', (): { loading: Promise<PlotEngine> | null } => ({ loading: null }))
  holder.loading ??= instantiate(api).catch((error: unknown) => {
    holder.loading = null
    throw error
  })
  return holder.loading
}

async function instantiate(api: Pick<ValleyPluginApi, 'wasm'>): Promise<PlotEngine> {
  const env: { memory?: WebAssembly.Memory } = {}
  const instance = await api.wasm.instantiate(MODULE_ID, { env })
  const exports = (instance as unknown as { exports: Record<string, unknown> }).exports
  for (const name of EXPORTS) if (typeof exports[name] !== 'function') throw new PlotEngineError(`plot module lacks ${name}`)
  if (!env.memory) throw new PlotEngineError('plot module memory was not handed over')
  return createPlotEngine(exports as unknown as PlotExports, env.memory)
}
