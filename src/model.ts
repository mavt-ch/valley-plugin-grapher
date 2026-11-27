import { normalizePaletteValue, paletteRef } from '@valley/plugin-sdk/palette'
import { AXIS_UNITS } from './draw'
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
  /** Vector fields: let the arrows drift along the field (added later: absent means still). */
  flow?: boolean
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

/** A row with something in it: text or a table (even an empty one). */
export const filled = (row: Row): boolean => row.table !== undefined || row.text.trim() !== ''

/** A fresh table: columns x and y and three rows to fill. */
export function createTable(): Table {
  return { head: ['x', 'y'], cells: [['', ''], ['', ''], ['', '']] }
}

/** The most level curves a row may ask for, and the count it draws when it does not say. */
export const MAX_LEVELS = 50
export const DEFAULT_LEVELS = 10

/** A bookmark group; a subgroup names its top-level group in `parent` (one level deep, never a third). */
export interface BookmarkGroup {
  id: string
  name: string
  parent?: string
  /** Closed in the bookmark list (absent means open). */
  collapsed?: boolean
  /** The folder's notes, as written (shown in Properties → Notes). */
  note?: string
}

/** A saved copy of an expression row and the view it was written for; it stays when the row is deleted from a graph. */
export interface Bookmark {
  id: string
  mode: Mode
  row: Row
  /** The definitions the expression reads (sliders such as `m = 1`, functions such as `f(x) = …`), saved with it so
   * it draws on its own; absent when it reads none. */
  needs?: Row[]
  /** The group (or subgroup) it is filed in; absent means the top level. */
  group?: string
}

/** Every bookmark of the realm, shared by all graphs; the arrays' order is the list's order. */
export interface Bookmarks {
  groups: BookmarkGroup[]
  items: Bookmark[]
}

/**
 * What a graph shows while its bookmark list is open, kept apart from its expressions: the view chosen there and the
 * bookmarks picked to be shown (each view draws the picked bookmarks written for it).
 */
export interface BookmarkView {
  mode: Mode
  shown: string[]
}

export const MAX_BOOKMARKS = 500
/** The most definitions one bookmark keeps. */
export const MAX_BOOKMARK_NEEDS = 50
export const MAX_BOOKMARK_GROUPS = 200
export const BOOKMARK_GROUP_NAME_MAX = 60

/** One graph: what a single Grapher tab shows and the sidebar edits while that tab is focused. */
export interface Graph {
  mode: Mode
  sheets: Record<Mode, Row[]>
  /** Axis labels chosen with the header switch, per plane view; a view not listed uses its own default. */
  units: Partial<Record<Mode, AxisUnits>>
  /** Logarithmic axes chosen in the header's scale menu, per view that offers them; a view not listed is linear. */
  scales?: Partial<Record<Mode, AxisScale>>
}

/** Linear axes, a logarithmic x- or y-axis (semi-log) or both (log–log). */
export type AxisScale = 'linear' | 'log-x' | 'log-y' | 'log'
export const AXIS_SCALES: readonly AxisScale[] = ['linear', 'log-y', 'log-x', 'log']
/** A scale as the kernel's axes bits: 1 for a logarithmic x-axis, 2 for y. */
export const SCALE_AXES: Record<AxisScale, number> = { linear: 0, 'log-x': 1, 'log-y': 2, log: 3 }

/** The main graph sits at the top level (the tab opened without an instance); every other tab keeps its own in `graphs`. */
export interface GrapherDocument extends Graph {
  version: 1
  graphs: Record<string, Graph>
  /** The graph a tab shows, by tab instance id, where it is not the tab's own graph (tabs opened while graphs could be
   * picked per tab; read so they keep showing it, never written anew). */
  tabs?: Record<string, string>
  /** Each graph's Markdown note, as written. */
  notes?: Record<string, string>
  /** The last 2D view (`cx`, `cy`, `scale`) or 3D camera (`yaw`, `pitch`, `range`) of each graph's sheets, by `graph:mode`. */
  cameras?: Record<string, Record<string, number>>
  /** Bookmarked expressions in groups and subgroups (added later: a file without it gets the example bookmarks). */
  bookmarks?: Bookmarks
  /** Each graph's bookmark view (see {@link BookmarkView}), by graph id. */
  bookmarkViews?: Record<string, BookmarkView>
}

