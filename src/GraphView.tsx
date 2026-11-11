import { React } from './runtime'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { colorOf, drawArrows, drawHover, drawPaths, findHit, readTheme, toScreenY, toWorldX, toWorldY, type Hover, type Size } from './draw'
import type { PlotEngine, RowAnalysis, SamplePath, Viewport } from './engine'
import { Fit, Minus, Plus } from './icons'
import { uiText } from './localization'
import { unitsOf, type AxisUnits, type Row } from './model'
import { getStore, useGrapher } from './store'
import { SpaceCanvas } from './Space'
import { viewOf, type PlaneView } from './views'

const MIN_SCALE = 1e-3
const MAX_SCALE = 1e7

export function homeView(view: PlaneView, size: Size): Viewport {
  const span = view.homeSpan
  return { cx: 0, cy: 0, scale: Math.max(MIN_SCALE, Math.min(size.width / span, size.height / (span * 0.6))) }
}

function zoomed(view: Viewport, size: Size, factor: number, px: number, py: number): Viewport {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor))
  const wx = toWorldX(view, size, px)
  const wy = toWorldY(view, size, py)
  return { scale, cx: wx - (px - size.width / 2) / scale, cy: wy + (py - size.height / 2) / scale }
}

interface CanvasProps {
  view: PlaneView
  units: AxisUnits
  rows: readonly Row[]
  analyses: readonly RowAnalysis[]
  engine: PlotEngine | null
}

/**
 * The graph: drag to pan, scroll or pinch to zoom about the pointer, hover a graph to trace it. Sampling runs
 * in the Rust kernel whenever the view or the rows change; drawing reads colours from the theme each frame.
 */
