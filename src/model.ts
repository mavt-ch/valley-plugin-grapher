import { normalizePaletteValue, paletteRef } from '@valley/plugin-sdk/palette'

/**
 * The coordinate system of a sheet. Each keeps its own rows; trigonometric is Cartesian with π on the x-axis and
 * space is the 3D sheet.
 */
export type Mode = 'cartesian' | 'trig' | 'polar' | 'parametric' | 'space'
export const MODES: readonly Mode[] = ['cartesian', 'trig', 'polar', 'parametric', 'space']
/** The kernel's mode numbers (`plot_analyze`). */
export const MODE_INDEX: Record<Mode, number> = { cartesian: 0, trig: 1, polar: 2, parametric: 3, space: 4 }

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
}

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

function examples(texts: readonly (string | [string, string, string])[]): Row[] {
  const rows: Row[] = []
  for (const entry of texts) {
    const [text, from, to] = typeof entry === 'string' ? [entry, '', ''] : entry
    rows.push(createRow(rows, text, { from, to }))
  }
  return withTrailingRow(rows)
}

export function defaultSheet(mode: Mode): Row[] {
  switch (mode) {
    case 'cartesian': return examples(['y = x^2 - 2', 'y = a x + b', 'a = 1', 'b = 0'])
    case 'trig': return examples(['sin(x)', 'cos(x)', 'y = A sin(k x)', 'A = 2', 'k = 0.5'])
    case 'polar': return examples(['r = 1 + cos(θ)', 'r = 2 sin(3θ)'])
    case 'parametric': return examples(['(cos(3t), sin(2t))', ['(0.2t cos t, 0.2t sin t)', '0', '6π']])
    case 'space': return examples(['z = (x^2 + y^2) / 5 - 6', ['(6cos t, 6sin t, t / 2)', '0', '6π']])
  }
}

export function defaultDocument(): GrapherDocument {
  return { version: 1, mode: 'cartesian', sheets: { cartesian: defaultSheet('cartesian'), trig: defaultSheet('trig'), polar: defaultSheet('polar'), parametric: defaultSheet('parametric'), space: defaultSheet('space') } }
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
  const record = value as { mode?: unknown; sheets?: unknown }
  const sheets = (record.sheets && typeof record.sheets === 'object' ? record.sheets : {}) as Record<string, unknown>
  const document = defaultDocument()
  for (const mode of MODES) {
    const stored = sheets[mode]
    if (!Array.isArray(stored)) continue
    const rows: Row[] = []
    const ids = new Set<string>()
    for (const entry of stored.slice(0, 500)) {
      const row = normalizeRow(entry, rows)
      if (!row) continue
      if (ids.has(row.id)) row.id = rowId()
      ids.add(row.id)
      rows.push(row)
    }
    document.sheets[mode] = withTrailingRow(rows)
  }
  document.mode = MODES.includes(record.mode as Mode) ? (record.mode as Mode) : 'cartesian'
  return document
}

/** The range variable of a row: θ for polar curves, t for plane and space curves. */
export function rangeVariable(kind: 'polar' | 'curve' | 'curve3'): string {
  return kind === 'polar' ? 'θ' : 't'
}