/** The graph id of the tab opened without an instance id. */
export const MAIN_GRAPH = 'main'
export const MAX_GRAPHS = 200

/** The rows a fresh trigonometric sheet had before it became Cartesian with π axes. */
const LEGACY_TRIG_EXAMPLES = ['sin(x)', 'cos(x)', 'y = A sin(k x)', 'A = 2', 'k = 0.5']

export const COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'magenta', 'cyan'] as const
/** The most palette colours the colour order keeps. */
export const MAX_COLORS = 64

let order: readonly string[] = COLORS

/** The palette colour ids new rows take, in order (Settings → Grapher → Colours; the default is {@link COLORS}). */
export function colorOrder(): readonly string[] {
  return order
}

/** Reads a saved colour order: palette ids, each once; anything else (or an empty list) is the default order. */
export function readColorOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [...COLORS]
  const ids = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && /^[a-z0-9-]{1,64}$/.test(entry)))].slice(0, MAX_COLORS)
  return ids.length ? ids : [...COLORS]
}

export function setColorOrder(value: unknown): void {
  order = readColorOrder(value)
}
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
  const free = order.map(paletteRef).find((color) => !used.has(color))
  return free ?? paletteRef(order[rows.length % order.length])
}

export function createRow(rows: readonly Row[], text = '', range: Partial<Pick<Row, 'from' | 'to' | 'from2' | 'to2' | 'floor'>> = {}): Row {
  return { id: rowId(), text, color: nextColor(rows), hidden: false, from: range.from ?? '', to: range.to ?? '', from2: range.from2 ?? '', to2: range.to2 ?? '', slider: { ...DEFAULT_SLIDER }, ...(range.floor ? { floor: true } : {}) }
}