export const GraphCanvas = ({ view: plane, units, rows, analyses, engine }: CanvasProps): ReactElement => {
  const mode = plane.id
  const store = getStore()
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sizeRef = React.useRef<Size>({ width: 0, height: 0 })
  const viewRef = React.useRef<Viewport | null>(store.viewports[mode] ?? null)
  const pathsRef = React.useRef<SamplePath[]>([])
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const dragRef = React.useRef<{ id: number; x: number; y: number; view: Viewport } | null>(null)
  const frameRef = React.useRef<{ id: number | null; resample: boolean }>({ id: null, resample: true })
  const inputs = React.useRef({ plane, units, mode, rows, analyses, engine })
  inputs.current = { plane, units, mode, rows, analyses, engine }

  const hoverAt = React.useCallback((x: number, y: number): Hover | null => {
    const { mode, rows, analyses, engine } = inputs.current
    const view = viewRef.current
    const hit = findHit(pathsRef.current, x, y)
    if (!hit || !view) return null
    const analysis = analyses[hit.row]
    const size = sizeRef.current
    if (analysis?.kind === 'function' && engine) {
      // Trace the function itself rather than the chord between two samples.
      if (analysis.axis === 'x') {
        const wy = engine.evaluate(mode, rows, hit.row, hit.wx)
        if (Number.isFinite(wy)) return { row: hit.row, sx: hit.sx, sy: toScreenY(view, size, wy), wx: hit.wx, wy, parameter: null }
      } else {
        const wx = engine.evaluate(mode, rows, hit.row, hit.wy)
        if (Number.isFinite(wx)) return { row: hit.row, sx: (wx - view.cx) * view.scale + size.width / 2, sy: hit.sy, wx, wy: hit.wy, parameter: null }
      }
    }
    const parameter = analysis?.kind === 'polar' ? { name: 'θ', value: hit.parameter } : analysis?.kind === 'curve' ? { name: 't', value: hit.parameter } : null
    return { row: hit.row, sx: hit.sx, sy: hit.sy, wx: hit.wx, wy: hit.wy, parameter }
  }, [])

  const draw = React.useCallback((): void => {
    const frame = frameRef.current
    frame.id = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const size = sizeRef.current
    if (!canvas || !ctx || size.width <= 0 || size.height <= 0) return
    const { plane, units, mode, rows, analyses, engine } = inputs.current
    const view = viewRef.current ?? (viewRef.current = homeView(plane, size))
    if (frame.resample) {
      frame.resample = false
      try {
        pathsRef.current = engine ? engine.sample(mode, rows, size.width, size.height, view) : []
      } catch {
        pathsRef.current = []
      }
    }
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const theme = readTheme(canvas)
    plane.grid(ctx, view, size, theme, units)
    const colors = rows.map((row) => colorOf(row.color))
    drawPaths(ctx, pathsRef.current, colors, theme, rows.map((_, index) => Boolean(analyses[index]?.strict)))
    if (plane.complex) {
      const arrows = analyses.flatMap((analysis, index) => analysis.kind === 'cpoint' && !rows[index]?.hidden && analysis.x !== undefined && analysis.y !== undefined
        ? [{ x: analysis.x, y: analysis.y, color: colors[index] ?? theme.axis }] : [])
      drawArrows(ctx, arrows, view, size, theme)
    }
    const pointer = pointerRef.current
    const hover = pointer && !dragRef.current ? hoverAt(pointer.x, pointer.y) : null
    if (hover) drawHover(ctx, hover, colors[hover.row] ?? theme.axis, size, theme, plane.complex)
  }, [hoverAt])

  const invalidate = React.useCallback((resample: boolean): void => {
    const frame = frameRef.current
    frame.resample ||= resample
    const view = canvasRef.current?.ownerDocument.defaultView
    if (frame.id === null && view) frame.id = view.requestAnimationFrame(draw)
  }, [draw])

  const setView = React.useCallback((next: Viewport): void => {
    viewRef.current = next
    store.viewports[inputs.current.mode] = next
    invalidate(true)
  }, [invalidate, store])

  // A new sheet brings its own camera.
  React.useEffect(() => {
    viewRef.current = store.viewports[mode] ?? null
    invalidate(true)
  }, [mode, store, invalidate])

  React.useEffect(() => { invalidate(true) }, [rows, engine, invalidate])
  React.useEffect(() => { invalidate(false) }, [units, invalidate])

  React.useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const view = canvas.ownerDocument.defaultView as Window & typeof globalThis
    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = view.devicePixelRatio || 1
      const previous = sizeRef.current
      if (previous.width === rect.width && previous.height === rect.height) return
      sizeRef.current = { width: rect.width, height: rect.height }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      invalidate(true)
    }
    resize()
    const observer = new view.ResizeObserver(resize)
    observer.observe(wrap)
    // The host restyles the document when the appearance changes; repaint with the new tokens.
    const theme = new view.MutationObserver(() => invalidate(false))
    theme.observe(canvas.ownerDocument.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const current = viewRef.current
      if (!current) return
      const rect = canvas.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      const delta = Math.max(-300, Math.min(300, event.deltaY * unit))
      setView(zoomed(current, sizeRef.current, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), event.clientX - rect.left, event.clientY - rect.top))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      theme.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      const frame = frameRef.current
      if (frame.id !== null) view.cancelAnimationFrame(frame.id)
      frame.id = null
    }
  }, [invalidate, setView])

  const local = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 || !viewRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = local(event)
    dragRef.current = { id: event.pointerId, x: at.x, y: at.y, view: viewRef.current }
    invalidate(false)
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const at = local(event)
    pointerRef.current = at
    const drag = dragRef.current
    if (drag && drag.id === event.pointerId) {
      const { view } = drag
      setView({ ...view, cx: view.cx - (at.x - drag.x) / view.scale, cy: view.cy + (at.y - drag.y) / view.scale })
      return
    }
    invalidate(false)
  }

  const endDrag = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current?.id === event.pointerId) dragRef.current = null
    invalidate(false)
  }

  const zoomBy = (factor: number): void => {
    const current = viewRef.current
    const size = sizeRef.current
    if (current) setView(zoomed(current, size, factor, size.width / 2, size.height / 2))
  }

  const reset = (): void => {
    delete store.viewports[inputs.current.mode]
    setView(homeView(inputs.current.plane, sizeRef.current))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const current = viewRef.current
    if (!current) return
    const pan = 60 / current.scale
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setView({ ...current, cx: current.cx - pan }),
      ArrowRight: () => setView({ ...current, cx: current.cx + pan }),
      ArrowUp: () => setView({ ...current, cy: current.cy + pan }),
      ArrowDown: () => setView({ ...current, cy: current.cy - pan }),
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
        className="grapher-canvas"
        tabIndex={0}
        aria-label={uiText('graph.canvas', { mode: uiText(`mode.${mode}`) })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { pointerRef.current = null; invalidate(false) }}
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

/** The main-workspace tab: the active sheet's name over its graph. */
export const GraphTab = (): ReactElement => {
  const { document, engine, problems } = useGrapher()
  const mode = document.mode
  const view = viewOf(mode)
  const rows = document.sheets[mode]
  const analyses = React.useMemo(() => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const engineProblem = problems.find((problem) => problem.key === 'problem.engine')
  return (
    <div className="grapher-tab">
      <div className="grapher-topbar">
        <span className="grapher-topbar-title">{uiText(`mode.${mode}`)}</span>
      </div>
      {engineProblem ? <p role="alert" className="grapher-alert">{uiText('problem.engine', { message: engineProblem.message })}</p> : null}
      <div className="grapher-stage">
        {view.canvas === 'space' ? <SpaceCanvas view={view} rows={rows} engine={engine} /> : <GraphCanvas key={view.id} view={view} units={unitsOf(document, mode) ?? view.units} rows={rows} analyses={analyses} engine={engine} />}
      </div>
    </div>
  )
}
