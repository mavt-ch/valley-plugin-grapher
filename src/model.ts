import { normalizePaletteValue, paletteRef } from '@valley/plugin-sdk/palette'
import { MODES, viewOf, type AxisUnits, type Example, type Mode } from './views'

/** The view of a sheet (see `src/views/`). Each keeps its own rows. */
export { MODES, type AxisUnits, type Mode }

export interface Slider {
  min: number
  max: number
  step: number
}

export interface Row {
  id: string
  text: string
  /** A palette reference (`palette:red`) or a literal colour. */
  color: string
  hidden: boolean
  /** Range of θ or t for polar and parametric rows; empty means 0 and 2π. A surface over two coordinates takes its first one here. */
  from: string
  to: string
  /** The second range of a surface over two coordinates (added later: absent in older files, empty means that coordinate's default). */
  from2: string
  to2: string
  slider: Slider
  /** Vector fields: shade each arrow by its magnitude (added later: absent means on). */
  magnitude?: boolean
}

/** One graph: what a single Grapher tab shows and the sidebar edits while that tab is focused. */
export interface Graph {
  mode: Mode
  sheets: Record<Mode, Row[]>
  /** Axis labels chosen with the header switch, per plane view; a view not listed uses its own default. */
  units: Partial<Record<Mode, AxisUnits>>
}

/** The main graph sits at the top level (the tab opened without an instance); every other tab keeps its own in `graphs`. */
export interface GrapherDocument extends Graph {
  version: 1
  graphs: Record<string, Graph>
}

/** The graph id of the tab opened without an instance id. */
export const MAIN_GRAPH = 'main'
const MAX_GRAPHS = 200

/** The rows a fresh trigonometric sheet had before it became Cartesian with π axes. */
const LEGACY_TRIG_EXAMPLES = ['sin(x)', 'cos(x)', 'y = A sin(k x)', 'A = 2', 'k = 0.5']

export const COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'magenta', 'cyan'] as const
export const DEFAULT_SLIDER: Slider = { min: -10, max: 10, step: 0.1 }
const LIMIT = 4096

let counter = 0
export function rowId(): string {
  counter = (counter + 1) % 1_000_000
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** The first palette colour no row uses yet, else the next in turn. */
export function nextColor(rows: readonly Row[]): string {
  const used = new Set(rows.filter((row) => row.text.trim()).map((row) => row.color))
  const free = COLORS.map(paletteRef).find((color) => !used.has(color))
  return free ?? paletteRef(COLORS[rows.length % COLORS.length])
}

export function createRow(rows: readonly Row[], text = '', range: Partial<Pick<Row, 'from' | 'to' | 'from2' | 'to2'>> = {}): Row {
  return { id: rowId(), text, color: nextColor(rows), hidden: false, from: range.from ?? '', to: range.to ?? '', from2: range.from2 ?? '', to2: range.to2 ?? '', slider: { ...DEFAULT_SLIDER } }
}

/** Every sheet ends in one empty row to type into, like a fresh line on paper. */
export function withTrailingRow(rows: readonly Row[]): Row[] {
  const next = [...rows]
  while (next.length > 1 && !next[next.length - 1].text.trim() && !next[next.length - 2].text.trim()) next.pop()
  if (!next.length || next[next.length - 1].text.trim()) next.push(createRow(next))
  return next
}

function examples(texts: readonly Example[]): Row[] {
  const rows: Row[] = []
  for (const entry of texts) {
    const [text, from = '', to = '', from2 = '', to2 = ''] = typeof entry === 'string' ? [entry] : entry
    rows.push(createRow(rows, text, { from, to, from2, to2 }))
  }
  return withTrailingRow(rows)
}

export function defaultSheet(mode: Mode): Row[] {
  return examples(viewOf(mode).examples)
}

export function defaultGraph(mode: Mode = 'cartesian'): Graph {
  return { mode, sheets: Object.fromEntries(MODES.map((candidate) => [candidate, defaultSheet(candidate)])) as Record<Mode, Row[]>, units: {} }
}

export function defaultDocument(): GrapherDocument {
  return { version: 1, ...defaultGraph(), graphs: {} }
}

/** The graph a tab shows: the main graph for `main`, else that tab's own graph (the main one until it exists). */
export function graphOf(document: GrapherDocument, id: string): Graph {
  return id === MAIN_GRAPH ? document : document.graphs[id] ?? document
}

/** Replaces one graph and leaves every other tab's graph as it was. */
export function withGraph(document: GrapherDocument, id: string, graph: Graph): GrapherDocument {
  const { mode, sheets, units } = graph
  return id === MAIN_GRAPH ? { ...document, mode, sheets, units } : { ...document, graphs: { ...document.graphs, [id]: { mode, sheets, units } } }
}

/** The axis labels a view shows: the user's choice, else the view's default (decimal for 3D views). */
export function unitsOf(graph: Graph, mode: Mode): AxisUnits {
  const view = viewOf(mode)
  return graph.units[mode] ?? (view.canvas === 'plane' ? view.units : 'decimal')
}

/** Moves the row at `from` into the gap before row `to` (gaps 0…length); other rows keep their order. */
export function moveRow(rows: readonly Row[], from: number, to: number): Row[] {
  if (from < 0 || from >= rows.length || to < 0 || to > rows.length || to === from || to === from + 1) return [...rows]
  const next = [...rows]
  const [row] = next.splice(from, 1)
  next.splice(to > from ? to - 1 : to, 0, row)
  return next
}

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value.slice(0, LIMIT) : fallback)
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

