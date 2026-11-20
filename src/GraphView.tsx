import { React } from './runtime'
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { drawHover, drawLabel, drawMarkers, findHit, formatPoint, paintPlane, readTheme, toScreenX, toScreenY, toWorldX, toWorldY, type Hover, type Size, type Theme } from './draw'
import { NOTICE_SECONDS, onExportNotice, registerExporter, renderPng, renderSvg, type ExportNotice } from './exporting'
import { MARKER, type Marker, type PlotEngine, type RowAnalysis, type SamplePath, type Viewport } from './engine'
import { Fit, Minus, Plus } from './icons'
import { uiText } from './localization'
import { MAIN_GRAPH, graphIdOf, unitsOf, type AxisUnits, type Row } from './model'
import { getStore, useGrapher } from './store'
import { noteCanvas } from './details'
import { runFlow } from './animate'
import { SpaceCanvas } from './Space'
import { viewOf, type PlaneView } from './views'

const MIN_SCALE = 1e-3
const MAX_SCALE = 1e7
/** Pointer distance in pixels within which a marker is hovered or clicked, and how far a pinned marker may move between frames
 * (a slider step, a zoom) and still keep its label. */
const MARKER_REACH = 7
const PIN_FOLLOW = 24
const MAX_PINS = 12

/** What a marker is, in words: “Zero”, “Maximum”, “Zero · Minimum” for a touching root, “Intersection”. */
export function markerKind(kind: number): string {
  return (['zero', 'minimum', 'maximum', 'intersection'] as const).filter((name) => kind & MARKER[name]).map((name) => uiText(`marker.${name}`)).join(' · ')
}

/** A pinned marker: its curve and, for an intersection, the other curve by row id, so it survives rows moving; x and y
 * follow the marker as the view or a slider changes. */
interface Pin {
  id: string
  kind: number
  other: string | null
  x: number
  y: number
}

interface Placed {
  row: number
  marker: Marker
  sx: number
  sy: number
  pinned: boolean
}

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
  /** The graph (tab) this canvas draws; each keeps its own view per sheet. */
  graph: string
  /** The camera slot (`graph:mode`, or the bookmark view's own). */
  slot: string
}

/**
 * The graph: drag to pan, scroll or pinch to zoom about the pointer, hover a graph to trace it. Sampling runs
 * in the Rust kernel whenever the view or the rows change; drawing reads colours from the theme each frame.
 */
