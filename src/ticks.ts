/**
 * Grid lines and axis labels. Decimal axes step 1, 2 or 5 × 10ⁿ with four or five minor lines between labels;
 * an x-axis in π steps in fractions and multiples of π and labels them exactly (π/2, 3π/2, −2π).
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

/** `2x − y + 3`: terms with their coefficients (1 and −1 written as a bare sign, 0 left out), then the constant. */
export function formatLinear(terms: readonly (readonly [coefficient: number, name: string])[], constant: number, digits = 4): string {
  const parts: string[] = []
  const add = (value: number, name: string): void => {
    const magnitude = formatNumber(Math.abs(value), digits)
    if (magnitude === '0' && (name || parts.length)) return
    const text = name && magnitude === '1' ? name : `${magnitude}${name}`
    parts.push(parts.length ? `${value < 0 ? MINUS : '+'} ${text}` : `${value < 0 && magnitude !== '0' ? MINUS : ''}${text}`)
  }
  for (const [coefficient, name] of terms) add(coefficient, name)
  add(constant, '')
  return parts.join(' ')
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

const near = (value: number, scale: number): boolean => Math.abs(value) < 1e-12 * Math.max(1, Math.abs(scale))

/** A complex number in rectangular form: `3 + 2i`, `−i`, `0.5 − 1.25i`, `4`. */
export function formatComplex(re: number, im: number, digits = 4): string {
  const real = near(re, im) ? 0 : re
  const imag = near(im, re) ? 0 : im
  if (imag === 0) return formatNumber(real, digits)
  const imaginary = `${Math.abs(imag) === 1 ? '' : formatNumber(Math.abs(imag), digits)}i`
  if (real === 0) return imag < 0 ? `${MINUS}${imaginary}` : imaginary
  return `${formatNumber(real, digits)} ${imag < 0 ? MINUS : '+'} ${imaginary}`
}

/** Polar (Euler) form `r·e^(iθ)`, with θ as a fraction of π when it is one: `2·e^(iπ/3)`, `e^(−iπ/2)`. */
export function formatPolar(re: number, im: number, digits = 4): string {
  const r = Math.hypot(re, im)
  if (!Number.isFinite(r)) return formatNumber(r, digits)
  if (r === 0) return '0'
  const theta = Math.atan2(im + 0, re)
  let angle: string | null = null
  for (let denominator = 1; denominator <= 12 && angle === null; denominator++) {
    const numerator = (theta / Math.PI) * denominator
    if (Math.abs(numerator - Math.round(numerator)) < 1e-9) angle = formatPi(Math.round(numerator), denominator)
  }
  if (angle === '0') return formatNumber(r, digits)
  const negative = angle ? angle.startsWith(MINUS) : theta < 0
  const body = angle ? `i${negative ? angle.slice(1) : angle}` : `${formatNumber(Math.abs(theta), digits)}i`
  const modulus = Math.abs(r - 1) < 1e-12 ? '' : `${formatNumber(r, digits)}·`
  return `${modulus}e^(${negative ? MINUS : ''}${body})`
}

/** An imaginary-axis tick: `i`, `−i`, `2i`, `0.5i`. */
export function formatImaginary(text: string): string {
  if (text === '1') return 'i'
  if (text === `${MINUS}1`) return `${MINUS}i`
  return `${text}i`
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

/**
 * Labels in multiples of π for an axis from −range to range, about as far apart as `spacing` (the decimal labels'
 * step); the 3D view places them along its projected axes.
 */
export function piTicks(range: number, spacing: number): AxisLabel[] {
  const choice = PI_STEPS.find(([n, d]) => (n / d) * Math.PI >= spacing * 0.6) ?? PI_STEPS[PI_STEPS.length - 1]
  const [n, d] = choice
  const step = (n / d) * Math.PI
  const count = Math.floor(range / step + 1e-9)
  if (count > 200) return []
  const labels: AxisLabel[] = []
  for (let k = -count; k <= count; k++) if (k !== 0) labels.push({ value: k * step, text: formatPi(k * n, d) })
  return labels
}

/** Label steps in degrees with the minor divisions between labels. */
const DEGREE_STEPS: readonly [number, number][] = [
  [1, 5], [5, 5], [15, 3], [30, 3], [45, 3], [90, 3], [180, 4], [360, 4], [720, 4], [1800, 5], [3600, 4], [9000, 5], [18000, 5]
]

/** A whole number of degrees as text: `0°`, `90°`, `−180°`, `1080°`. */
export function formatDegrees(degrees: number): string {
  const rounded = Math.round(degrees * 1e6) / 1e6
  if (rounded === 0) return '0°'
  return `${rounded < 0 ? MINUS : ''}${formatNumber(Math.abs(rounded), 6)}°`
}

/** An axis whose values are radians, labelled in degrees (90° at π/2, 180° at π). */
export function degreeAxis(lo: number, hi: number, scale: number): Axis {
  const perDegree = Math.PI / 180
  const choice = DEGREE_STEPS.find(([degrees]) => degrees * perDegree * scale >= MIN_LABEL_PX)
  // Far in, 1° labels are too sparse to read a position from; far out, they are just big numbers.
  if (!choice || (choice === DEGREE_STEPS[0] && perDegree * scale > 6 * MIN_LABEL_PX)) return decimalAxis(lo, hi, scale)
  const [degrees, divisions] = choice
  const step = degrees * perDegree
  const grid = lines(lo, hi, step / divisions, divisions)
  const labels: AxisLabel[] = []
  for (const line of grid) {
    if (!line.major) continue
    const k = Math.round(line.value / step)
    if (k !== 0) labels.push({ value: line.value, text: formatDegrees(k * degrees) })
  }
  return { lines: grid, labels, step }
}

/** Degree labels for an axis from −range to range, about as far apart as `spacing`; the 3D view places them. */
export function degreeTicks(range: number, spacing: number): AxisLabel[] {
  const perDegree = Math.PI / 180
  const [degrees] = DEGREE_STEPS.find(([candidate]) => candidate * perDegree >= spacing * 0.6) ?? DEGREE_STEPS[DEGREE_STEPS.length - 1]
  const step = degrees * perDegree
  const count = Math.floor(range / step + 1e-9)
  if (count > 200) return []
  const labels: AxisLabel[] = []
  for (let k = -count; k <= count; k++) if (k !== 0) labels.push({ value: k * step, text: formatDegrees(k * degrees) })
  return labels
}

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }

/** A number in scientific notation: `5·10⁻¹`, `10³`, `−2.5·10⁴`, `0`, and `2` for `2·10⁰`; `digits` bounds the mantissa's decimals. */
export function formatScientific(value: number, digits = 3): string {
  if (!Number.isFinite(value) || value === 0) return formatNumber(value)
  let exponent = Math.floor(Math.log10(Math.abs(value)))
  let mantissa = Number((Math.abs(value) / 10 ** exponent).toFixed(digits))
  if (mantissa >= 10) { mantissa /= 10; exponent += 1 }
  if (exponent === 0) return formatNumber(value < 0 ? -mantissa : mantissa, digits)
  const power = `10${String(exponent).split('').map((char) => SUPERSCRIPT[char]).join('')}`
  return `${value < 0 ? MINUS : ''}${mantissa === 1 ? '' : `${formatNumber(mantissa, digits)}·`}${power}`
}

/** Decimal grid lines with every label in scientific notation. */
export function scientificAxis(lo: number, hi: number, scale: number): Axis {
  const axis = decimalAxis(lo, hi, scale)
  return { ...axis, labels: axis.labels.map((label) => ({ ...label, text: formatScientific(label.value) })) }
}

/** Decades between labels on a logarithmic axis, and the multiples of 10ⁿ labelled between decades when it is wide. */
const DECADE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const

/**
 * A logarithmic axis between the axis coordinates `lo` and `hi` (base-10 logarithms) at `pixels` per decade: a major line
 * at every labelled decade, minor lines at the other decades or, while a decade is wide enough, at its 2 to 9 multiples;
 * far in, the 2 and 5 multiples (then all of them) are labelled too. Line values are the axis's own values (10ⁿ).
 */
export function logAxis(lo: number, hi: number, pixels: number): Axis {
  if (!(hi > lo) || !(pixels > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return { lines: [], labels: [], step: 1 }
  const every = DECADE_STEPS.find((step) => step * pixels >= MIN_LABEL_PX) ?? DECADE_STEPS[DECADE_STEPS.length - 1]
  const first = Math.floor(lo)
  const last = Math.ceil(hi)
  if (last - first > MAX_LINES * every) return { lines: [], labels: [], step: every }
  const multiples = pixels >= 40 && every === 1
  const labelled = pixels >= 6 * MIN_LABEL_PX ? [2, 3, 4, 5, 6, 7, 8, 9] : pixels >= 3 * MIN_LABEL_PX ? [2, 5] : []
  const lines: GridLine[] = []
  const labels: AxisLabel[] = []
  const inside = (coordinate: number): boolean => coordinate >= lo && coordinate <= hi
  for (let k = first; k <= last; k++) {
    const decade = 10 ** k
    if (inside(k)) {
      const major = k % every === 0
      lines.push({ value: decade, major })
      if (major) labels.push({ value: decade, text: formatScientific(decade) })
    }
    if (!multiples) continue
    for (let m = 2; m <= 9; m++) {
      const coordinate = k + Math.log10(m)
      if (!inside(coordinate)) continue
      lines.push({ value: m * decade, major: false })
      if (labelled.includes(m)) labels.push({ value: m * decade, text: formatScientific(m * decade) })
    }
  }
  return { lines, labels, step: every }
}
