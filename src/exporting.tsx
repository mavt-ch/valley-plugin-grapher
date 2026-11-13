import { PLUGIN_SURFACE_V1, type UiMenuItem, type ValleyPluginApi } from '@valley/plugin-sdk'
import { React, api } from './runtime'
import type { Size } from './draw'
import { Download } from './icons'
import { uiText } from './localization'
import { MAIN_GRAPH, MODES, type Mode } from './model'
import { SvgContext, type Measure, type Normalize } from './svg'
import type { GrapherStore } from './store'

/**
 * Export of the graph a tab shows: PNG for every view, SVG for the flat ones (3D is drawn as depth-sorted polygons that
 * only make sense as pixels). Each mounted canvas registers an exporter under its graph id; the tab's three-dot menu (the
 * host's plugin surface header, fed by `PluginSurfaceSnapshot.actions`) offers the formats it has. Files go through
 * `api.files.downloadFile` into the user's download folder; a PNG is passed as bytes, which the host writes as they are
 * (the vendored SDK types still declare text only, the host and the current SDK accept `string | Uint8Array`).
 */
export type ExportFormat = 'png' | 'svg'

/** Pixels per CSS pixel in an exported PNG, whatever the screen: sharp on a high-density display and in print. */
export const PNG_RATIO = 2

/** Seconds the export notice stays in the tab. */
export const NOTICE_SECONDS = 6

export interface Exporter {
  mode: () => Mode
  formats: readonly ExportFormat[]
  render: (format: ExportFormat) => Promise<string | Uint8Array>
}

export interface ExportNotice {
  ok: boolean
  text: string
}

const exporters = new Map<string, Exporter>()
const announcers = new Map<string, (notice: ExportNotice) => void>()
const listeners = new Set<() => void>()
const changed = (): void => listeners.forEach((listener) => listener())

export function registerExporter(graph: string, exporter: Exporter): () => void {
  exporters.set(graph, exporter)
  changed()
  return () => {
    if (exporters.get(graph) !== exporter) return
    exporters.delete(graph)
    changed()
  }
}

export function onExportNotice(graph: string, announce: (notice: ExportNotice) => void): () => void {
  announcers.set(graph, announce)
  return () => { if (announcers.get(graph) === announce) announcers.delete(graph) }
}

export function subscribeExporters(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const two = (value: number): string => String(value).padStart(2, '0')

/** `grapher-cartesian-20261113-004105.png`: the view and the local time, so exports sort and never clash. */
export function exportName(mode: Mode, format: ExportFormat, date: Date): string {
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  return `grapher-${mode}-${day}-${time}.${format}`
}

/** The host writes text or bytes; the vendored SDK declares only text. */
type Download = (filename: string, content: string | Uint8Array) => Promise<string | null>

/** Renders the graph's current frame in `format` and saves it; the tab shows where it went or why it failed. */
export async function exportGraph(graph: string, format: ExportFormat): Promise<string | null> {
  const exporter = exporters.get(graph)
  const announce = (notice: ExportNotice): void => announcers.get(graph)?.(notice)
  if (!exporter || !exporter.formats.includes(format)) return null
  try {
    const content = await exporter.render(format)
    const path = await (api.files.downloadFile as Download)(exportName(exporter.mode(), format, new Date()), content)
    announce(path ? { ok: true, text: uiText('export.saved', { path }) } : { ok: false, text: uiText('export.failed', { message: uiText('export.noFile') }) })
    return path
  } catch (error) {
    announce({ ok: false, text: uiText('export.failed', { message: error instanceof Error && error.message ? error.message : String(error) }) })
    return null
  }
}

/** The three-dot menu entries of a graph tab: the formats its canvas can write. */
export function exportActions(graph: string): UiMenuItem[] {
  const exporter = exporters.get(graph)
  if (!exporter) return []
  return exporter.formats.map((format) => ({
    id: `export-${format}`,
    label: uiText(`export.${format}`),
    icon: <Download />,
    onSelect: () => exportGraph(graph, format)
  }))
}

/** The graph tab as a plugin surface: its title, its view (the sheet) and the export actions of its menu. */
export function provideGraphSurface(pluginApi: ValleyPluginApi, store: GrapherStore): () => void {
  return pluginApi.interop.extensions.provide(PLUGIN_SURFACE_V1, {
    id: 'grapher.main_workspace',
    surface: 'main_workspace',
    getSnapshot: (instanceId) => {
      const graph = instanceId || MAIN_GRAPH
      // Graph tabs always carry an instance; the right sidebar's reference tab has none and shows a page icon.
      return { title: uiText('graph.title'), ...(instanceId ? {} : { visual: { kind: 'icon' as const, name: 'sticky-note' } }), view: { mode: store.graph(graph).mode }, actions: exportActions(graph) }
    },
    subscribe: (listener) => {
      const offs = [store.subscribe(listener), subscribeExporters(listener), pluginApi.ui.onLanguageChanged(listener)]
      return () => offs.forEach((off) => off())
    },
    restore: (state, instanceId) => {
      const mode = state.mode
      if (typeof mode === 'string' && MODES.includes(mode as Mode)) store.setMode(instanceId || MAIN_GRAPH, mode as Mode)
    }
  })
}

/** Text widths from a real canvas in this document, or a character estimate where there is none (tests). */
export function measureIn(document: Document): Measure | undefined {
  const ctx = scratch(document)
  if (!ctx) return undefined
  return (font, text) => {
    ctx.font = font
    return ctx.measureText(text).width
  }
}

/** Any CSS colour (tokens may use `color-mix`, `oklch` …) resolved by the canvas to `#rrggbb` or `rgba(…)`. */
export function normalizeIn(document: Document): Normalize | undefined {
  const ctx = scratch(document)
  if (!ctx) return undefined
  return (color) => {
    ctx.fillStyle = '#000000'
    ctx.fillStyle = color
    return String(ctx.fillStyle)
  }
}

function scratch(document: Document): CanvasRenderingContext2D | null {
  try {
    return document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
}

/** The frame painted by `paint` as an SVG document of `size` CSS pixels. */
export function renderSvg(document: Document, size: Size, paint: (ctx: CanvasRenderingContext2D) => void): string {
  const svg = new SvgContext(measureIn(document), normalizeIn(document))
  paint(svg as unknown as CanvasRenderingContext2D)
  return svg.toSvg(size.width, size.height)
}

/** The frame painted by `paint` as PNG bytes at {@link PNG_RATIO} pixels per CSS pixel. */
export async function renderPng(document: Document, size: Size, paint: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(size.width * PNG_RATIO))
  canvas.height = Math.max(1, Math.round(size.height * PNG_RATIO))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(uiText('export.noCanvas'))
  ctx.setTransform(PNG_RATIO, 0, 0, PNG_RATIO, 0, 0)
  paint(ctx)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(uiText('export.noCanvas'))
  return bytesOf(blob)
}

/** A blob's bytes; through a FileReader where `Blob.arrayBuffer` is missing (jsdom). */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error(uiText('export.noCanvas')))
    reader.readAsArrayBuffer(blob)
  })
}
