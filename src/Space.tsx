import { React } from './runtime'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { colorOf, readTheme, type Size, type Theme } from './draw'
import { SPACE, type Camera, type PlotEngine, type SpaceRecord } from './engine'
import { Fit, Minus, Plus } from './icons'
import { uiText } from './localization'
import type { Row } from './model'
import { getStore } from './store'
import { formatNumber } from './ticks'
import type { SpaceView } from './views'

/** x towards the lower right, y towards the upper right, z up, the cube [-10, 10]³ in view. */
export const HOME_CAMERA: Camera = { yaw: -0.6, pitch: 0.45, range: 10 }
const MIN_RANGE = 1e-3
const MAX_RANGE = 1e5
const MAX_PITCH = Math.PI / 2 - 0.01

/** A resolved colour as RGB, for shading; null when the format is unknown. */
export function rgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number]
  }
  const functional = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim())
  return functional ? [Number(functional[1]), Number(functional[2]), Number(functional[3])] : null
}

/** `color` darkened to `shade` (0–1), in 32 steps so a surface reuses a few fill styles. */
export function shaded(color: string, shade: number): string {
  const channels = rgb(color)
  if (!channels) return color
  const level = Math.round(Math.max(0, Math.min(1, shade)) * 32) / 32
  return `rgb(${channels.map((channel) => Math.round(channel * level)).join(', ')})`
}

function trace(ctx: CanvasRenderingContext2D, points: Float64Array): void {
  ctx.beginPath()
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) ctx.moveTo(points[i], points[i + 1])
    else ctx.lineTo(points[i], points[i + 1])
  }
}

/** A domain-coloured cell: the record's value is `32 · shade` rounded plus the hue in [0, 1); red is a positive real value. */
export function hueFill(value: number): string {
  const shade = Math.max(0, Math.min(1, Math.floor(value) / 32))
  const hue = value - Math.floor(value)
  return `hsl(${Math.round(hue * 360)}, 70%, ${Math.round(18 + shade * 46)}%)`
}