export const GraphCanvas = ({ view: plane, units, rows, analyses, engine, graph, slot }: CanvasProps): ReactElement => {
  const mode = plane.id
  const store = getStore()
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sizeRef = React.useRef<Size>({ width: 0, height: 0 })
  const viewRef = React.useRef<Viewport | null>(store.viewports[slot] ?? null)
  const pathsRef = React.useRef<SamplePath[]>([])
  /** The time flowing vector fields are sampled at, in cycles. */
  const flowRef = React.useRef(0)
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null)
  const dragRef = React.useRef<{ id: number; x: number; y: number; view: Viewport } | null>(null)
  const frameRef = React.useRef<{ id: number | null; resample: boolean }>({ id: null, resample: true })
  const inputs = React.useRef({ plane, units, mode, slot, rows, analyses, engine })
  inputs.current = { plane, units, mode, slot, rows, analyses, engine }
  /** Markers: computed per row on demand and kept until the next resample (pan, zoom, any row or slider change). */
  const generationRef = React.useRef(0)
  const markersRef = React.useRef<{ generation: number; rows: Map<number, Marker[]> }>({ generation: -1, rows: new Map() })
  const selectedRef = React.useRef<string | null>(null)
  const pinsRef = React.useRef<Pin[]>([])
  const placedRef = React.useRef<Placed[]>([])

  /** Visible curves y = f(x) on the Cartesian sheet carry markers. */
  const markable = React.useCallback((row: number): boolean => {
    const { mode, rows, analyses } = inputs.current
    const analysis = analyses[row]
    return mode === 'cartesian' && analysis?.kind === 'function' && analysis.axis === 'x' && rows[row] !== undefined && !rows[row].hidden
  }, [])

  const markersOf = React.useCallback((row: number): Marker[] => {
    const { mode, rows, engine } = inputs.current
    const cache = markersRef.current
    if (cache.generation !== generationRef.current) {
      cache.generation = generationRef.current
      cache.rows.clear()
    }
    const cached = cache.rows.get(row)
    if (cached) return cached
    const view = viewRef.current
    const size = sizeRef.current
    let found: Marker[] = []
    try {
      if (engine && view) found = engine.markers(mode, rows, row, size.width, size.height, view)
    } catch {
      found = []
    }
    cache.rows.set(row, found)
    return found
  }, [])

  /** The markers to draw: every marker of the selected curve and of the curve under the pointer, and each pinned marker
   * matched again to the nearest marker of its kind (it hides while none is near, as when a slider moves it off). */
  const placeMarkers = React.useCallback((hovered: number | null): Placed[] => {
    const { rows } = inputs.current
    const view = viewRef.current
    const size = sizeRef.current
    if (!view) return []
    const indexOf = (id: string | null): number => (id === null ? -1 : rows.findIndex((row) => row.id === id))
    const place = (row: number, marker: Marker, pinned: boolean): Placed => ({ row, marker, sx: toScreenX(view, size, marker.x), sy: toScreenY(view, size, marker.y), pinned })
    const active = new Set<number>()
    const selected = indexOf(selectedRef.current)
    if (selected < 0) selectedRef.current = null
    else if (markable(selected)) active.add(selected)
    if (hovered !== null && markable(hovered)) active.add(hovered)
    const placed: Placed[] = []
    for (const row of active) for (const marker of markersOf(row)) placed.push(place(row, marker, false))
    for (const pin of pinsRef.current) {
      const row = indexOf(pin.id)
      const other = pin.other === null ? null : indexOf(pin.other)
      if (row < 0 || other === -1 || !markable(row)) continue
      let best: Marker | null = null
      let distance = PIN_FOLLOW
      for (const marker of markersOf(row)) {
        if (marker.kind !== pin.kind || marker.other !== other) continue
        const away = Math.hypot((marker.x - pin.x) * view.scale, (marker.y - pin.y) * view.scale)
        if (away < distance) [best, distance] = [marker, away]
      }
      if (!best) continue
      pin.x = best.x
      pin.y = best.y
      const shown = placed.find((entry) => entry.row === row && entry.marker === best)
      if (shown) shown.pinned = true
      else placed.push(place(row, best, true))
    }
    placedRef.current = placed
    return placed
  }, [markable, markersOf])

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
    const parameter = analysis?.kind === 'polar' ? { name: 'θ', value: hit.parameter }
      : analysis?.kind === 'curve' ? { name: 't', value: hit.parameter }
        : analysis?.kind === 'contour' ? { name: `${analysis.name ?? 'f'}(x, y)`, value: hit.parameter } : null
    return { row: hit.row, sx: hit.sx, sy: hit.sy, wx: hit.wx, wy: hit.wy, parameter }
  }, [])

  /** Paints the current frame. An export paints the same frame without the pointer: no readout, no hover or selection
   * markers, only the pinned markers with their labels. */
  const paint = React.useCallback((ctx: CanvasRenderingContext2D, theme: Theme, exporting: boolean): void => {
    const { plane, units, rows, analyses } = inputs.current
    const size = sizeRef.current
    const view = viewRef.current
    if (!view) return
    const colors = paintPlane(ctx, plane, units, rows, analyses, pathsRef.current, view, size, theme)
    // While the button is down, markers and the readout stay until the pointer moves: a click must not make them blink.
    const drag = dragRef.current
    const pointer = !exporting && pointerRef.current && !(drag && Math.hypot(pointerRef.current.x - drag.x, pointerRef.current.y - drag.y) >= 4) ? pointerRef.current : null
    const placed = placeMarkers(pointer ? findHit(pathsRef.current, pointer.x, pointer.y)?.row ?? null : null).filter((entry) => !exporting || entry.pinned)
    drawMarkers(ctx, placed, theme)
    for (const entry of placed) if (entry.pinned) drawLabel(ctx, entry.sx, entry.sy, [markerKind(entry.marker.kind), formatPoint(entry.marker.x, entry.marker.y)], size, theme)
    const onMarker = pointer ? placed.find((entry) => Math.hypot(entry.sx - pointer.x, entry.sy - pointer.y) <= MARKER_REACH) : undefined
    const hover: Hover | null = onMarker
      ? { row: onMarker.row, sx: onMarker.sx, sy: onMarker.sy, wx: onMarker.marker.x, wy: onMarker.marker.y, parameter: null, label: markerKind(onMarker.marker.kind) }
      : pointer ? hoverAt(pointer.x, pointer.y) : null
    if (hover && !onMarker?.pinned) drawHover(ctx, hover, colors[hover.row] ?? theme.axis, size, theme, plane.complex)
  }, [hoverAt, placeMarkers])

  /** The view and the sampled paths for the current size, resampled when the view or the rows changed since the last frame. */
  const prepare = React.useCallback((): void => {
    const frame = frameRef.current
    const size = sizeRef.current
    const { plane, mode, rows, engine } = inputs.current
    const view = viewRef.current ?? (viewRef.current = homeView(plane, size))
    noteCanvas(inputs.current.slot, { size, view, pins: pinsRef.current.length })
    if (!frame.resample) return
    frame.resample = false
    generationRef.current += 1
    try {
      pathsRef.current = engine ? engine.sample(mode, rows, size.width, size.height, view, flowRef.current) : []
    } catch {
      pathsRef.current = []
    }
  }, [])

  const draw = React.useCallback((): void => {
    const frame = frameRef.current
    frame.id = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const size = sizeRef.current
    if (!canvas || !ctx || size.width <= 0 || size.height <= 0) return
    prepare()
    const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint(ctx, readTheme(canvas), false)
  }, [paint, prepare])

  const invalidate = React.useCallback((resample: boolean): void => {
    const frame = frameRef.current
    frame.resample ||= resample
    const view = canvasRef.current?.ownerDocument.defaultView
    if (frame.id === null && view) frame.id = view.requestAnimationFrame(draw)
  }, [draw])

  const setView = React.useCallback((next: Viewport): void => {
    viewRef.current = next
    store.viewports[inputs.current.slot] = next
    store.noteCamera()
    invalidate(true)
  }, [invalidate, store])

  // The tab's menu exports this frame: the paths sampled last, at the canvas's size, in the theme's colours.
  React.useEffect(() => registerExporter(graph, {
    mode: () => inputs.current.mode,
    formats: ['png', 'svg'],
    render: async (format) => {
      const canvas = canvasRef.current
      const size = sizeRef.current
      if (!canvas || size.width <= 0 || size.height <= 0) throw new Error(uiText('export.noCanvas'))
      prepare()
      const theme = readTheme(canvas)
      try {
        return format === 'svg' ? renderSvg(canvas.ownerDocument, size, (ctx) => paint(ctx, theme, true)) : await renderPng(canvas.ownerDocument, size, (ctx) => paint(ctx, theme, true))
      } finally {
        invalidate(false)
      }
    }
  }), [graph, paint, prepare, invalidate])

  // A new sheet brings its own camera, and leaves the other sheet's selection and pins behind.
  React.useEffect(() => {
    viewRef.current = store.viewports[slot] ?? null
    selectedRef.current = null
    pinsRef.current = []
    invalidate(true)
  }, [slot, store, invalidate])

  React.useEffect(() => { invalidate(true) }, [rows, engine, invalidate])
  React.useEffect(() => { invalidate(false) }, [units, invalidate])

  // A visible vector field set to flow resamples the graph with the time, for as long as one is shown.
  const flowing = rows.some((row, index) => row.flow === true && !row.hidden && analyses[index]?.kind === 'field')
  React.useEffect(() => {
    const view = canvasRef.current?.ownerDocument.defaultView
    if (!flowing || !view) return
    return runFlow(view, (time) => {
      flowRef.current = time
      invalidate(true)
    })
  }, [flowing, invalidate])

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

  /** A click (no drag) on a marker pins or unpins its label; on a curve y = f(x) it selects the curve, so its markers stay;
   * anywhere else it clears the selection. */
  const clickAt = (x: number, y: number): void => {
    const { rows } = inputs.current
    // Placed again for the point clicked: the frame drawn while the button was down shows no hover markers.
    const target = placeMarkers(findHit(pathsRef.current, x, y)?.row ?? null).find((entry) => Math.hypot(entry.sx - x, entry.sy - y) <= MARKER_REACH)
    if (target) {
      const id = rows[target.row]?.id
      if (!id) return
      const { kind, other: index, x: mx, y: my } = target.marker
      const other = index === null ? null : rows[index]?.id ?? null
      const same = (pin: Pin): boolean => pin.id === id && pin.kind === kind && pin.other === other && pin.x === mx && pin.y === my
      pinsRef.current = target.pinned ? pinsRef.current.filter((pin) => !same(pin)) : [...pinsRef.current, { id, kind, other, x: mx, y: my }].slice(-MAX_PINS)
    } else {
      const hit = findHit(pathsRef.current, x, y)
      const id = hit && markable(hit.row) ? rows[hit.row]?.id ?? null : null
      selectedRef.current = id !== null && selectedRef.current !== id ? id : null
    }
    invalidate(false)
  }

  const endDrag = (event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    if (drag?.id === event.pointerId) {
      dragRef.current = null
      const at = local(event)
      if (event.type === 'pointerup' && Math.hypot(at.x - drag.x, at.y - drag.y) < 4) clickAt(at.x, at.y)
    }
    invalidate(false)
  }

  const zoomBy = (factor: number): void => {
    const current = viewRef.current
    const size = sizeRef.current
    if (current) setView(zoomed(current, size, factor, size.width / 2, size.height / 2))
  }

  const reset = (): void => {
    delete store.viewports[inputs.current.slot]
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
      '0': reset,
      Escape: () => {
        selectedRef.current = null
        pinsRef.current = []
        invalidate(false)
      }
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

/** A main-workspace tab: its own graph (the main one without an instance id), edited in the sidebar while focused. */
export const GraphTab = ({ instanceId }: { instanceId?: string }): ReactElement => {
  const tab = instanceId || MAIN_GRAPH
  const { loaded, document, engine, problems } = useGrapher()
  const store = getStore()
  React.useEffect(() => { if (loaded) store.ensureGraph(tab) }, [loaded, tab])
  // The tab shows its own graph (or, for a tab from before, the graph it was pointed at); while the bookmark list is
  // open, that graph's bookmark view instead of its expressions.
  const id = graphIdOf(document, tab)
  const graph = store.shownGraph(id)
  const mode = graph.mode
  const slot = store.shownSlot(id, mode)
  const view = viewOf(mode)
  const rows = graph.sheets[mode]
  const analyses = React.useMemo(() => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const engineProblem = problems.find((problem) => problem.key === 'problem.engine')
  const tabRef = React.useRef<HTMLDivElement>(null)
  const [notice, setNotice] = React.useState<ExportNotice | null>(null)
  React.useEffect(() => onExportNotice(id, setNotice), [id])
  // The notice fades after a few seconds, timed in the tab's own window.
  React.useEffect(() => {
    const view = tabRef.current?.ownerDocument.defaultView
    if (!notice || !view) return
    const timer = view.setTimeout(() => setNotice(null), NOTICE_SECONDS * 1000)
    return () => view.clearTimeout(timer)
  }, [notice])
  return (
    <div className="grapher-tab" ref={tabRef}>
      <div className="grapher-topbar">
        <span className="grapher-topbar-title">{uiText(`mode.${mode}`)}</span>
      </div>
      {engineProblem ? <p role="alert" className="grapher-alert">{uiText('problem.engine', { message: engineProblem.message })}</p> : null}
      <div className="grapher-stage">
        {view.canvas === 'space' ? <SpaceCanvas key={slot} view={view} rows={rows} engine={engine} graph={id} slot={slot} units={unitsOf(graph, mode)} /> : <GraphCanvas key={slot} view={view} units={unitsOf(graph, mode)} rows={rows} analyses={analyses} engine={engine} graph={id} slot={slot} />}
      </div>
      {notice ? <p className={`grapher-export-notice${notice.ok ? '' : ' grapher-export-failed'}`} role="status">{notice.text}</p> : null}
    </div>
  )
}