function normalizeRow(value: unknown, rows: readonly Row[]): Row | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const slider = (record.slider && typeof record.slider === 'object' ? record.slider : {}) as Record<string, unknown>
  const min = finite(slider.min, DEFAULT_SLIDER.min)
  const max = finite(slider.max, DEFAULT_SLIDER.max)
  const step = finite(slider.step, DEFAULT_SLIDER.step)
  return {
    id: text(record.id) || rowId(),
    text: text(record.text),
    color: normalizePaletteValue(record.color) ?? nextColor(rows),
    hidden: record.hidden === true,
    from: text(record.from),
    to: text(record.to),
    from2: text(record.from2),
    to2: text(record.to2),
    slider: min < max && step > 0 ? { min, max, step } : { ...DEFAULT_SLIDER },
    ...(typeof record.magnitude === 'boolean' ? { magnitude: record.magnitude } : {})
  }
}

function readRows(stored: unknown): Row[] | null {
  if (!Array.isArray(stored)) return null
  const rows: Row[] = []
  const ids = new Set<string>()
  for (const entry of stored.slice(0, 500)) {
    const row = normalizeRow(entry, rows)
    if (!row) continue
    if (ids.has(row.id)) row.id = rowId()
    ids.add(row.id)
    rows.push(row)
  }
  return rows
}

function normalizeGraph(record: { mode?: unknown; sheets?: unknown; units?: unknown }): Graph {
  const sheets = (record.sheets && typeof record.sheets === 'object' ? record.sheets : {}) as Record<string, unknown>
  const graph = defaultGraph()
  for (const mode of MODES) {
    const rows = readRows(sheets[mode])
    if (rows) graph.sheets[mode] = withTrailingRow(rows)
  }
  const units = (record.units && typeof record.units === 'object' ? record.units : {}) as Record<string, unknown>
  for (const mode of MODES) {
    if (units[mode] === 'decimal' || units[mode] === 'pi') graph.units[mode] = units[mode]
  }
  // The trigonometric sheet is now the Cartesian one with π axes: its own rows join Cartesian, its examples do not.
  const trig = (readRows(sheets.trig) ?? []).filter((row) => row.text.trim())
  if (trig.length && trig.map((row) => row.text).join('\n') !== LEGACY_TRIG_EXAMPLES.join('\n')) {
    const ids = new Set(graph.sheets.cartesian.map((row) => row.id))
    const kept = graph.sheets.cartesian.filter((row) => row.text.trim())
    graph.sheets.cartesian = withTrailingRow([...kept, ...trig.map((row) => (ids.has(row.id) ? { ...row, id: rowId() } : row))])
  }
  if (record.mode === 'trig') {
    graph.mode = 'cartesian'
    graph.units.cartesian ??= 'pi'
  } else {
    graph.mode = MODES.includes(record.mode as Mode) ? (record.mode as Mode) : 'cartesian'
  }
  return graph
}

/** Reads a stored `graphs.json`; throws when it is not a Grapher document, so the caller never overwrites it. */
export function normalizeDocument(value: unknown): GrapherDocument {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('graphs.json is not a Grapher document (version 1).')
  const record = value as { mode?: unknown; sheets?: unknown; units?: unknown; graphs?: unknown }
  const stored = (record.graphs && typeof record.graphs === 'object' && !Array.isArray(record.graphs) ? record.graphs : {}) as Record<string, unknown>
  const graphs: Record<string, Graph> = {}
  for (const [id, graph] of Object.entries(stored).slice(0, MAX_GRAPHS)) {
    if (id && id !== MAIN_GRAPH && id.length <= 128 && graph && typeof graph === 'object') graphs[id] = normalizeGraph(graph as Record<string, unknown>)
  }
  return { version: 1, ...normalizeGraph(record), graphs }
}

/** The range variable of a row: θ for polar curves, t for plane and space curves. */
export function rangeVariable(kind: 'polar' | 'curve' | 'curve3'): string {
  return kind === 'polar' ? 'θ' : 't'
}
