import { readPaletteColor } from '@valley/plugin-sdk/palette'
import type { SamplePath, Viewport } from './engine'
import { decimalAxis, formatComplex, formatImaginary, formatNumber, piAxis, type Axis } from './ticks'

/** Values per sampled point in the kernel's path stream: screen x, screen y, world x, world y, parameter. */
export const STRIDE = 5

export interface Size {
  width: number
  height: number
}

export interface Theme {
  background: string
  minor: string
  major: string
  axis: string
  label: string
  font: string
}

/** What the pointer rests on: a point of a row's graph, in screen and world coordinates. */
export interface Hover {
  row: number
  sx: number
  sy: number
  wx: number
  wy: number
  /** The range variable at the point, for polar and parametric rows. */
  parameter: { name: string; value: number } | null
  /** What the point is, for a marker (“Zero”, “Maximum” …). */
  label?: string
}

/** A marker on a curve at screen (sx, sy): a zero, an extremum or an intersection (see `engine.ts`). */
export interface ShownMarker {
  sx: number
  sy: number
  pinned: boolean
}

/** Markers are small neutral dots with a ring of the background, so they read on any curve colour. */
export function drawMarkers(ctx: CanvasRenderingContext2D, markers: readonly ShownMarker[], theme: Theme): void {
  for (const marker of markers) {
    ctx.beginPath()
    ctx.arc(clamp(marker.sx), clamp(marker.sy), marker.pinned ? 4 : 3.5, 0, Math.PI * 2)
    ctx.fillStyle = marker.pinned ? theme.axis : theme.label
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = theme.background
    ctx.stroke()
  }
}

/** A readout box beside the point (sx, sy): above and to the right, flipped to stay inside the view. */
export function drawLabel(ctx: CanvasRenderingContext2D, sx: number, sy: number, lines: readonly string[], size: Size, theme: Theme): void {
  ctx.font = theme.font
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 12
  const height = lines.length * 15 + 7
  let x = sx + 10
  let y = sy - height - 8
  if (x + width > size.width - 4) x = sx - width - 10
  if (y < 4) y = sy + 10
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 4)
  ctx.fillStyle = theme.background
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.major
  ctx.stroke()
  ctx.fillStyle = theme.label
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, x + 6, y + 4 + index * 15))
}

/** The coordinates of a point as the readout writes them. */
export const formatPoint = (x: number, y: number): string => `(${formatNumber(x)}, ${formatNumber(y)})`

// Canvas coordinates far outside the view are clamped; Chromium drops paths with huge coordinates.
const CLAMP = 1e5
export const clamp = (value: number): number => Math.max(-CLAMP, Math.min(CLAMP, value))

export const toScreenX = (view: Viewport, size: Size, x: number): number => (x - view.cx) * view.scale + size.width / 2
export const toScreenY = (view: Viewport, size: Size, y: number): number => size.height / 2 - (y - view.cy) * view.scale
export const toWorldX = (view: Viewport, size: Size, sx: number): number => (sx - size.width / 2) / view.scale + view.cx
export const toWorldY = (view: Viewport, size: Size, sy: number): number => view.cy - (sy - size.height / 2) / view.scale

/** Colours come from the app's design tokens, read at draw time so a theme change repaints correctly. */
export function readTheme(element: HTMLElement): Theme {
  const styles = getComputedStyle(element)
  const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback
  const family = styles.fontFamily || 'system-ui, sans-serif'
  return {
    background: token('--surface-color-alt', '#1e1e1e'),
    minor: token('--border-light', 'rgba(128,128,128,0.15)'),
    major: token('--border-medium', 'rgba(128,128,128,0.3)'),
    axis: token('--text-secondary', '#888'),
    label: token('--text-secondary', '#888'),
    font: `11px ${family}`
  }
}

export const colorOf = (color: string): string => readPaletteColor(color)

function crisp(value: number): number {
  return Math.round(value) + 0.5
}

