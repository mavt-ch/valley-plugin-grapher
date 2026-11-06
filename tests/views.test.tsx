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

function mount(files: Record<string, string> = {}) {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
  disposers.push(plugin.register(mock.api))
  return mock
}

describe('the sidebar', () => {
  it('switches coordinate systems from its header', async () => {
    mount()
    render(<Sidebar />)
    const radios = await screen.findAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Cartesian', 'Trigonometric', 'Polar', 'Parametric', '3D'])
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(screen.getByDisplayValue('y = x^2 - 2')).toBeTruthy()
    fireEvent.click(radios[2])
    expect(await screen.findByDisplayValue('r = 1 + cos(θ)')).toBeTruthy()
    expect(screen.getAllByRole('radio')[2].getAttribute('aria-checked')).toBe('true')
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
    mount()
    render(<><Sidebar /><GraphTab /></>)
    fireEvent.click((await screen.findAllByRole('radio'))[4])
    expect(await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')).toBeTruthy()
    expect(await screen.findByLabelText(/^3D graph/)).toBeTruthy()
    expect(screen.getByDisplayValue('6π')).toBeTruthy()
  })

  it('names the active coordinate system and offers zoom controls', async () => {
    mount()
    render(<GraphTab />)
    expect(await screen.findByText('Cartesian')).toBeTruthy()
    for (const name of ['Zoom in', 'Zoom out', 'Reset view']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })
})
