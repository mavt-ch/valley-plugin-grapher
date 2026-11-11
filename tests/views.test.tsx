import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { GraphTab } from '../src/GraphView'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
const FILE = `${pluginDataDirectoryPath('grapher')}/graphs.json`
let module: PackageWasmModule
let disposers: (() => Promise<void>)[] = []

beforeAll(async () => { module = await loadPackageWasm(process.cwd(), 'plot') })
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  document.head.querySelectorAll('style[id]').forEach((style) => style.remove())
})

type Mock = ReturnType<typeof createMockValleyApi>

/** Opens the header's view picker and picks a view by name, as the host's menu would. */
async function pick(mock: Mock, name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^View:/ }))
  const items = mock.menus[mock.menus.length - 1] as { label?: string; onSelect?: () => void }[]
  act(() => { items.find((item) => item.label === name)?.onSelect?.() })
}

function mount(files: Record<string, string> = {}) {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
  disposers.push(plugin.register(mock.api))
  return mock
}

describe('the sidebar', () => {
  it('picks the view from a dropdown and switches the axis labels beside it', async () => {
    const mock = mount()
    render(<Sidebar />)
    expect(await screen.findByRole('button', { name: 'View: Cartesian' })).toBeTruthy()
    expect(screen.getByDisplayValue('y = x^2 - 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View: Cartesian' }))
    const items = mock.menus[0] as { label?: string; checked?: boolean }[]
    expect(items.map((item) => item.label)).toEqual(['Cartesian', 'Polar', 'Parametric', '3D', 'Complex', 'Complex 3D'])
    expect(items[0].checked).toBe(true)
    const real = screen.getByRole('radio', { name: 'Axes in real numbers' })
    const pi = screen.getByRole('radio', { name: /^Axes in multiples of π/ })
    expect(real.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pi)
    expect(pi.getAttribute('aria-checked')).toBe('true')
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"cartesian": "pi"'), { timeout: 2000 })
    await pick(mock, 'Polar')
    expect(await screen.findByDisplayValue('r = 1 + cos(θ)')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Axes in multiples of π/ }).getAttribute('aria-checked')).toBe('true')
    await pick(mock, '3D')
    expect(await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Axis labels' })).toBeNull()
  })

  it('offers sliders for undefined names and saves the sheet', async () => {
    const mock = mount()
    render(<Sidebar />)
    const inputs = await screen.findAllByRole('textbox', { name: /Expression/ })
    const trailing = inputs[inputs.length - 1]
    fireEvent.change(trailing, { target: { value: 'y = m x' } })
    const add = await screen.findByRole('button', { name: 'Add slider m' })
    fireEvent.click(add)
    expect(await screen.findByDisplayValue('m = 1')).toBeTruthy()
    expect(await screen.findByRole('slider', { name: 'Value of m' })).toBeTruthy()
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"m = 1"'), { timeout: 2000 })
  })

  it('typesets rows that are not being edited', async () => {
    mount()
    const { container } = render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    const first = container.querySelector('.grapher-typeset')
    expect(first?.textContent).toBe('y=x2−2')
    expect(first?.querySelector('.gm-sup')?.textContent).toBe('2')
    const input = screen.getAllByRole('textbox', { name: /Expression/ })[0]
    fireEvent.focus(input)
    expect(input.closest('.grapher-field')?.querySelector('.grapher-typeset')).toBeNull()
  })

  it('moves a row by dragging its handle', async () => {
    mount()
    const { container } = render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    const list = container.querySelector<HTMLElement>('.grapher-list')!
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-row-index]'))
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 40, bottom: index * 40 + 40, height: 40, left: 0, right: 200, width: 200, x: 0, y: index * 40, toJSON: () => ({}) })
    })
    list.getBoundingClientRect = () => ({ top: -100, bottom: 1000, height: 1100, left: 0, right: 200, width: 200, x: 0, y: -100, toJSON: () => ({}) })
    const grips = screen.getAllByRole('button', { name: 'Drag to move' })
    expect(grips).toHaveLength(4)
    fireEvent.pointerDown(grips[0], { button: 0, pointerId: 1, clientY: 20 })
    fireEvent.pointerMove(list, { pointerId: 1, clientY: 150 })
    expect(container.querySelector('.grapher-drop-marker')).toBeTruthy()
    fireEvent.pointerUp(list, { pointerId: 1, clientY: 150 })
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /Expression/ }).map((input) => (input as HTMLInputElement).value)).toEqual(['y = a x + b', 'a = 1', 'b = 0', 'y = x^2 - 2', '']))
  })

  it('leaves a file it cannot read untouched', async () => {
    const mock = mount({ [FILE]: '{"version": 9}' })
    render(<Sidebar />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    const inputs = await screen.findAllByRole('textbox', { name: /Expression/ })
    fireEvent.change(inputs[0], { target: { value: 'y = 3' } })
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)))
    expect(await mock.api.data.files.readText('graphs.json')).toBe('{"version": 9}')
  })
})

describe('the graph tab', () => {
  it('switches to the 3D sheet and its orbit canvas', async () => {
    const mock = mount()
    render(<><Sidebar /><GraphTab /></>)
    await pick(mock, '3D')
    expect(await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')).toBeTruthy()
    expect(await screen.findByLabelText(/^3D graph/)).toBeTruthy()
    expect(screen.getByDisplayValue('6π')).toBeTruthy()
  })

  it('draws w = f(z) over the complex plane in the complex 3D view', async () => {
    const mock = mount()
    render(<><Sidebar /><GraphTab /></>)
    await pick(mock, 'Complex 3D')
    expect(await screen.findByDisplayValue('w = (z^2 - 4) / 4')).toBeTruthy()
    expect(await screen.findByLabelText(/^Complex 3D graph/)).toBeTruthy()
  })

  it('names the active coordinate system and offers zoom controls', async () => {
    mount()
    render(<GraphTab />)
    expect(await screen.findByText('Cartesian')).toBeTruthy()
    for (const name of ['Zoom in', 'Zoom out', 'Reset view']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })
})
