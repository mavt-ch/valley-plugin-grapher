import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLUGIN_SURFACE_V1 } from '@valley/plugin-sdk'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import * as plugin from '../src/index'
import { GraphTab } from '../src/GraphView'
import { colorOf, paintPlane, readTheme } from '../src/draw'
import { loadPlotEngine, type PlotEngine } from '../src/engine'
import { exportName, PNG_RATIO, renderSvg } from '../src/exporting'
import { createRow, type Row } from '../src/model'
import { SvgContext, splitColor } from '../src/svg'
import { viewOf } from '../src/views'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
let module: PackageWasmModule
let engine: PlotEngine
let disposers: (() => Promise<void>)[] = []

beforeAll(async () => {
  module = await loadPackageWasm(process.cwd(), 'plot')
  engine = await loadPlotEngine(createMockValleyApi({ manifest: { id: 'grapher' }, wasm: { modules: [module] } }).api)
})
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  document.head.querySelectorAll('style[id]').forEach((style) => style.remove())
  vi.restoreAllMocks()
})

function sheet(...texts: string[]): Row[] {
  const rows: Row[] = []
  for (const text of texts) rows.push({ ...createRow(rows), text })
  return rows
}

const parse = (svg: string): Document => new DOMParser().parseFromString(svg, 'image/svg+xml')

