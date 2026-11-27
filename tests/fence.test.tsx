import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { FENCE_HEIGHT, fenceHome, parseGrapherFence } from '../src/fence'
import { viewOf, type PlaneView } from '../src/views'
import { SvgContext } from '../src/svg'
import codeBlockExamples from '../src/codeBlockExamples.json'
import en from '../locales/en.json'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
let module: PackageWasmModule
let disposers: (() => Promise<void>)[] = []
let cleanups: (() => void)[] = []

beforeAll(async () => { module = await loadPackageWasm(process.cwd(), 'plot') })
afterEach(async () => {
  act(() => { cleanups.splice(0).forEach((cleanup) => cleanup()) })
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[id]').forEach((style) => style.remove())
  vi.restoreAllMocks()
})

function mount() {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
  // The host mounts the block's React tree into its element; the mock's renderReact draws nothing.
  vi.spyOn(mock.api.ui, 'renderReact').mockImplementation((el, node) => {
    const root = createRoot(el)
    act(() => root.render(node))
    return () => act(() => root.unmount())
  })
  disposers.push(plugin.register(mock.api))
  return mock
}

/** Renders a block the way a reading view does: the fence's source into a host element. */
function block(mock: ReturnType<typeof mount>, code: string): HTMLElement {
  const render = mock.codeBlockRenderers.get('grapher')
  expect(render).toBeDefined()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    const cleanup = render!(code, el, { path: 'plugins/grapher/grapher-codeblocks.md', meta: null })
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  })
  return el
}

describe('the grapher block syntax', () => {
  it('reads settings, rows and their options', () => {
    const spec = parseGrapherFence([
      'view: polar',
      'units: decimal',
      'height: 400px',
      'center: 1, -2',
      'span: 12',
      '',
      'r = 2 sin(3θ) ; θ = 0 .. 4π ; blue',
      'a = 2 ; slider 0 .. 5 ; step 0.5 ; hidden',
      'r = {θ < π: 1, 2} ; #ff8800'
    ].join('\n'))
    expect(spec).toMatchObject({ mode: 'polar', units: 'decimal', height: 400, center: [1, -2], span: 12, range: null, problems: [], lines: [7, 8, 9] })
    expect(spec.rows.map((row) => row.text)).toEqual(['r = 2 sin(3θ)', 'a = 2', 'r = {θ < π: 1, 2}'])
    expect(spec.rows[0]).toMatchObject({ from: '0', to: '4π', color: 'palette:blue', hidden: false })
    expect(spec.rows[1]).toMatchObject({ slider: { min: 0, max: 5, step: 0.5 }, hidden: true })
    expect(spec.rows[2].color).toBe('#ff8800')
  })

  it('takes a second range for a surface and the 3D flags', () => {
    const spec = parseGrapherFence('view: 3d\nrange: 6\nz = x y ; floor\n(u cos v, u sin v, v) ; 0 .. 2 ; v = 0 .. 2π\nF(x, y, z) = (-y, x, 0) ; flow')
    expect(spec.mode).toBe('space')
    expect(spec.range).toBe(6)
    expect(spec.rows[0].floor).toBe(true)
    expect(spec.rows[1]).toMatchObject({ from: '0', to: '2', from2: '0', to2: '2π' })
    expect(spec.rows[2].flow).toBe(true)
  })

  it('defaults to the Cartesian view at the default height, with the view’s own axis labels', () => {
    expect(parseGrapherFence('y = x')).toMatchObject({ mode: 'cartesian', units: 'decimal', height: FENCE_HEIGHT.default, center: null, span: null })
    expect(parseGrapherFence('view: Polar\nr = 1').units).toBe('pi')
    expect(parseGrapherFence('units: degrees\ny = sin(x)').units).toBe('degrees')
    expect(parseGrapherFence('units: scientific\ny = x^2').units).toBe('scientific')
    expect(parseGrapherFence('view: complex 3d\nz').mode).toBe('complexSpace')
    expect(parseGrapherFence('height: 5000\ny = x').height).toBe(FENCE_HEIGHT.max)
    expect(parseGrapherFence('height: 20\ny = x').height).toBe(FENCE_HEIGHT.min)
  })

  it('names what it does not understand', () => {
    const spec = parseGrapherFence('view: sideways\nunits: furlongs\nspan: -1\ncenter: 1\ny = x ; dotted\na = 1 ; slider 5 .. 1\nb = 1 ; step 0')
    expect(spec.mode).toBe('cartesian')
    expect(spec.problems).toEqual([
      { key: 'fence.unknownOption', args: { line: 5, option: 'dotted' } },
      { key: 'fence.badSlider', args: { line: 6 } },
      { key: 'fence.badStep', args: { line: 7 } },
      { key: 'fence.unknownView', args: { value: 'sideways' } },
      { key: 'fence.unknownUnits', args: { value: 'furlongs' } },
      { key: 'fence.badSetting', args: { key: 'center' } },
      { key: 'fence.badSetting', args: { key: 'span' } }
    ])
    expect(parseGrapherFence('view: polar\n\n').problems).toEqual([{ key: 'fence.empty', args: {} }])
  })

  it('opens a flat view on its centre with the span across the width', () => {
    const cartesian = viewOf('cartesian') as PlaneView
    expect(fenceHome(cartesian, { center: [2, 3], span: 10, scale: 'linear' }, { width: 500, height: 300 })).toEqual({ cx: 2, cy: 3, scale: 50 })
    expect(fenceHome(cartesian, { center: null, span: null, scale: 'linear' }, { width: 500, height: 300 }).cx).toBe(0)
    // On a logarithmic axis the centre is a value whose logarithm the view keeps.
    expect(fenceHome(cartesian, { center: [100, 3], span: 10, scale: 'log-x' }, { width: 500, height: 300 })).toEqual({ cx: 2, cy: 3, scale: 50, axes: 1 })
    expect(fenceHome(cartesian, { center: null, span: null, scale: 'log' }, { width: 500, height: 300 })).toMatchObject({ cx: 1, cy: 1, axes: 3 })
  })

  it('reads a logarithmic scale on the views that have one', () => {
    expect(parseGrapherFence('scale: log-y\ny = e^x').scale).toBe('log-y')
    expect(parseGrapherFence('scale: log-log\ny = x^2').scale).toBe('log')
    expect(parseGrapherFence('scale: semilog x\ny = ln(x)').scale).toBe('log-x')
    expect(parseGrapherFence('y = x').scale).toBe('linear')
    expect(parseGrapherFence('scale: cubic\ny = x').problems).toEqual([{ key: 'fence.unknownScale', args: { value: 'cubic' } }])
    const polar = parseGrapherFence('view: polar\nscale: log\nr = 1')
    expect(polar.scale).toBe('linear')
    expect(polar.problems.map((problem) => problem.key)).toEqual(['fence.scaleView'])
  })

  it('ships examples that parse without problems and have their labels in every catalog', () => {
    for (const example of codeBlockExamples.grapher) {
      expect(parseGrapherFence(example.code).problems, example.id).toEqual([])
      expect((en as Record<string, string>)[example.labelKey]).toBe(example.label)
    }
  })
})

