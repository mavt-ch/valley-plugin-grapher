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
  /** Range of θ or t for polar and parametric rows; empty means 0 and 2π. */
  from: string
  to: string
  slider: Slider
}

export interface GrapherDocument {
  version: 1
  mode: Mode
  sheets: Record<Mode, Row[]>
  /** Axis labels chosen with the header switch, per plane view; a view not listed uses its own default. */
  units: Partial<Record<Mode, AxisUnits>>
}

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

export function createRow(rows: readonly Row[], text = '', range: Partial<Pick<Row, 'from' | 'to'>> = {}): Row {
  return { id: rowId(), text, color: nextColor(rows), hidden: false, from: range.from ?? '', to: range.to ?? '', slider: { ...DEFAULT_SLIDER } }
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
    const [text, from, to] = typeof entry === 'string' ? [entry, '', ''] : entry
    rows.push(createRow(rows, text, { from, to }))
  }
  return withTrailingRow(rows)
}

export function defaultSheet(mode: Mode): Row[] {
  return examples(viewOf(mode).examples)
}

export function defaultDocument(): GrapherDocument {
  return { version: 1, mode: 'cartesian', sheets: Object.fromEntries(MODES.map((mode) => [mode, defaultSheet(mode)])) as Record<Mode, Row[]>, units: {} }
}

/** The axis labels a plane view shows: the user's choice, else the view's default; 3D views have none. */
export function unitsOf(document: GrapherDocument, mode: Mode): AxisUnits | null {
  const view = viewOf(mode)
  return view.canvas === 'plane' ? document.units[mode] ?? view.units : null
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
    slider: min < max && step > 0 ? { min, max, step } : { ...DEFAULT_SLIDER }
  }
}

/** Reads a stored `graphs.json`; throws when it is not a Grapher document, so the caller never overwrites it. */
export function normalizeDocument(value: unknown): GrapherDocument {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) throw new Error('graphs.json is not a Grapher document (version 1).')
  const record = value as { mode?: unknown; sheets?: unknown; units?: unknown }
  const sheets = (record.sheets && typeof record.sheets === 'object' ? record.sheets : {}) as Record<string, unknown>
  const document = defaultDocument()
  const readRows = (stored: unknown): Row[] | null => {
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
  for (const mode of MODES) {
    const rows = readRows(sheets[mode])
    if (rows) document.sheets[mode] = withTrailingRow(rows)
  }
  const units = (record.units && typeof record.units === 'object' ? record.units : {}) as Record<string, unknown>
  for (const mode of MODES) {
    if (units[mode] === 'decimal' || units[mode] === 'pi') document.units[mode] = units[mode]
  }
  // The trigonometric sheet is now the Cartesian one with π axes: its own rows join Cartesian, its examples do not.
  const trig = (readRows(sheets.trig) ?? []).filter((row) => row.text.trim())
  if (trig.length && trig.map((row) => row.text).join('\n') !== LEGACY_TRIG_EXAMPLES.join('\n')) {
    const ids = new Set(document.sheets.cartesian.map((row) => row.id))
    const kept = document.sheets.cartesian.filter((row) => row.text.trim())
    document.sheets.cartesian = withTrailingRow([...kept, ...trig.map((row) => (ids.has(row.id) ? { ...row, id: rowId() } : row))])
  }
  if (record.mode === 'trig') {
    document.mode = 'cartesian'
    document.units.cartesian ??= 'pi'
  } else {
    document.mode = MODES.includes(record.mode as Mode) ? (record.mode as Mode) : 'cartesian'
  }
  return document
}

/** The range variable of a row: θ for polar curves, t for plane and space curves. */
export function rangeVariable(kind: 'polar' | 'curve' | 'curve3'): string {
  return kind === 'polar' ? 'θ' : 't'
}
