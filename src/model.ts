import { normalizePaletteValue, paletteRef } from '@valley/plugin-sdk/palette'
import { MAX_TABLE_ROWS, type Cells } from './table'
import { MODES, viewOf, type AxisUnits, type Example, type Mode } from './views'

/** The view of a sheet (see `src/views/`). Each keeps its own rows. */
export { MODES, type AxisUnits, type Mode }

export interface Slider {
  min: number
  max: number
  step: number
}

/** How a slider plays: forward (min to max), backward or back and forth, at a speed relative to one sweep of the range,
 * once or looping. Saved per slider row once changed; whether it is playing is not saved. */
export interface Animation {
  direction: 'forward' | 'backward' | 'bounce'
  speed: number
  loop: boolean
}

export const ANIMATION_SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export const DEFAULT_ANIMATION: Animation = { direction: 'forward', speed: 1, loop: true }

/** A table of points: column names and the cells, x and y per row, each a number or a constant expression. */
export interface Table {
  head: [x: string, y: string]
  cells: Cells
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
  /** Level curves (added later, each absent until set): the most levels in view (absent means 10), the step between them
   * (absent or empty means automatic), their value labels (absent means on) and, for a surface z = f(x, y), the curves on the floor. */
  levels?: number
  step?: string
  labels?: boolean
  floor?: boolean
  /** Tangent planes: draw the normal vector (added later: absent means on). */
  normal?: boolean
  /** A table of points instead of an expression (added later): the row's text stays empty. */
  table?: Table
  /** Tables and lists of points: join the points with a line in the order given (added later: absent means off). */
  connect?: boolean
  /** Slider rows: how the play button animates the value (added later: absent means forward, 1×, looping). */
  animation?: Animation
}

/** A row with something in it: text, or a table (even an empty one). */
export const filled = (row: Row): boolean => row.table !== undefined || row.text.trim() !== ''

/** A fresh table: columns x and y and three rows to fill. */
export function createTable(): Table {
  return { head: ['x', 'y'], cells: [['', ''], ['', ''], ['', '']] }
}

/** The most level curves a row may ask for, and the count it draws when it does not say. */
export const MAX_LEVELS = 50
export const DEFAULT_LEVELS = 10

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
  /** Profile names by graph id: every graph is a named profile (`main` included). Absent in files before profiles. */
  names?: Record<string, string>
  /** The profile a tab shows, by tab instance id, where it is not the tab's own graph. */
  tabs?: Record<string, string>
  /** The order of the profile list, by graph id; profiles not listed follow in creation order. */
  order?: string[]
  /** Each profile's chosen icon: a file name (without `.svg`) in `.valley/assets/icons/grapher-icon/`. */
  icons?: Record<string, string>
  /** The last 2D view (`cx`, `cy`, `scale`) or 3D camera (`yaw`, `pitch`, `range`) of each profile's sheets, by `graph:mode`. */
  cameras?: Record<string, Record<string, number>>
}

/** The graph id of the tab opened without an instance id. */
export const MAIN_GRAPH = 'main'
export const MAX_GRAPHS = 200

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
  const used = new Set(rows.filter(filled).map((row) => row.color))
  const free = COLORS.map(paletteRef).find((color) => !used.has(color))
  return free ?? paletteRef(COLORS[rows.length % COLORS.length])
}

export function createRow(rows: readonly Row[], text = '', range: Partial<Pick<Row, 'from' | 'to' | 'from2' | 'to2' | 'floor'>> = {}): Row {
  return { id: rowId(), text, color: nextColor(rows), hidden: false, from: range.from ?? '', to: range.to ?? '', from2: range.from2 ?? '', to2: range.to2 ?? '', slider: { ...DEFAULT_SLIDER }, ...(range.floor ? { floor: true } : {}) }
}

/** Every sheet ends in one empty row to type into, like a fresh line on paper. */
export function withTrailingRow(rows: readonly Row[]): Row[] {
  const next = [...rows]
  while (next.length > 1 && !filled(next[next.length - 1]) && !filled(next[next.length - 2])) next.pop()
  if (!next.length || filled(next[next.length - 1])) next.push(createRow(next))
  return next
}

