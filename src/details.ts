import { WORKSPACE_DETAILS_V1, type ValleyPluginApi, type WorkspaceDetailsSnapshot } from '@valley/plugin-sdk'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import { UNIT_GLYPHS, toWorldX, toWorldY, type Size } from './draw'
import type { Camera, Viewport } from './engine'
import { uiText } from './localization'
import { MAIN_GRAPH, filled, scaleOf, unitsOf } from './model'
import { GRAPHS_FILE, type GrapherStore } from './store'
import { formatNumber } from './ticks'
import { viewOf } from './views'

/** What the canvases last drew, per sheet (`graph:mode`): the Info rows read it; nothing here is saved. */
const canvases = new Map<string, { size: Size; view?: Viewport; camera?: Camera; pins?: number }>()
/** Sliders playing now, as `graph row` keys. */
const playing = new Set<string>()
const listeners = new Set<() => void>()
const THROTTLE = 250
let timer: ReturnType<typeof setTimeout> | null = null

/** Tells the Info rows something changed: at most four updates a second, and always one after the last change. */
export function touchDetails(): void {
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    listeners.forEach((listener) => listener())
  }, THROTTLE)
}

export function noteCanvas(slot: string, state: { size: Size; view?: Viewport; camera?: Camera; pins?: number }): void {
  canvases.set(slot, state)
  touchDetails()
}

export function notePlaying(graph: string, row: string, on: boolean): void {
  if (on) playing.add(`${graph} ${row}`)
  else playing.delete(`${graph} ${row}`)
  touchDetails()
}

export const DETAIL_ITEMS = ['view', 'expressions', 'sliders', 'tables', 'units', 'range', 'camera', 'pins', 'playing', 'file', 'graph'] as const

const span = (from: number, to: number): string => `${formatNumber(from, 4)} … ${formatNumber(to, 4)}`
const degrees = (radians: number): string => `${formatNumber((radians * 180) / Math.PI, 3)}°`

/** The Info rows of one graph tab; a row without text is left out by the host. */
export function graphDetails(store: GrapherStore, instanceId: string | undefined): WorkspaceDetailsSnapshot {
  const { document, engine } = store.getSnapshot()
  const id = store.graphIdOf(instanceId || MAIN_GRAPH)
  const graph = store.shownGraph(id)
  const mode = graph.mode
  const view = viewOf(mode)
  const rows = graph.sheets[mode].filter(filled)
  const analyses = engine ? engine.analyze(mode, rows) : []
  const hidden = rows.filter((row) => row.hidden).length
  const sliders = analyses.filter((analysis) => analysis.kind === 'param' && analysis.slider).length
  const tables = rows.filter((row) => row.table)
  const points = analyses.reduce((total, analysis) => total + (analysis.kind === 'table' ? analysis.count ?? 0 : 0), 0)
  const canvas = canvases.get(store.shownSlot(id, mode))
  const playingHere = [...playing].filter((key) => key.startsWith(`${id} `)).length
  let range = ''
  let camera = ''
  if (canvas?.view && canvas.size.width > 0 && canvas.size.height > 0) {
    const { view: v, size } = canvas
    range = uiText('details.planeRange', { x: span(toWorldX(v, size, 0), toWorldX(v, size, size.width)), y: span(toWorldY(v, size, size.height), toWorldY(v, size, 0)) })
  } else if (canvas?.camera) {
    range = uiText('details.cubeRange', { range: span(-canvas.camera.range, canvas.camera.range) })
    camera = uiText('details.cameraAngles', { yaw: degrees(canvas.camera.yaw), pitch: degrees(canvas.camera.pitch) })
  }
  const text = (value: string): { text: string } => ({ text: value })
  return {
    items: {
      view: text(uiText(`mode.${mode}`)),
      expressions: text(hidden ? uiText('details.hidden', { count: rows.length, hidden }) : String(rows.length)),
      sliders: text(sliders ? String(sliders) : ''),
      tables: text(tables.length ? uiText('details.points', { count: tables.length, points }) : ''),
      units: text(view.canvas === 'plane' ? [UNIT_GLYPHS[unitsOf(graph, mode)], ...(scaleOf(graph, mode) === 'linear' ? [] : [uiText(`scale.${scaleOf(graph, mode)}`)])].join(' · ') : ''),
      range: text(range),
      camera: text(camera),
      pins: text(canvas?.pins ? String(canvas.pins) : ''),
      playing: text(playingHere ? String(playingHere) : ''),
      file: text(`${pluginDataDirectoryPath('grapher')}/${GRAPHS_FILE}`),
      graph: text(id)
    }
  }
}

/** Info rows of the focused graph tab in the right sidebar's Properties (and choices for the footer). */
export function provideGraphDetails(api: ValleyPluginApi, store: GrapherStore): () => void {
  return api.interop.extensions.provide(WORKSPACE_DETAILS_V1, {
    id: 'grapher.details',
    label: 'Grapher',
    labelKey: 'graph.title',
    pluginViews: true,
    items: DETAIL_ITEMS.map((item) => ({ id: `grapher.${item}`, label: uiText(`details.${item}`), labelKey: `details.${item}`, kind: 'text' as const })),
    defaultItems: ['grapher.view'],
    getSnapshot: (context) => {
      const { items } = graphDetails(store, context.instanceId)
      return { items: Object.fromEntries(Object.entries(items).map(([key, value]) => [`grapher.${key}`, value])) }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      const off = store.subscribe(touchDetails)
      return () => {
        listeners.delete(listener)
        off()
      }
    }
  })
}