describe('the grapher block in a note', () => {
  it('draws the graph with zoom controls, the view and Open in Grapher', async () => {
    const mock = mount()
    const el = block(mock, 'view: polar\nr = 2 sin(3θ)')
    expect(el.classList.contains('grapher-fence')).toBe(true)
    const scope = within(el)
    expect(scope.getByLabelText(/^Polar graph\. Drag to pan, pinch to zoom/)).toBeTruthy()
    for (const name of ['Zoom in', 'Zoom out', 'Reset view']) expect(scope.getByRole('button', { name })).toBeTruthy()
    expect(scope.getByText('Polar')).toBeTruthy()
    expect((el.querySelector('.grapher-fence-stage') as HTMLElement).style.height).toBe('320px')
    await waitFor(() => expect((scope.getByRole('button', { name: 'Open in Grapher' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('lets the plain wheel scroll the note and zooms on a pinch', async () => {
    const mock = mount()
    const el = block(mock, 'y = x')
    await waitFor(() => expect((within(el).getByRole('button', { name: 'Open in Grapher' }) as HTMLButtonElement).disabled).toBe(false))
    const canvas = el.querySelector('canvas')!
    const plain = new WheelEvent('wheel', { deltaY: 40, cancelable: true, bubbles: true })
    canvas.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    const pinch = new WheelEvent('wheel', { deltaY: 40, ctrlKey: true, cancelable: true, bubbles: true })
    canvas.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
  })

  it('moves a slider in the block only and lists the errors by line', async () => {
    const mock = mount()
    const el = block(mock, 'y = a sin(x)\na = 2 ; slider 0 .. 4 ; step 0.5\ny = (\ny = x ; wavy')
    const scope = within(el)
    const slider = await scope.findByRole('slider', { name: 'Value of a' }) as HTMLInputElement
    expect(slider.value).toBe('2')
    expect(slider.min).toBe('0')
    expect(slider.max).toBe('4')
    fireEvent.change(slider, { target: { value: '3.5' } })
    expect(scope.getByText('3.5')).toBeTruthy()
    expect(scope.getByRole('button', { name: 'Play a' })).toBeTruthy()
    expect(scope.getByText('Line 4: unknown option “wavy”.')).toBeTruthy()
    expect(scope.getByText(/^Line 3: /)).toBeTruthy()
    expect(await mock.api.data.files.readText('graphs.json')).toBeNull()
  })

  it('opens its rows as a new graph tab', async () => {
    const mock = mount()
    const el = block(mock, 'view: parametric\n(cos t, sin t) ; 0 .. π ; green')
    const button = within(el).getByRole('button', { name: 'Open in Grapher' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    const open = mock.api.workspace.openMainTab as unknown as { mock: { calls: [{ instanceId?: string; newTab?: boolean; title?: string }][] } }
    const call = open.mock.calls[open.mock.calls.length - 1][0]
    expect(call).toMatchObject({ newTab: true, title: 'Grapher' })
    expect(call.instanceId).toMatch(/^g-/)
    await waitFor(async () => {
      const saved = JSON.parse(await mock.api.data.files.readText('graphs.json') ?? '{}') as { graphs: Record<string, { mode: string; sheets: Record<string, { text: string; from: string; to: string; color: string }[]> }> }
      const graph = saved.graphs[call.instanceId!]
      expect(graph.mode).toBe('parametric')
      expect(graph.sheets.parametric[0]).toMatchObject({ text: '(cos t, sin t)', from: '0', to: 'π', color: 'palette:green' })
      expect(graph.sheets.parametric[1].text).toBe('')
    }, { timeout: 2000 })
  })

  it('paints curves once the engine has loaded', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) })
    const contexts: SvgContext[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      const context = new SvgContext()
      contexts.push(context)
      return context as unknown as CanvasRenderingContext2D
    } as never)
    const mock = mount()
    block(mock, 'y = sin(x)')
    await waitFor(() => expect(contexts.some((context) => (context.toSvg(400, 300).match(/<path /g) ?? []).length > 3)).toBe(true), { timeout: 3000 })
  })
})