function verticals(ctx: CanvasRenderingContext2D, axis: Axis, view: Viewport, size: Size, major: boolean): void {
  ctx.beginPath()
  for (const line of axis.lines) {
    if (line.major !== major || line.value === 0) continue
    const x = crisp(toScreenX(view, size, line.value))
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size.height)
  }
  ctx.stroke()
}

function horizontals(ctx: CanvasRenderingContext2D, axis: Axis, view: Viewport, size: Size, major: boolean): void {
  ctx.beginPath()
  for (const line of axis.lines) {
    if (line.major !== major || line.value === 0) continue
    const y = crisp(toScreenY(view, size, line.value))
    ctx.moveTo(0, y)
    ctx.lineTo(size.width, y)
  }
  ctx.stroke()
}

export function haloText(ctx: CanvasRenderingContext2D, theme: Theme, text: string, x: number, y: number): void {
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.background
  ctx.strokeText(text, x, y)
  ctx.fillStyle = theme.label
  ctx.fillText(text, x, y)
}

export function axes(ctx: CanvasRenderingContext2D, view: Viewport, size: Size, theme: Theme): void {
  const ox = crisp(toScreenX(view, size, 0))
  const oy = crisp(toScreenY(view, size, 0))
  ctx.strokeStyle = theme.axis
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, oy)
  ctx.lineTo(size.width, oy)
  ctx.moveTo(ox, 0)
  ctx.lineTo(ox, size.height)
  ctx.stroke()
}

/** Labels sit beside their axis, or pinned to the nearest edge when the axis is out of view. */
export function labels(ctx: CanvasRenderingContext2D, x: Axis, y: Axis | null, view: Viewport, size: Size, theme: Theme): void {
  ctx.font = theme.font
  const ox = toScreenX(view, size, 0)
  const oy = toScreenY(view, size, 0)
  const top = Math.max(4, Math.min(size.height - 16, oy + 5))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const label of x.labels) {
    const sx = toScreenX(view, size, label.value)
    const half = ctx.measureText(label.text).width / 2
    if (sx - half < 2 || sx + half > size.width - 2) continue
    haloText(ctx, theme, label.text, sx, top)
  }
  if (y) {
    ctx.textBaseline = 'middle'
    const right = ox - 6
    const left = ox < 0 ? 6 : null
    for (const label of y.labels) {
      const sy = toScreenY(view, size, label.value)
      if (sy < -20 || sy > size.height + 20) continue
      const width = ctx.measureText(label.text).width
      if (left !== null || right - width < 4) {
        ctx.textAlign = 'left'
        haloText(ctx, theme, label.text, left ?? Math.max(6, Math.min(size.width - width - 6, ox + 6)), sy)
      } else {
        ctx.textAlign = 'right'
        haloText(ctx, theme, label.text, Math.min(size.width - 6, right), sy)
      }
    }
  }
  if (ox > 12 && ox < size.width - 4 && oy > 4 && oy < size.height - 16) {
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    haloText(ctx, theme, '0', ox - 5, oy + 5)
  }
}

/** Axis labels in decimal numbers or in fractions and multiples of π. */
export type AxisUnits = 'decimal' | 'pi'

/** Paints a view's background grid, axes and labels. */
export type GridPainter = (ctx: CanvasRenderingContext2D, view: Viewport, size: Size, theme: Theme, units: AxisUnits) => void

export interface PlaneGridOptions {
  /** The Gaussian plane: the vertical axis in multiples of i, with `Re` and `Im` names. */
  imaginary?: boolean
}

