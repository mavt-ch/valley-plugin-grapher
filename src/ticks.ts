/**
 * Grid lines and axis labels. Decimal axes step 1, 2 or 5 × 10ⁿ with four or five minor lines between labels;
 * the trigonometric x-axis steps in fractions and multiples of π and labels them exactly (π/2, 3π/2, −2π).
 */

export interface GridLine {
  value: number
  major: boolean
}

export interface AxisLabel {
  value: number
  text: string
}

export interface Axis {
  lines: GridLine[]
  labels: AxisLabel[]
  /** Distance between labelled lines. */
  step: number
}

const MIN_LABEL_PX = 60
const MAX_LINES = 1500
const MINUS = '−'

export function decimalStep(scale: number, minPx = MIN_LABEL_PX): { major: number; divisions: number } {
  const raw = minPx / scale
  const base = 10 ** Math.floor(Math.log10(raw))
  const ratio = raw / base
  const multiple = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10
  return { major: multiple * base, divisions: multiple === 2 ? 4 : 5 }
}

/** A tidy number for labels and readouts: up to `digits` decimals, exponent form when very large or small. */
export function formatNumber(value: number, digits = 4): string {
  if (Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : `${MINUS}∞`
  const magnitude = Math.abs(value)
  let text: string
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-4)) {
    const [mantissa, exponent] = Number(magnitude.toPrecision(Math.max(1, digits))).toExponential().split('e')
    text = `${Number(Number(mantissa).toFixed(digits))}e${Number(exponent)}`
  } else {
    text = String(Number(magnitude.toFixed(digits)))
  }
  return value < 0 && text !== '0' ? `${MINUS}${text}` : text
}

function labelDigits(step: number): number {
  return Math.max(0, Math.min(12, -Math.floor(Math.log10(step) + 1e-9)))
}

function lines(lo: number, hi: number, minor: number, divisions: number): GridLine[] {
  if (!(hi > lo) || !(minor > 0)) return []
  const first = Math.ceil(lo / minor)
  const last = Math.floor(hi / minor)
  const dense = last - first > MAX_LINES
  const result: GridLine[] = []
  for (let k = first; k <= last; k++) {
    const major = k % divisions === 0
    if (dense && !major) continue
    result.push({ value: k * minor, major })
  }
  return result
}

export function decimalAxis(lo: number, hi: number, scale: number): Axis {
  const { major, divisions } = decimalStep(scale)
  const grid = lines(lo, hi, major / divisions, divisions)
  const digits = labelDigits(major)
  const labels = grid
    .filter((line) => line.major && Math.abs(line.value) > major / 1e6)
    .map((line) => ({ value: line.value, text: formatNumber(line.value, digits) }))
  return { lines: grid, labels, step: major }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** `n/d · π` as text: `0`, `π`, `−π/2`, `3π/4`, `2π`. */
export function formatPi(numerator: number, denominator: number): string {
  if (numerator === 0) return '0'
  const divisor = gcd(Math.abs(numerator), denominator)
  const n = Math.abs(numerator) / divisor
  const d = denominator / divisor
  const sign = numerator < 0 ? MINUS : ''
  const coefficient = n === 1 ? '' : String(n)
  return d === 1 ? `${sign}${coefficient}π` : `${sign}${coefficient}π/${d}`
}

/** Label steps as (numerator, denominator) of π with the minor divisions between labels. */
const PI_STEPS: readonly [number, number, number][] = [
  [1, 12, 1], [1, 6, 2], [1, 4, 2], [1, 2, 4], [1, 1, 4], [2, 1, 4], [5, 1, 5], [10, 1, 5], [20, 1, 4], [50, 1, 5], [100, 1, 5]
]

export function piAxis(lo: number, hi: number, scale: number): Axis {
  const choice = PI_STEPS.find(([n, d]) => (n / d) * Math.PI * scale >= MIN_LABEL_PX)
  // Far in, π/12 labels are too sparse to read a position from; far out, they are just big numbers.
  if (!choice || (choice === PI_STEPS[0] && (Math.PI / 12) * scale > 6 * MIN_LABEL_PX)) return decimalAxis(lo, hi, scale)
  const [n, d, divisions] = choice
  const step = (n / d) * Math.PI
  const grid = lines(lo, hi, step / divisions, divisions)
  const labels: AxisLabel[] = []
  for (const line of grid) {
    if (!line.major) continue
    const k = Math.round(line.value / step)
    if (k !== 0) labels.push({ value: line.value, text: formatPi(k * n, d) })
  }
  return { lines: grid, labels, step }
}