/** Every sheet ends in one empty row to type into, like a fresh line on paper. */
export function withTrailingRow(rows: readonly Row[]): Row[] {
  const next = [...rows]
  const loose = (row: Row | undefined): boolean => row !== undefined && !filled(row)
  while (next.length > 1 && loose(next[next.length - 1]) && loose(next[next.length - 2])) next.pop()
  if (!loose(next[next.length - 1])) next.push(createRow(next))
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

/** The longest note kept, in characters. */
export const MAX_NOTE = 200_000

/** Every stored graph id, `main` first. */
export function graphIds(document: GrapherDocument): string[] {
  return [MAIN_GRAPH, ...Object.keys(document.graphs)]
}

/** The graph a tab shows: the one an older tab was pointed at while that still exists, else the tab's own. */
export function graphIdOf(document: GrapherDocument, tab: string): string {
  const chosen = document.tabs?.[tab]
  return chosen && (chosen === MAIN_GRAPH || document.graphs[chosen]) ? chosen : tab
}

/** Replaces one graph and leaves every other tab's graph as it was. */
export function withGraph(document: GrapherDocument, id: string, graph: Graph): GrapherDocument {
  const { mode, sheets, units, scales } = graph
  const own = { mode, sheets, units, ...(scales && Object.keys(scales).length ? { scales } : {}) }
  if (id !== MAIN_GRAPH) return { ...document, graphs: { ...document.graphs, [id]: own } }
  const { scales: _previous, ...rest } = document
  return { ...rest, ...own }
}

/** The axis labels a view shows: the user's choice, else the view's default (decimal for 3D views). */
export function unitsOf(graph: Graph, mode: Mode): AxisUnits {
  const view = viewOf(mode)
  return graph.units[mode] ?? (view.canvas === 'plane' ? view.units : 'decimal')
}

/** The axis scale a view shows: the user's choice where the view offers logarithmic axes, else linear. */
export function scaleOf(graph: Graph, mode: Mode): AxisScale {
  const view = viewOf(mode)
  return view.canvas === 'plane' && view.logAxes ? graph.scales?.[mode] ?? 'linear' : 'linear'
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
    ...(record.flow === true ? { flow: true } : {}),
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

/**
 * Expression folders are gone: a file from before keeps every expression in its place on the top level, an expression of
 * a hidden folder stays hidden, and the folder rows themselves (only a name) are dropped.
 */
function withoutFolders(stored: readonly unknown[]): unknown[] {
  const hidden = new Set<unknown>()
  const kept: unknown[] = []
  for (const entry of stored) {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
    if (record?.folder && typeof record.folder === 'object') {
      if (record.hidden === true) hidden.add(record.id)
      continue
    }
    kept.push(record && record.parent !== undefined && hidden.has(record.parent) ? { ...record, hidden: true } : entry)
  }
  return kept
}

export function readRows(stored: unknown): Row[] | null {
  if (!Array.isArray(stored)) return null
  const rows: Row[] = []
  const ids = new Set<string>()
  for (const entry of withoutFolders(stored.slice(0, 500))) {
    const row = normalizeRow(entry, rows)
    if (!row) continue
    if (ids.has(row.id)) row.id = rowId()
    ids.add(row.id)
    rows.push(row)
  }
  return rows
}

function normalizeGraph(record: { mode?: unknown; sheets?: unknown; units?: unknown; scales?: unknown }): Graph {
  const sheets = (record.sheets && typeof record.sheets === 'object' ? record.sheets : {}) as Record<string, unknown>
  const graph = defaultGraph()
  for (const mode of MODES) {
    const rows = readRows(sheets[mode])
    if (rows) graph.sheets[mode] = withTrailingRow(rows)
  }
  const units = (record.units && typeof record.units === 'object' ? record.units : {}) as Record<string, unknown>
  for (const mode of MODES) {
    if (AXIS_UNITS.includes(units[mode] as AxisUnits)) graph.units[mode] = units[mode] as AxisUnits
  }
  const scales = (record.scales && typeof record.scales === 'object' ? record.scales : {}) as Record<string, unknown>
  for (const mode of MODES) {
    const scale = scales[mode] as AxisScale
    const view = viewOf(mode)
    if (scale !== 'linear' && AXIS_SCALES.includes(scale) && view.canvas === 'plane' && view.logAxes) graph.scales = { ...graph.scales, [mode]: scale }
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

/** Reads the saved bookmarks: unnamed, duplicate or excess entries are dropped, a subgroup whose group is missing (or is
 * itself a subgroup) moves to the top level, and a bookmark filed in a missing group too. */
export function normalizeBookmarks(value: unknown): Bookmarks | null {
  if (!value || typeof value !== 'object') return null
  const record = value as { groups?: unknown; items?: unknown }
  const groups: BookmarkGroup[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(record.groups) ? record.groups : []) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, parent, collapsed, note } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id || id.length > 128 || seen.has(id) || typeof name !== 'string') continue
    seen.add(id)
    groups.push({
      id,
      name: name.slice(0, BOOKMARK_GROUP_NAME_MAX),
      ...(typeof parent === 'string' && parent ? { parent } : {}),
      ...(collapsed === true ? { collapsed: true } : {}),
      ...(typeof note === 'string' && note ? { note: note.slice(0, MAX_NOTE) } : {})
    })
    if (groups.length >= MAX_BOOKMARK_GROUPS) break
  }
  const top = new Set(groups.filter((group) => !group.parent).map((group) => group.id))
  const tree = groups.map((group) => {
    if (!group.parent || (top.has(group.parent) && group.parent !== group.id)) return group
    const { parent: _, ...rest } = group
    return rest
  })
  const known = new Set(tree.map((group) => group.id))
  const items: Bookmark[] = []
  const ids = new Set<string>()
  for (const entry of Array.isArray(record.items) ? record.items : []) {
    if (!entry || typeof entry !== 'object') continue
    const { id, mode, row, needs, group } = entry as Record<string, unknown>
    const read = readRows([row])?.[0]
    if (typeof id !== 'string' || !id || id.length > 128 || ids.has(id) || !MODES.includes(mode as Mode) || !read || !filled(read)) continue
    ids.add(id)
    const definitions = (readRows(Array.isArray(needs) ? needs.slice(0, MAX_BOOKMARK_NEEDS) : []) ?? []).filter(filled).map((need) => ({ ...need, hidden: false }))
    items.push({ id, mode: mode as Mode, row: { ...read, hidden: false }, ...(definitions.length ? { needs: definitions } : {}), ...(typeof group === 'string' && known.has(group) ? { group } : {}) })
    if (items.length >= MAX_BOOKMARKS) break
  }
  return { groups: tree, items }
}

/** Reads a stored `graphs.json`; throws when it is not a Grapher document, so the caller never overwrites it. */
export function normalizeDocument(value: unknown): GrapherDocument {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('graphs.json is not a Grapher document (version 1).')
  const record = value as { mode?: unknown; sheets?: unknown; units?: unknown; scales?: unknown; graphs?: unknown; tabs?: unknown; cameras?: unknown; notes?: unknown; bookmarks?: unknown; bookmarkViews?: unknown }
  const stored = (record.graphs && typeof record.graphs === 'object' && !Array.isArray(record.graphs) ? record.graphs : {}) as Record<string, unknown>
  const graphs: Record<string, Graph> = {}
  for (const [id, graph] of Object.entries(stored).slice(0, MAX_GRAPHS)) {
    if (id && id !== MAIN_GRAPH && id.length <= 128 && graph && typeof graph === 'object') graphs[id] = normalizeGraph(graph as Record<string, unknown>)
  }
  const text = (entry: unknown): entry is string => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 128
  const known = (id: string): boolean => id === MAIN_GRAPH || id in graphs
  const tabs = Object.fromEntries(Object.entries(record.tabs && typeof record.tabs === 'object' ? record.tabs as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => text(entry[0]) && text(entry[1]) && known(entry[1])).slice(0, MAX_GRAPHS * 4))
  const cameraFields = (entry: unknown): entry is Record<string, number> => !!entry && typeof entry === 'object' && Object.values(entry).every((field) => typeof field === 'number' && Number.isFinite(field))
    && (['cx', 'cy', 'scale'].every((key) => key in entry) || ['yaw', 'pitch', 'range'].every((key) => key in entry))
  const cameras = Object.fromEntries(Object.entries(record.cameras && typeof record.cameras === 'object' ? record.cameras as Record<string, unknown> : {})
    .filter((entry): entry is [string, Record<string, number>] => known(entry[0].slice(0, entry[0].lastIndexOf(':'))) && MODES.includes(entry[0].slice(entry[0].lastIndexOf(':') + 1) as Mode) && cameraFields(entry[1])))
  const bookmarks = normalizeBookmarks(record.bookmarks)
  const notes = Object.fromEntries(Object.entries(record.notes && typeof record.notes === 'object' ? record.notes as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => known(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '' && entry[1].length <= MAX_NOTE))
  const items = new Set(bookmarks?.items.map((item) => item.id) ?? [])
  const bookmarkViews: Record<string, BookmarkView> = {}
  for (const [id, entry] of Object.entries(record.bookmarkViews && typeof record.bookmarkViews === 'object' ? record.bookmarkViews as Record<string, unknown> : {})) {
    if (!known(id) || !entry || typeof entry !== 'object') continue
    const { mode, shown } = entry as Record<string, unknown>
    if (!MODES.includes(mode as Mode)) continue
    bookmarkViews[id] = { mode: mode as Mode, shown: [...new Set(Array.isArray(shown) ? shown.filter((item): item is string => typeof item === 'string' && items.has(item)) : [])] }
  }
  return { version: 1, ...normalizeGraph(record), graphs, ...(Object.keys(notes).length ? { notes } : {}), ...(Object.keys(tabs).length ? { tabs } : {}), ...(Object.keys(cameras).length ? { cameras } : {}), ...(bookmarks ? { bookmarks } : {}), ...(Object.keys(bookmarkViews).length ? { bookmarkViews } : {}) }
}

/** The range variable of a row: θ for polar curves, t for plane and space curves. */
export function rangeVariable(kind: 'polar' | 'curve' | 'curve3'): string {
  return kind === 'polar' ? 'θ' : 't'
}
