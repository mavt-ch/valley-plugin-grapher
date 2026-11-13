import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { loadPlotEngine, type PlotEngine } from '../src/engine'
import { createRow, type Row } from '../src/model'
import { REFERENCE } from '../src/Reference'
import { graphDetails, noteCanvas } from '../src/details'
import { getStore } from '../src/store'
import { formatNumber } from '../src/ticks'
import { Sidebar, takesTables } from '../src/Sidebar'
import { Reference } from '../src/Reference'
import { VIEWS, viewOf } from '../src/views'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
const NOT_DRAWN = new Set(['error', 'empty', 'definition', 'param', 'value'])
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
})

function sheet(...texts: string[]): Row[] {
  const rows: Row[] = []
  for (const text of texts) rows.push({ ...createRow(rows), text })
  return rows
}

function mount(): ReturnType<typeof createMockValleyApi> {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
  disposers.push(plugin.register(mock.api))
  return mock
}

const input = (index: number): HTMLInputElement => screen.getByRole('textbox', { name: new RegExp(`^Expression ${index}$`) }) as HTMLInputElement

describe('the insert bar templates', () => {
  it('draws every listed template on its own sheet', () => {
    for (const view of VIEWS) {
      for (const insert of view.inserts ?? []) {
        if (insert.text === 'table') {
          expect(takesTables(view.id), `${view.id} table`).toBe(true)
          continue
        }
        const rows = sheet(...(insert.needs ? [insert.needs] : []), insert.text)
        const kind = engine.analyze(view.id, rows).at(-1)?.kind ?? 'empty'
        expect(NOT_DRAWN.has(kind), `${view.id}: ${insert.text} is ${kind}`).toBe(false)
        if (insert.select) expect(insert.text).toContain(insert.select)
      }
    }
  })

  it('accepts every reference example on at least one view of its group', () => {
    for (const group of REFERENCE) {
      for (const entry of group.entries) {
        for (const example of entry.examples ?? []) {
          if (example === 'table') continue
          const accepted = group.views.some((mode) => {
            const kind = engine.analyze(mode, sheet(...(example.includes("f'") ? ['f(x) = x^3'] : []), example)).at(-1)?.kind
            return kind !== undefined && kind !== 'error' && kind !== 'empty'
          })
          expect(accepted, `${group.id}: ${example}`).toBe(true)
        }
      }
    }
  })
})

