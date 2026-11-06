import { readPaletteColor } from '@valley/plugin-sdk/palette'
import { STRIDE, type SamplePath, type Viewport } from './engine'
import type { Mode } from './model'
import { decimalAxis, decimalStep, formatNumber, formatPi, piAxis, type Axis } from './ticks'

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
}

// Canvas coordinates far outside the view are clamped; Chromium drops paths with huge coordinates.
const CLAMP = 1e5
const clamp = (value: number): number => Math.max(-CLAMP, Math.min(CLAMP, value))

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

function haloText(ctx: CanvasRenderingContext2D, theme: Theme, text: string, x: number, y: number): void {
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.background
  ctx.strokeText(text, x, y)
  ctx.fillStyle = theme.label
  ctx.fillText(text, x, y)
}

function axes(ctx: CanvasRenderingContext2D, view: Viewport, size: Size, theme: Theme): void {
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
function labels(ctx: CanvasRenderingContext2D, x: Axis, y: Axis | null, view: Viewport, size: Size, theme: Theme): void {
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

function cartesianGrid(ctx: CanvasRenderingContext2D, mode: Mode, view: Viewport, size: Size, theme: Theme): void {
  const lo = toWorldX(view, size, 0)
  const hi = toWorldX(view, size, size.width)
  const x = mode === 'trig' ? piAxis(lo, hi, view.scale) : decimalAxis(lo, hi, view.scale)
  const y = decimalAxis(toWorldY(view, size, size.height), toWorldY(view, size, 0), view.scale)
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.minor
  verticals(ctx, x, view, size, false)
  horizontals(ctx, y, view, size, false)
  ctx.strokeStyle = theme.major
  verticals(ctx, x, view, size, true)
  horizontals(ctx, y, view, size, true)
  axes(ctx, view, size, theme)
  labels(ctx, x, y, view, size, theme)
}

/** Where a ray from the origin leaves the view (inset for its label), or null when it misses it. */
function rayExit(ox: number, oy: number, dx: number, dy: number, size: Size): [number, number] | null {
  const box = [[22, size.width - 22], [12, size.height - 12]] as const
  let enter = 0
  let exit = Infinity
  for (const [origin, direction, [min, max]] of [[ox, dx, box[0]], [oy, dy, box[1]]] as const) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < min || origin > max) return null
      continue
    }
    const a = (min - origin) / direction
    const b = (max - origin) / direction
    enter = Math.max(enter, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  }
  return exit > enter && Number.isFinite(exit) ? [ox + dx * exit, oy + dy * exit] : null
}

function polarGrid(ctx: CanvasRenderingContext2D, view: Viewport, size: Size, theme: Theme): void {
  const ox = toScreenX(view, size, 0)
  const oy = toScreenY(view, size, 0)
  const corners = [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - ox, y - oy)))
  const inside = ox >= 0 && ox <= size.width && oy >= 0 && oy <= size.height
  const nearX = Math.max(0, Math.min(size.width, ox))
  const nearY = Math.max(0, Math.min(size.height, oy))
  const near = inside ? 0 : Math.hypot(nearX - ox, nearY - oy)
  const { major, divisions } = decimalStep(view.scale)
  const minor = major / divisions
  const first = Math.max(1, Math.floor(near / view.scale / minor))
  const last = Math.ceil(far / view.scale / minor)
  ctx.lineWidth = 1
  if (last - first < 600) {
    for (const wantMajor of [false, true]) {
      ctx.strokeStyle = wantMajor ? theme.major : theme.minor
      ctx.beginPath()
      for (let k = first; k <= last; k++) {
        if ((k % divisions === 0) !== wantMajor) continue
        const radius = k * minor * view.scale
        ctx.moveTo(ox + radius, oy)
        ctx.arc(ox, oy, radius, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
  }
  // Rays every π/12, stronger every π/6; the 0 and π/2 rays are the axes.
  for (let k = 0; k < 12; k++) {
    if (k % 6 === 0) continue
    const angle = (k * Math.PI) / 12
    ctx.strokeStyle = k % 2 === 0 ? theme.major : theme.minor
    ctx.beginPath()
    ctx.moveTo(ox - Math.cos(angle) * far, oy + Math.sin(angle) * far)
    ctx.lineTo(ox + Math.cos(angle) * far, oy - Math.sin(angle) * far)
    ctx.stroke()
  }
  axes(ctx, view, size, theme)
  const lo = toWorldX(view, size, 0)
  const hi = toWorldX(view, size, size.width)
  const radii = decimalAxis(lo, hi, view.scale)
  // Radii read as distances; the outermost ones would sit under the 0 and π angle labels.
  const clear = (label: { value: number }): boolean => { const sx = toScreenX(view, size, label.value); return sx > 44 && sx < size.width - 44 }
  labels(ctx, { ...radii, labels: radii.labels.filter(clear).map((label) => ({ ...label, text: formatNumber(Math.abs(label.value), 6) })) }, null, view, size, theme)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let k = 0; k < 12; k++) {
    const angle = (k * Math.PI) / 6
    const at = rayExit(ox, oy, Math.cos(angle), -Math.sin(angle), size)
    // The 0 and π labels sit just above the horizontal axis, not on its line.
    if (at) haloText(ctx, theme, formatPi(k, 6), at[0], k % 6 === 0 ? at[1] - 9 : at[1])
  }
}

export function drawGrid(ctx: CanvasRenderingContext2D, mode: Mode, view: Viewport, size: Size, theme: Theme): void {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, size.width, size.height)
  if (mode === 'polar') polarGrid(ctx, view, size, theme)
  else cartesianGrid(ctx, mode, view, size, theme)
}

export function drawPaths(ctx: CanvasRenderingContext2D, paths: readonly SamplePath[], colors: readonly string[], theme: Theme): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const path of paths) {
    const color = colors[path.row] ?? theme.axis
    const { points } = path
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
    ctx.lineWidth = 2.5
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let i = 0; i < points.length; i += STRIDE) {
      const x = clamp(points[i])
      const y = clamp(points[i + 1])
      if (i === 0 || (path.kind === 'segments' && (i / STRIDE) % 2 === 0)) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
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
    if (path.kind === 'point') {
      const distance = Math.hypot(points[0] - px, points[1] - py)
      if (distance <= pointDistance) {
        pointDistance = distance
        point = { row: path.row, kind: path.kind, sx: points[0], sy: points[1], wx: points[2], wy: points[3], parameter: 0 }
      }
      continue
    }
    const step = path.kind === 'segments' ? 2 * STRIDE : STRIDE
    for (let i = 0; i + STRIDE < points.length; i += step) {
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

export function drawHover(ctx: CanvasRenderingContext2D, hover: Hover, color: string, size: Size, theme: Theme): void {
  ctx.beginPath()
  ctx.arc(hover.sx, hover.sy, 5, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = theme.background
  ctx.stroke()
  const lines = [`(${formatNumber(hover.wx)}, ${formatNumber(hover.wy)})`]
  if (hover.parameter) lines.push(`${hover.parameter.name} = ${formatNumber(hover.parameter.value)}`)
  ctx.font = theme.font
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + 12
  const height = lines.length * 15 + 7
  let x = hover.sx + 10
  let y = hover.sy - height - 8
  if (x + width > size.width - 4) x = hover.sx - width - 10
  if (y < 4) y = hover.sy + 10
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