function examples(texts: readonly Example[]): Row[] {
  const rows: Row[] = []
  for (const entry of texts) {
    if (typeof entry === 'object' && !Array.isArray(entry)) {
      const { text, ...options } = entry as Exclude<Example, string | readonly string[]>
      rows.push(createRow(rows, text, options))
      continue
    }
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

/** The longest profile name kept. */
export const MAX_NAME = 80

/** Every profile id, `main` first, the others in creation order. */
export function profileIds(document: GrapherDocument): string[] {
  const all = [MAIN_GRAPH, ...Object.keys(document.graphs)]
  const known = new Set(all)
  const ordered = (document.order ?? []).filter((id, index, list) => known.has(id) && list.indexOf(id) === index)
  const placed = new Set(ordered)
  return [...ordered, ...all.filter((id) => !placed.has(id))]
}

/** The profile a tab shows: its chosen profile when that still exists, else its own graph. */
export function profileOf(document: GrapherDocument, tab: string): string {
  const chosen = document.tabs?.[tab]
  return chosen && (chosen === MAIN_GRAPH || document.graphs[chosen]) ? chosen : tab
}

/** The smallest "Graph n" not taken yet, in the given words (`label(n)`). */
export function nextName(document: GrapherDocument, label: (n: number) => string): string {
  const taken = new Set(Object.values(document.names ?? {}))
  let n = 1
  while (taken.has(label(n))) n++
  return label(n)
}

/** Names every profile without one, in order (`main` is Graph 1, then creation order), so older files get profiles. */
export function withNames(document: GrapherDocument, label: (n: number) => string): GrapherDocument {
  const missing = profileIds(document).filter((id) => !document.names?.[id])
  if (!missing.length) return document
  let next: GrapherDocument = { ...document, names: { ...document.names } }
  for (const id of missing) next = { ...next, names: { ...next.names, [id]: nextName(next, label) } }
  return next
}

/**
 * Gives every profile without an icon (or with one the folder no longer holds) the first icon of `order` no other
 * profile uses, so every tab shows an object icon; `available` is the folder's listing, or null before it is known.
 */
export function withIcons(document: GrapherDocument, order: readonly string[], available: ReadonlySet<string> | null): GrapherDocument {
  const icons = { ...document.icons }
  const candidates = available ? order.filter((name) => available.has(name)) : order
  if (!candidates.length) return document
  let changed = false
  profileIds(document).forEach((id, index) => {
    const icon = icons[id]
    if (icon && (!available || available.has(icon))) return
    const used = new Set(Object.entries(icons).filter(([other]) => other !== id).map(([, name]) => name))
    icons[id] = candidates.find((name) => !used.has(name)) ?? candidates[index % candidates.length]
    changed = true
  })
  return changed ? { ...document, icons } : document
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
    ...(typeof record.magnitude === 'boolean' ? { magnitude: record.magnitude } : {}),
    ...(typeof record.levels === 'number' && Number.isInteger(record.levels) && record.levels >= 1 && record.levels <= MAX_LEVELS ? { levels: record.levels } : {}),
    ...(typeof record.step === 'string' && record.step ? { step: text(record.step) } : {}),
    ...(typeof record.labels === 'boolean' ? { labels: record.labels } : {}),
    ...(typeof record.floor === 'boolean' ? { floor: record.floor } : {}),
    ...(typeof record.normal === 'boolean' ? { normal: record.normal } : {}),
    ...readTable(record.table),
    ...(typeof record.connect === 'boolean' ? { connect: record.connect } : {}),
    ...readAnimation(record.animation)
  }
}

function readAnimation(value: unknown): { animation?: Animation } {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const direction = record.direction === 'backward' || record.direction === 'bounce' ? record.direction : 'forward'
  const speed = ANIMATION_SPEEDS.find((candidate) => candidate === record.speed) ?? DEFAULT_ANIMATION.speed
  return { animation: { direction, speed, loop: record.loop !== false } }
}

const CELL_LIMIT = 256

function readTable(value: unknown): { table?: Table } {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const head = Array.isArray(record.head) ? record.head : []
  const cells = Array.isArray(record.cells) ? record.cells : []
  const cell = (entry: unknown): string => (typeof entry === 'string' ? entry.slice(0, CELL_LIMIT) : typeof entry === 'number' && Number.isFinite(entry) ? String(entry) : '')
  return {
    table: {
      head: [text(head[0], 'x').slice(0, CELL_LIMIT), text(head[1], 'y').slice(0, CELL_LIMIT)],
      cells: cells.slice(0, MAX_TABLE_ROWS).map((pair): [string, string] => (Array.isArray(pair) ? [cell(pair[0]), cell(pair[1])] : ['', '']))
    }
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
  const trig = (readRows(sheets.trig) ?? []).filter(filled)
  if (trig.length && trig.map((row) => row.text).join('\n') !== LEGACY_TRIG_EXAMPLES.join('\n')) {
    const ids = new Set(graph.sheets.cartesian.map((row) => row.id))
    const kept = graph.sheets.cartesian.filter(filled)
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
  const record = value as { mode?: unknown; sheets?: unknown; units?: unknown; graphs?: unknown; names?: unknown; tabs?: unknown; icons?: unknown; cameras?: unknown; order?: unknown }
  const stored = (record.graphs && typeof record.graphs === 'object' && !Array.isArray(record.graphs) ? record.graphs : {}) as Record<string, unknown>
  const graphs: Record<string, Graph> = {}
  for (const [id, graph] of Object.entries(stored).slice(0, MAX_GRAPHS)) {
    if (id && id !== MAIN_GRAPH && id.length <= 128 && graph && typeof graph === 'object') graphs[id] = normalizeGraph(graph as Record<string, unknown>)
  }
  const text = (entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 128
  const known = (id: string): boolean => id === MAIN_GRAPH || id in graphs
  const names = Object.fromEntries(Object.entries(record.names && typeof record.names === 'object' ? record.names as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => known(entry[0]) && text(entry[1])).map(([id, name]) => [id, name.trim().slice(0, MAX_NAME)]))
  const tabs = Object.fromEntries(Object.entries(record.tabs && typeof record.tabs === 'object' ? record.tabs as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => text(entry[0]) && text(entry[1]) && known(entry[1])).slice(0, MAX_GRAPHS * 4))
  const icons = Object.fromEntries(Object.entries(record.icons && typeof record.icons === 'object' ? record.icons as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => known(entry[0]) && typeof entry[1] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(entry[1])))
  const cameraFields = (entry: unknown): entry is Record<string, number> => !!entry && typeof entry === 'object' && Object.values(entry).every((field) => typeof field === 'number' && Number.isFinite(field))
    && (['cx', 'cy', 'scale'].every((key) => key in entry) || ['yaw', 'pitch', 'range'].every((key) => key in entry))
  const cameras = Object.fromEntries(Object.entries(record.cameras && typeof record.cameras === 'object' ? record.cameras as Record<string, unknown> : {})
    .filter((entry): entry is [string, Record<string, number>] => known(entry[0].slice(0, entry[0].lastIndexOf(':'))) && MODES.includes(entry[0].slice(entry[0].lastIndexOf(':') + 1) as Mode) && cameraFields(entry[1])))
  const order = Array.isArray(record.order) ? record.order.filter((id): id is string => typeof id === 'string' && known(id)).slice(0, MAX_GRAPHS + 1) : []
  return { version: 1, ...normalizeGraph(record), graphs, ...(order.length ? { order } : {}), ...(Object.keys(names).length ? { names } : {}), ...(Object.keys(tabs).length ? { tabs } : {}), ...(Object.keys(icons).length ? { icons } : {}), ...(Object.keys(cameras).length ? { cameras } : {}) }
}

/** The range variable of a row: θ for polar curves, t for plane and space curves. */
export function rangeVariable(kind: 'polar' | 'curve' | 'curve3'): string {
  return kind === 'polar' ? 'θ' : 't'
}