export function drawSpace(ctx: CanvasRenderingContext2D, records: readonly SpaceRecord[], colors: readonly string[], size: Size, theme: Theme, axisNames: readonly string[] = ['x', 'y', 'z']): void {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const frame: Partial<Record<number, string>> = { [SPACE.box]: theme.major, [SPACE.grid]: theme.minor, [SPACE.gridMajor]: theme.major }
  for (const record of records) {
    const stroke = frame[record.kind]
    if (!stroke) continue
    ctx.lineWidth = 1
    ctx.strokeStyle = stroke
    trace(ctx, record.points)
    ctx.stroke()
  }
  for (const record of records) {
    const color = colors[record.row] ?? theme.axis
    if (record.kind === SPACE.polygon || record.kind === SPACE.huePolygon) {
      const fill = record.kind === SPACE.huePolygon ? hueFill(record.value) : shaded(color, record.value)
      ctx.fillStyle = fill
      // A hairline in the same colour closes the seams between neighbouring cells.
      ctx.strokeStyle = fill
      ctx.lineWidth = 0.75
      trace(ctx, record.points)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (record.kind === SPACE.segment) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      trace(ctx, record.points)
      ctx.stroke()
    } else if (record.kind === SPACE.point) {
      ctx.beginPath()
      ctx.arc(record.points[0], record.points[1], 4.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = theme.background
      ctx.stroke()
    }
  }
  ctx.font = theme.font
  for (const record of records) {
    if (record.kind === SPACE.axis) {
      ctx.lineWidth = 1.5
      ctx.strokeStyle = theme.axis
      trace(ctx, record.points)
      ctx.stroke()
    } else if (record.kind === SPACE.tick || record.kind === SPACE.axisName) {
      const name = record.kind === SPACE.axisName
      const text = name ? axisNames[record.row] ?? '' : formatNumber(record.value, 6)
      ctx.font = name ? `600 13px ${theme.font.replace(/^\S+\s+/, '')}` : theme.font
      ctx.textAlign = name ? 'center' : 'left'
      ctx.textBaseline = name ? 'middle' : 'top'
      const x = record.points[0] + (name ? 0 : 4)
      const y = record.points[1] + (name ? 0 : 3)
      ctx.lineWidth = 3
      ctx.strokeStyle = theme.background
      ctx.strokeText(text, x, y)
      ctx.fillStyle = theme.label
      ctx.fillText(text, x, y)
    }
  }
}

interface SpaceProps {
  view: SpaceView
  rows: readonly Row[]
  engine: PlotEngine | null
}

/** The 3D graph: drag to orbit, scroll or pinch to zoom; the kernel projects and orders everything per frame. */
export const SpaceCanvas = ({ view, rows, engine }: SpaceProps): ReactElement => {
  const store = getStore()
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sizeRef = React.useRef<Size>({ width: 0, height: 0 })
  const cameraRef = React.useRef<Camera>(store.cameras[view.id] ?? HOME_CAMERA)
  const dragRef = React.useRef<{ id: number; x: number; y: number; camera: Camera } | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const inputs = React.useRef({ view, rows, engine })
  inputs.current = { view, rows, engine }

  const draw = React.useCallback((): void => {
    frameRef.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const size = sizeRef.current
    if (!canvas || !ctx || size.width <= 0 || size.height <= 0) return
    const { view, rows, engine } = inputs.current
    let records: SpaceRecord[] = []
    try {
      records = engine ? engine.space(view.id, rows, size.width, size.height, cameraRef.current) : []
    } catch {
      records = []
    }
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawSpace(ctx, records, rows.map((row) => colorOf(row.color)), size, readTheme(canvas), view.axisNames)
  }, [])

  const invalidate = React.useCallback((): void => {
    const view = canvasRef.current?.ownerDocument.defaultView
    if (frameRef.current === null && view) frameRef.current = view.requestAnimationFrame(draw)
  }, [draw])

  const setCamera = React.useCallback((next: Camera): void => {
    const camera = { yaw: next.yaw, pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, next.pitch)), range: Math.max(MIN_RANGE, Math.min(MAX_RANGE, next.range)) }
    cameraRef.current = camera
    store.cameras[inputs.current.view.id] = camera
    invalidate()
  }, [invalidate, store])

  // Each 3D sheet keeps its own camera.
  React.useEffect(() => {
    cameraRef.current = store.cameras[view.id] ?? HOME_CAMERA
    invalidate()
  }, [view, store, invalidate])

  React.useEffect(() => { invalidate() }, [rows, engine, invalidate])

  React.useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const view = canvas.ownerDocument.defaultView as Window & typeof globalThis
    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = view.devicePixelRatio || 1
      if (sizeRef.current.width === rect.width && sizeRef.current.height === rect.height) return
      sizeRef.current = { width: rect.width, height: rect.height }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      invalidate()
    }
    resize()
    const observer = new view.ResizeObserver(resize)
    observer.observe(wrap)
    const theme = new view.MutationObserver(invalidate)
    theme.observe(canvas.ownerDocument.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? sizeRef.current.height : 1
      const delta = Math.max(-300, Math.min(300, event.deltaY * unit))
      const camera = cameraRef.current
      setCamera({ ...camera, range: camera.range * Math.exp(delta * (event.ctrlKey ? 0.01 : 0.002)) })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      theme.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      if (frameRef.current !== null) view.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [invalidate, setCamera])

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current }
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    // Dragging right turns the front of the scene with the pointer; dragging down looks from higher up.
    setCamera({ ...drag.camera, yaw: drag.camera.yaw + (event.clientX - drag.x) * 0.008, pitch: drag.camera.pitch + (event.clientY - drag.y) * 0.008 })
  }

  const endDrag = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
  }

  const zoomBy = (factor: number): void => setCamera({ ...cameraRef.current, range: cameraRef.current.range / factor })
  const reset = (): void => setCamera(HOME_CAMERA)

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const camera = cameraRef.current
    const step = 0.1
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setCamera({ ...camera, yaw: camera.yaw - step }),
      ArrowRight: () => setCamera({ ...camera, yaw: camera.yaw + step }),
      ArrowUp: () => setCamera({ ...camera, pitch: camera.pitch - step }),
      ArrowDown: () => setCamera({ ...camera, pitch: camera.pitch + step }),
      '+': () => zoomBy(1.5),
      '=': () => zoomBy(1.5),
      '-': () => zoomBy(1 / 1.5),
      '0': reset
    }
    const move = moves[event.key]
    if (move && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      move()
    }
  }

  return (
    <div className="grapher-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="grapher-canvas grapher-canvas-space"
        tabIndex={0}
        aria-label={uiText('graph.canvas3d', { mode: uiText(`mode.${view.id}`) })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      />
      <div className="grapher-zoom" role="group" aria-label={uiText('zoom.group')}>
        <button type="button" className="grapher-zoom-button" onClick={() => zoomBy(1.5)} aria-label={uiText('zoom.in')} title={uiText('zoom.in')}><Plus /></button>
        <button type="button" className="grapher-zoom-button" onClick={() => zoomBy(1 / 1.5)} aria-label={uiText('zoom.out')} title={uiText('zoom.out')}><Minus /></button>
        <button type="button" className="grapher-zoom-button" onClick={reset} aria-label={uiText('zoom.reset')} title={uiText('zoom.reset')}><Fit /></button>
      </div>
    </div>
  )
}