describe('the insert bar', () => {
  it('shows the view entries and types a template into the empty row with its placeholder selected', async () => {
    mount()
    render(<Sidebar />)
    const bar = await screen.findByRole('toolbar', { name: 'Insert' })
    expect(within(bar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(viewOf('cartesian').inserts!.map((insert) => ({
      sum: 'Insert a sum Σ', prod: 'Insert a product ∏', int: 'Insert an integral ∫', derivative: 'Insert a derivative f′(x)', tangent: 'Insert a tangent',
      piecewise: 'Insert a piecewise function', field: 'Insert a vector field', levels: 'Insert level curves of f(x, y)', table: 'Add a table of points'
    } as Record<string, string>)[insert.id]))
    fireEvent.click(within(bar).getByRole('button', { name: 'Insert a sum Σ' }))
    const row = input(5)
    await waitFor(() => expect(row.value).toBe('sum(n, 1, 5, x^n / n)'))
    expect(document.activeElement).toBe(row)
    expect(row.value.slice(row.selectionStart!, row.selectionEnd!)).toBe('x^n / n')
    await waitFor(() => expect(screen.getAllByRole('listitem')[4].getAttribute('data-kind')).toBe('function'))
    expect(input(6).value).toBe('')
  })

  it('types into the focused row at the caret and adds f(x) above a derivative', async () => {
    mount()
    render(<Sidebar />)
    const bar = await screen.findByRole('toolbar', { name: 'Insert' })
    const row = input(1)
    act(() => {
      row.focus()
      row.setSelectionRange(4, 4)
    })
    fireEvent.mouseDown(within(bar).getByRole('button', { name: 'Insert an integral ∫' }))
    fireEvent.click(within(bar).getByRole('button', { name: 'Insert an integral ∫' }))
    await waitFor(() => expect(input(1).value).toBe('y = int(sin(x), 0, π)x^2 - 2'))
    expect(input(1).value.slice(input(1).selectionStart!, input(1).selectionEnd!)).toBe('sin(x)')
    act(() => input(1).blur())
    fireEvent.click(within(bar).getByRole('button', { name: 'Insert a derivative f′(x)' }))
    await waitFor(() => expect(input(6).value).toBe("f'(x)"))
    expect(input(5).value).toBe('f(x) = x^3')
    await waitFor(() => expect(screen.getAllByRole('listitem')[5].getAttribute('data-kind')).toBe('function'))
  })

  it('turns the empty row into a table and shows no bar on a view without entries', async () => {
    mount()
    const { container } = render(<Sidebar />)
    fireEvent.click(within(await screen.findByRole('toolbar', { name: 'Insert' })).getByRole('button', { name: 'Add a table of points' }))
    await waitFor(() => expect(screen.getByRole('group', { name: 'Table 5' })).toBeTruthy())
    const complex = viewOf('complex') as { inserts?: unknown }
    const saved = complex.inserts
    complex.inserts = undefined
    try {
      fireEvent.click(screen.getByRole('button', { name: 'View: Cartesian' }))
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Coordinate system' })).getByRole('radio', { name: /^Complex(?! 3D)/ }))
      await screen.findByDisplayValue('w = 2e^(iπ/3)')
      expect(container.querySelector('.grapher-insert-bar')).toBeNull()
    } finally {
      complex.inserts = saved
    }
  })
})

describe('the reference', () => {
  it('lists the focused view groups first and open, inserts an example, and leaves only a short hint on the left', async () => {
    const { api } = mount()
    const { container } = render(<><Sidebar /><Reference /></>)
    await screen.findByRole('searchbox', { name: 'Search the reference' })
    const headings = Array.from(container.querySelectorAll<HTMLButtonElement>('.grapher-ref-heading'))
    expect(headings.slice(0, 3).map((heading) => heading.textContent)).toEqual(['Basics', 'Calculus', 'Sums and products'])
    expect(headings[0].getAttribute('aria-expanded')).toBe('true')
    const polar = headings.find((heading) => heading.textContent === 'Polar')!
    expect(polar.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-group="polar"] .grapher-ref-entry')).toBeNull()
    fireEvent.click(polar)
    expect(polar.getAttribute('aria-expanded')).toBe('true')
    expect(within(container.querySelector<HTMLElement>('[data-group="polar"]')!).getByRole('button', { name: /r = 2cos\(3θ\)/ }).hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insert tangent(x^2, 1)' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Insert tangent(x^2, 1)' }))
    await waitFor(() => expect(input(5).value).toBe('tangent(x^2, 1)'))
    expect(container.querySelector('.grapher-hint')?.textContent).toBe('The bar above inserts templates; the Grapher tab in Properties lists every feature. Open the reference')
    const reveal = vi.spyOn(api.workspace, 'showProperties').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Open the reference' }))
    expect(reveal).toHaveBeenCalledWith(expect.any(String), { segmentId: 'grapher.reference' })
  })

  it('filters every group by a search and restores the grouped view when cleared', async () => {
    mount()
    const { container } = render(<Reference />)
    const search = await screen.findByRole('searchbox', { name: 'Search the reference' })
    const headings = (): string[] => Array.from(container.querySelectorAll('.grapher-ref-heading')).map((heading) => heading.textContent ?? '')
    fireEvent.change(search, { target: { value: 'tangent' } })
    expect(headings()).toEqual(['Calculus', '3D'])
    expect(Array.from(container.querySelectorAll('.grapher-ref-syntax')).map((code) => code.textContent)).toEqual(['tangent(f, a)', 'tangent(f, a, b)'])
    expect(container.querySelector('[data-group="space"] .grapher-ref-heading')?.getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(search, { target: { value: 'polar angle' } })
    expect(headings()).toEqual(['Spherical'])
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(headings()).toEqual([])
    expect(screen.getByRole('status').textContent).toBe('Nothing matches “zzz”')
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }))
    expect(headings().slice(0, 2)).toEqual(['Basics', 'Calculus'])
    expect(container.querySelector('[data-group="space"] .grapher-ref-heading')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('is a Properties segment of graph tabs and no right-sidebar slot', async () => {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
    const provide = vi.spyOn(mock.api.interop.extensions, 'provide')
    disposers.push(plugin.register(mock.api))
    expect(JSON.stringify(config)).not.toContain('right_sidebar')
    const declaredIds = config.provides.map((entry) => entry.id)
    for (const [contract] of provide.mock.calls) expect(declaredIds, `config.json provides ${(contract as { id: string }).id}`).toContain((contract as { id: string }).id)
    expect(declaredIds).toEqual(expect.arrayContaining(['metadataPanel.segment', 'workspace.details']))
    const segment = provide.mock.calls.map(([, value]) => value as { id?: string; icon?: string; pluginSurfaces?: string[]; render?: (context: unknown) => React.ReactNode }).find((value) => value.id === 'grapher.reference')
    expect(segment).toMatchObject({ icon: 'sticky-note', pluginSurfaces: ['main_workspace'] })
    render(<>{segment!.render!({ relPath: '', kind: 'unsupported', tab: { pluginId: 'grapher' } })}</>)
    expect(await screen.findByRole('searchbox', { name: 'Search the reference' })).toBeTruthy()
  })

  it('collapses and expands every group with one button, also on a filtered list', async () => {
    mount()
    const { container } = render(<Reference />)
    const expanded = (): string[] => Array.from(container.querySelectorAll('.grapher-ref-heading[aria-expanded="true"]')).map((heading) => heading.textContent ?? '')
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse all groups' }))
    expect(expanded()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Expand all groups' }))
    expect(expanded()).toHaveLength(REFERENCE.length)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the reference' }), { target: { value: 'tangent' } })
    expect(expanded()).toEqual(['Calculus', '3D'])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all groups' }))
    expect(expanded()).toEqual([])
    expect(container.querySelectorAll('.grapher-ref-heading')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all groups' }))
    expect(expanded()).toEqual(['Calculus', '3D'])
  })
})

describe('the Info rows', () => {
  it('describe a Cartesian sheet and a 3D sheet', async () => {
    mount()
    render(<Sidebar />)
    await screen.findByRole('toolbar', { name: 'Insert' })
    await waitFor(() => expect(getStore().getSnapshot().engine).toBeTruthy())
    noteCanvas('main:cartesian', { size: { width: 200, height: 100 }, view: { cx: 0, cy: 0, scale: 10 }, pins: 2 })
    const plane = graphDetails(getStore(), undefined).items
    expect(Object.fromEntries(Object.entries(plane).map(([key, value]) => [key, value.text]))).toEqual({
      view: 'Cartesian', expressions: '4', sliders: '2', tables: '', units: 'ℝ',
      range: `x ${formatNumber(-10)} … ${formatNumber(10)}, y ${formatNumber(-5)} … ${formatNumber(5)}`, camera: '', pins: '2', playing: '',
      file: '.valley/plugins/data/grapher/graphs.json', graph: 'main'
    })
    act(() => getStore().setMode('main', 'space'))
    noteCanvas('main:space', { size: { width: 200, height: 100 }, camera: { yaw: Math.PI / 4, pitch: Math.PI / 6, range: 10 } })
    const space = graphDetails(getStore(), undefined).items
    expect(space.view.text).toBe('3D')
    expect(space.expressions.text).toBe('2')
    expect(space.units.text).toBe('')
    expect(space.range.text).toBe(`x, y, z ${formatNumber(-10)} … ${formatNumber(10)}`)
    expect(space.camera.text).toBe('yaw 45°, pitch 30°')
  })
})