describe('the SVG export', () => {
  it('writes a small sheet as a well-formed SVG with its grid, curves, region, point and labels', () => {
    const rows = sheet('y = x^2 - 2', 'y > x + 3', '(1, 2)', 'f(x, y) = x^2 - y^2')
    rows[3] = { ...rows[3], labels: true }
    const size = { width: 400, height: 300 }
    const view = { cx: 0, cy: 0, scale: 20 }
    const analyses = engine.analyze('cartesian', rows)
    const paths = engine.sample('cartesian', rows, size.width, size.height, view)
    const theme = readTheme(document.body)
    const svg = renderSvg(document, size, (ctx) => paintPlane(ctx, viewOf('cartesian') as never, 'decimal', rows, analyses, paths, view, size, theme))
    const doc = parse(svg)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const root = doc.documentElement
    expect(root.tagName).toBe('svg')
    expect(root.getAttribute('viewBox')).toBe('0 0 400 300')
    // Solid background from the theme, first.
    expect(root.firstElementChild?.tagName).toBe('rect')
    expect(root.firstElementChild?.getAttribute('fill')).toBe(splitColor(theme.background).color)
    const elements = [...root.getElementsByTagName('path')]
    const curve = splitColor(colorOf(rows[0].color)).color
    expect(elements.some((path) => path.getAttribute('stroke') === curve && path.getAttribute('stroke-width') === '2.5')).toBe(true)
    const region = splitColor(colorOf(rows[1].color)).color
    expect(elements.some((path) => path.getAttribute('fill') === region && path.getAttribute('fill-opacity') === '0.22')).toBe(true)
    expect(elements.some((path) => path.getAttribute('stroke') === region && path.getAttribute('stroke-dasharray') === '7 5')).toBe(true)
    const point = splitColor(colorOf(rows[2].color)).color
    expect(elements.some((path) => path.getAttribute('fill') === point && /A4\.5 4\.5/.test(path.getAttribute('d') ?? ''))).toBe(true)
    const texts = [...root.getElementsByTagName('text')].map((text) => text.textContent)
    expect(texts).toContain('0')
    expect(texts.filter((text) => /^−?\d+$/.test(text ?? '')).length).toBeGreaterThan(6)
    // Level labels of the labelled contour row.
    expect(texts).toEqual(expect.arrayContaining(['−20', '20', '40']))
    expect(root.getElementsByTagName('text')[0].getAttribute('font-family')).toMatch(/sans-serif$/)
  })

  it('records arcs, rounded boxes, alpha and escaped text', () => {
    const ctx = new SvgContext()
    ctx.beginPath()
    ctx.arc(10, 10, 5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'
    ctx.globalAlpha = 0.5
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.roundRect(0, 0, 40, 20, 4)
    ctx.strokeStyle = '#123456'
    ctx.stroke()
    ctx.font = '600 13px "Inter Var", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('a < b & "c"', 20, 10)
    const doc = parse(ctx.toSvg(40, 20))
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const [circle, box] = [...doc.getElementsByTagName('path')]
    expect(circle.getAttribute('d')).toMatch(/^M15 10A5 5 0 0 1 /)
    expect(circle.getAttribute('fill')).toBe('#ff0000')
    expect(circle.getAttribute('fill-opacity')).toBe('0.25')
    expect(box.getAttribute('fill')).toBe('none')
    expect(box.getAttribute('d')).toContain('A4 4 0 0 1 40 4')
    const text = doc.getElementsByTagName('text')[0]
    expect(text.textContent).toBe('a < b & "c"')
    expect(text.getAttribute('font-weight')).toBe('600')
    expect(text.getAttribute('text-anchor')).toBe('middle')
    expect(text.getAttribute('dominant-baseline')).toBe('central')
    expect(text.getAttribute('font-family')).toBe('"Inter Var", sans-serif')
  })

  it('names files after the view and the local time', () => {
    expect(exportName('cartesian', 'svg', new Date(2026, 10, 13, 0, 41, 5))).toBe('grapher-cartesian-20261113-004105.svg')
    expect(exportName('space', 'png', new Date(2026, 0, 2, 13, 4, 0))).toBe('grapher-space-20260102-130400.png')
  })
})

describe('the export menu', () => {
  function mount(files: Record<string, string> = {}) {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
    disposers.push(plugin.register(mock.api))
    return mock
  }

  const surface = (mock: ReturnType<typeof mount>) => {
    expect(declared.provides?.some((entry) => entry.id === PLUGIN_SURFACE_V1.id)).toBe(true)
    const [provider] = mock.api.interop.extensions.providers(PLUGIN_SURFACE_V1)
    expect(provider.extension).toMatchObject({ surface: 'main_workspace' })
    return provider.extension
  }

  it('offers PNG and SVG for a flat graph and PNG only for 3D', async () => {
    const mock = mount({ [`${pluginDataDirectoryPath('grapher')}/graphs.json`]: JSON.stringify({ version: 1, mode: 'space' }) })
    const extension = surface(mock)
    expect(extension.getSnapshot().actions ?? []).toEqual([])
    const view = render(<GraphTab />)
    await waitFor(() => expect((extension.getSnapshot().actions ?? []).map((action) => action.id)).toEqual(['export-png']))
    view.unmount()
    expect(extension.getSnapshot().actions ?? []).toEqual([])
    const cartesian = render(<GraphTab instanceId="g-flat" />)
    await act(async () => { await extension.restore({ mode: 'cartesian' }, 'g-flat') })
    await waitFor(() => expect((extension.getSnapshot('g-flat').actions ?? []).map((action) => [action.id, action.label])).toEqual([['export-png', 'Export as PNG'], ['export-svg', 'Export as SVG']]))
    cartesian.unmount()
  })

  it('saves the PNG as bytes and the SVG as text through downloadFile and says where they went', async () => {
    const mock = mount()
    const extension = surface(mock)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) })
    // jsdom has no 2D canvas: the recording context stands in for it, and toBlob hands back fixed PNG bytes.
    const canvases: HTMLCanvasElement[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this)
      return new SvgContext() as unknown as CanvasRenderingContext2D
    } as never)
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([signature], { type: 'image/png' })))
    const download = vi.spyOn(mock.api.files, 'downloadFile').mockImplementation(async (name) => `/downloads/${name}`)
    render(<GraphTab />)
    await waitFor(() => expect(extension.getSnapshot().actions?.length).toBe(2))
    const [png, svg] = extension.getSnapshot().actions ?? []
    await act(async () => { await png.onSelect?.() })
    const [pngName, pngContent] = download.mock.calls[0] as unknown as [string, Uint8Array]
    expect(pngName).toMatch(/^grapher-cartesian-\d{8}-\d{6}\.png$/)
    expect(pngContent).toBeInstanceOf(Uint8Array)
    expect([...pngContent]).toEqual([...signature])
    const exported = canvases.find((canvas) => canvas.width === 400 * PNG_RATIO && canvas.height === 300 * PNG_RATIO)
    expect(exported).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(`Exported to /downloads/${pngName}`)
    await act(async () => { await svg.onSelect?.() })
    const [svgName, svgContent] = download.mock.calls[1] as unknown as [string, string]
    expect(svgName).toMatch(/^grapher-cartesian-\d{8}-\d{6}\.svg$/)
    expect(typeof svgContent).toBe('string')
    const doc = parse(svgContent)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.getElementsByTagName('path').length).toBeGreaterThan(3)
    download.mockResolvedValueOnce(null)
    await act(async () => { await svg.onSelect?.() })
    expect(screen.getByRole('status').textContent).toBe('Export failed: the download folder took no file.')
  })
})