/** A rectangular grid; `units` labels the x-axis in decimals or in multiples of π. */
export const planeGrid = ({ imaginary = false }: PlaneGridOptions = {}): GridPainter => (ctx, view, size, theme, units) => {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, size.width, size.height)
  const lo = toWorldX(view, size, 0)
  const hi = toWorldX(view, size, size.width)
  const x = units === 'pi' ? piAxis(lo, hi, view.scale) : decimalAxis(lo, hi, view.scale)
  const real = decimalAxis(toWorldY(view, size, size.height), toWorldY(view, size, 0), view.scale)
  const y = imaginary ? { ...real, labels: real.labels.map((label) => ({ ...label, text: formatImaginary(label.text) })) } : real
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.minor
  verticals(ctx, x, view, size, false)
  horizontals(ctx, y, view, size, false)
  ctx.strokeStyle = theme.major
  verticals(ctx, x, view, size, true)
  horizontals(ctx, y, view, size, true)
  axes(ctx, view, size, theme)
  labels(ctx, x, y, view, size, theme)
  if (imaginary) axisNames(ctx, view, size, theme)
}

/** `Re` at the right end of the real axis and `Im` at the top of the imaginary one, pinned inside the view. */
function axisNames(ctx: CanvasRenderingContext2D, view: Viewport, size: Size, theme: Theme): void {
  const ox = Math.max(28, Math.min(size.width - 28, toScreenX(view, size, 0)))
  const oy = Math.max(14, Math.min(size.height - 14, toScreenY(view, size, 0)))
  ctx.font = `600 ${theme.font}`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'right'
  haloText(ctx, theme, 'Re', size.width - 8, oy - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  haloText(ctx, theme, 'Im', ox + 8, 8)
  ctx.font = theme.font
}

/**
 * An arrow from (ax, ay) to (bx, by): a stroked shaft up to the base of a filled head, the shape of the complex
 * sheet's arrows. `head` is the head's length and `half` its half-width, in pixels.
 */
export function arrowShape(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, head: number, half: number, width: number): void {
  const length = Math.hypot(bx - ax, by - ay)
  if (length <= 0) return
  const [ux, uy] = [(bx - ax) / length, (by - ay) / length]
  const [cx, cy] = [bx - ux * head, by - uy * head]
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(cx, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(cx - uy * half, cy + ux * half)
  ctx.lineTo(cx + uy * half, cy - ux * half)
  ctx.closePath()
  ctx.fill()
}

/** A vector field's arrow: the head scales with short arrows; `opacity` carries the magnitude when shading is on. */
export function fieldArrow(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, opacity: number): void {
  const length = Math.hypot(bx - ax, by - ay)
  if (length < 2) return
  const head = Math.min(7, length * 0.4)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.strokeStyle = color
  ctx.fillStyle = color
  arrowShape(ctx, ax, ay, bx, by, head, head * 0.45, 1.5)
  ctx.restore()
}

/** The opacity of an arrow whose magnitude is `relative` (0–1) of the field's reference: faint when small, full at the reference. */
export const magnitudeOpacity = (relative: number): number => 0.3 + 0.7 * Math.max(0, Math.min(1, relative))

/** Complex numbers as arrows from 0, with their value beside the tip. */
export function drawArrows(ctx: CanvasRenderingContext2D, arrows: readonly { x: number; y: number; color: string }[], view: Viewport, size: Size, theme: Theme): void {
  const ox = toScreenX(view, size, 0)
  const oy = toScreenY(view, size, 0)
  ctx.font = theme.font
  for (const arrow of arrows) {
    const tx = clamp(toScreenX(view, size, arrow.x))
    const ty = clamp(toScreenY(view, size, arrow.y))
    const length = Math.hypot(tx - ox, ty - oy)
    if (length < 8) continue
    const [ux, uy] = [(tx - ox) / length, (ty - oy) / length]
    ctx.strokeStyle = arrow.color
    ctx.fillStyle = arrow.color
    arrowShape(ctx, ox, oy, tx, ty, 11, 5, 2)
    ctx.textAlign = ux >= 0 ? 'left' : 'right'
    ctx.textBaseline = uy >= 0 ? 'top' : 'bottom'
    haloText(ctx, theme, formatComplex(arrow.x, arrow.y), tx + (ux >= 0 ? 7 : -7), ty + (uy >= 0 ? 5 : -5))
  }
}

/** What a flat view contributes to a frame: its grid painter and whether numbers are complex arrows. */
export interface PlanePainter {
  grid: GridPainter
  complex?: boolean
}

/** One frame of a flat sheet without the pointer's readout and markers: grid, axes and labels, then every sampled path
 * (regions, curves, points, arrows, level labels), then the complex sheet's arrows. Returns the rows' colours. */
export function paintPlane(ctx: CanvasRenderingContext2D, plane: PlanePainter, units: AxisUnits, rows: readonly { color: string; hidden: boolean; magnitude?: boolean; labels?: boolean }[], analyses: readonly { kind: string; strict?: boolean; x?: number; y?: number }[], paths: readonly SamplePath[], view: Viewport, size: Size, theme: Theme): string[] {
  plane.grid(ctx, view, size, theme, units)
  const colors = rows.map((row) => colorOf(row.color))
  drawPaths(ctx, paths, colors, theme, rows.map((_, index) => Boolean(analyses[index]?.strict)), rows.map((row) => row.magnitude === false), rows.map((row) => row.labels !== false))
  if (plane.complex) {
    const arrows = analyses.flatMap((analysis, index) => analysis.kind === 'cpoint' && !rows[index]?.hidden && analysis.x !== undefined && analysis.y !== undefined
      ? [{ x: analysis.x, y: analysis.y, color: colors[index] ?? theme.axis }] : [])
    drawArrows(ctx, arrows, view, size, theme)
  }
  return colors
}

/** Regions are filled first, translucent and once per row so neighbouring cells never double up; `dashed` marks
 * rows whose boundary is excluded (strict inequalities), `uniform` vector fields whose arrows are not shaded by magnitude
 * and `labelled` rows whose level curves show their values. */
export function drawPaths(ctx: CanvasRenderingContext2D, paths: readonly SamplePath[], colors: readonly string[], theme: Theme, dashed: readonly boolean[] = [], uniform: readonly boolean[] = [], labelled: readonly boolean[] = []): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // One path per row (not a Path2D), so the SVG export's recording context can fill it too.
  const regions = new Map<number, SamplePath[]>()
  for (const path of paths) {
    if (path.kind !== 'region') continue
    const area = regions.get(path.row)
    if (area) area.push(path)
    else regions.set(path.row, [path])
  }
  ctx.save()
  ctx.globalAlpha = 0.22
  for (const [row, area] of regions) {
    ctx.beginPath()
    for (const { points } of area) {
      for (let i = 0; i < points.length; i += STRIDE) {
        if (i === 0) ctx.moveTo(clamp(points[i]), clamp(points[i + 1]))
        else ctx.lineTo(clamp(points[i]), clamp(points[i + 1]))
      }
      ctx.closePath()
    }
    ctx.fillStyle = colors[row] ?? theme.axis
    ctx.fill()
  }
  ctx.restore()
  for (const path of paths) {
    if (path.kind === 'region') continue
    const color = colors[path.row] ?? theme.axis
    const { points } = path
    if (path.kind === 'arrow') {
      fieldArrow(ctx, clamp(points[0]), clamp(points[1]), clamp(points[STRIDE]), clamp(points[STRIDE + 1]), color, uniform[path.row] ? 1 : magnitudeOpacity(points[STRIDE + 4]))
      continue
    }
    if (path.kind === 'point') {
      ctx.beginPath()
      ctx.arc(clamp(points[0]), clamp(points[1]), 4.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = theme.background
      ctx.stroke()
      continue
    }
    ctx.lineWidth = path.kind === 'contour' ? 1.5 : 2.5
    ctx.strokeStyle = color
    ctx.setLineDash(dashed[path.row] ? [7, 5] : [])
    ctx.beginPath()
    for (let i = 0; i < points.length; i += STRIDE) {
      const x = clamp(points[i])
      const y = clamp(points[i + 1])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])
  levelLabels(ctx, paths.filter((path) => path.kind === 'contour' && labelled[path.row]), theme)
}

/** Where along a level curve its label may go, tried in turn: off the middle first, since a curve symmetric about an axis has its middle on that axis. */
const LABEL_SPOTS = [0.3, 0.7, 0.15, 0.85, 0.5]

/** Each level curve at least 60 pixels long shows its value once, at the first spot along it where the label overlaps no other. */
export function levelLabels(ctx: CanvasRenderingContext2D, paths: readonly SamplePath[], theme: Theme): void {
  ctx.font = theme.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const placed: { x: number; y: number; w: number }[] = []
  for (const { points } of paths) {
    const walked = [0]
    for (let i = STRIDE; i < points.length; i += STRIDE) walked.push(walked[walked.length - 1] + Math.hypot(points[i] - points[i - STRIDE], points[i + 1] - points[i + 1 - STRIDE]))
    const length = walked[walked.length - 1]
    if (length < 60) continue
    const text = formatNumber(points[4], 4)
    const w = ctx.measureText(text).width + 8
    for (const spot of LABEL_SPOTS) {
      const at = Math.max(0, walked.findIndex((distance) => distance >= length * spot)) * STRIDE
      const [x, y] = [clamp(points[at]), clamp(points[at + 1])]
      if (placed.some((box) => Math.abs(box.x - x) < (box.w + w) / 2 && Math.abs(box.y - y) < 16)) continue
      placed.push({ x, y, w })
      haloText(ctx, theme, text, x, y)
      break
    }
  }
}

export interface Hit {
  row: number
  kind: SamplePath['kind']
  sx: number
  sy: number
  wx: number
  wy: number
  /** Range variable at the hit, interpolated between samples. */
  parameter: number
}

/** What lies under the pointer: a point within 10 pixels, else the nearest line within `radius`. */
export function findHit(paths: readonly SamplePath[], px: number, py: number, radius = 14): Hit | null {
  let point: Hit | null = null
  let pointDistance = 10
  let line: Hit | null = null
  let lineDistance = radius
  for (const path of paths) {
    const { points } = path
    if (path.kind === 'region' || path.kind === 'arrow') continue
    if (path.kind === 'point') {
      const distance = Math.hypot(points[0] - px, points[1] - py)
      if (distance <= pointDistance) {
        pointDistance = distance
        point = { row: path.row, kind: path.kind, sx: points[0], sy: points[1], wx: points[2], wy: points[3], parameter: 0 }
      }
      continue
    }
    for (let i = 0; i + STRIDE < points.length; i += STRIDE) {
      const j = i + STRIDE
      const ax = points[i], ay = points[i + 1], bx = points[j], by = points[j + 1]
      if (Math.min(ax, bx) - lineDistance > px || Math.max(ax, bx) + lineDistance < px || Math.min(ay, by) - lineDistance > py || Math.max(ay, by) + lineDistance < py) continue
      const dx = bx - ax
      const dy = by - ay
      const length = dx * dx + dy * dy
      const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
      const sx = ax + dx * t
      const sy = ay + dy * t
      const distance = Math.hypot(sx - px, sy - py)
      if (distance < lineDistance) {
        lineDistance = distance
        const mix = (k: number): number => points[i + k] + (points[j + k] - points[i + k]) * t
        line = { row: path.row, kind: path.kind, sx, sy, wx: mix(2), wy: mix(3), parameter: mix(4) }
      }
    }
  }
  return point ?? line
}

export function drawHover(ctx: CanvasRenderingContext2D, hover: Hover, color: string, size: Size, theme: Theme, complex = false): void {
  ctx.beginPath()
  ctx.arc(hover.sx, hover.sy, 5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.background
  ctx.stroke()
  const lines = [complex ? formatComplex(hover.wx, hover.wy) : formatPoint(hover.wx, hover.wy)]
  if (hover.parameter) lines.push(`${hover.parameter.name} = ${formatNumber(hover.parameter.value)}`)
  if (hover.label) lines.unshift(hover.label)
  drawLabel(ctx, hover.sx, hover.sy, lines, size, theme)
}
