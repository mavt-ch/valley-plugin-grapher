import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { GraphTab } from '../src/GraphView'
import { Reference } from '../src/Reference'
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

/** Opens the view list from the header's view button and picks a view by name. */
async function pick(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /^View:/ }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Coordinate system' })).getByRole('radio', { name: new RegExp(`^${name}`) }))
}

function mount(files: Record<string, string> = {}) {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
  disposers.push(plugin.register(mock.api))
  return mock
}

describe('the sidebar', () => {
  it('picks the view from a list in place of the expressions and switches the axis labels', async () => {
    const mock = mount()
    render(<Sidebar />)
    expect(await screen.findByRole('button', { name: 'View: Cartesian' })).toBeTruthy()
    expect(screen.getByDisplayValue('y = x^2 - 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View: Cartesian' }))
    const options = within(screen.getByRole('radiogroup', { name: 'Coordinate system' })).getAllByRole('radio')
    expect(options.map((option) => option.querySelector('.grapher-view-option-name')?.textContent)).toEqual(['Cartesian', 'Polar', 'Parametric', '3D', 'Cylindrical', 'Spherical', 'Complex', 'Complex 3D'])
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByDisplayValue('y = x^2 - 2')).toBeNull()
    fireEvent.keyDown(options[0], { key: 'Escape' })
    expect(await screen.findByDisplayValue('y = x^2 - 2')).toBeTruthy()
    const real = screen.getByRole('radio', { name: 'Axes in real numbers' })
    const pi = screen.getByRole('radio', { name: /^Axes in multiples of π/ })
    expect(real.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pi)
    expect(pi.getAttribute('aria-checked')).toBe('true')
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"cartesian": "pi"'), { timeout: 2000 })
    await pick('Polar')
    expect(await screen.findByDisplayValue('r = 1 + cos(θ)')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^Axes in multiples of π/ }).getAttribute('aria-checked')).toBe('true')
    await pick('3D')
    expect(await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')).toBeTruthy()
    const spaceReal = screen.getByRole('radio', { name: 'Axes in real numbers' })
    expect(spaceReal.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /^Axes in multiples of π/ }))
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"space": "pi"'), { timeout: 2000 })
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

  it('turns the empty row into a table of points by typing table, by its button or by pasting a spreadsheet block', async () => {
    const mock = mount()
    render(<><Sidebar /><GraphTab /></>)
    await screen.findByDisplayValue('y = x^2 - 2')
    let inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const typed = inputs[inputs.length - 1]
    fireEvent.change(typed, { target: { value: 'table' } })
    fireEvent.keyDown(typed, { key: 'Enter' })
    const grid = await screen.findByRole('group', { name: 'Table 5' })
    expect(within(grid).getAllByRole('textbox')).toHaveLength(2 + 4 * 2)
    fireEvent.change(within(grid).getByRole('textbox', { name: 'x in row 1' }), { target: { value: '1' } })
    fireEvent.change(within(grid).getByRole('textbox', { name: 'y in row 1' }), { target: { value: '2,5' } })
    fireEvent.change(within(grid).getByRole('textbox', { name: 'y in row 2' }), { target: { value: 'k' } })
    const row = screen.getAllByRole('listitem')[4]
    await waitFor(() => expect(row.getAttribute('data-kind')).toBe('table'))
    await waitFor(() => expect(row.querySelector('.grapher-value')?.textContent).toBe('Points: 1'))
    expect(within(row).getByRole('button', { name: 'Add slider k' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Hide graph' })).toBeTruthy()
    fireEvent.click(within(row).getByRole('switch', { name: 'Connect points' }))
    await waitFor(async () => {
      const saved = JSON.parse((await mock.api.data.files.readText('graphs.json')) ?? '{}')
      expect(saved.sheets.cartesian[4]).toMatchObject({ text: '', connect: true, table: { head: ['x', 'y'], cells: [['1', '2,5'], ['', 'k']] } })
    }, { timeout: 2000 })
    // The quiet button in the new empty row adds another table; a spreadsheet block pasted into the empty row makes one too.
    fireEvent.click(screen.getByRole('button', { name: 'Add table of points' }))
    expect(await screen.findByRole('group', { name: 'Table 6' })).toBeTruthy()
    inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const block = ['t;s', ...Array.from({ length: 1003 }, (_, index) => `${index};${index},5`)].join('\n')
    fireEvent.paste(inputs[inputs.length - 1], { clipboardData: { getData: () => block } })
    const pasted = await screen.findByRole('group', { name: 'Table 7' })
    expect((within(pasted).getByRole('textbox', { name: 'Name of column y' }) as HTMLInputElement).value).toBe('s')
    expect((within(pasted).getByRole('textbox', { name: 's in row 2' }) as HTMLInputElement).value).toBe('1.5')
    expect(screen.getAllByRole('listitem')[6].querySelector('.grapher-notice')?.textContent).toBe('Kept 1000 of 1003 rows: a table holds at most 1000 rows.')
    await waitFor(() => expect(screen.getAllByRole('listitem')[6].querySelector('.grapher-value')?.textContent).toBe('Points: 1000'))
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
    await pick('3D')
    expect(await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')).toBeTruthy()
    expect(await screen.findByLabelText(/^3D graph/)).toBeTruthy()
    expect(screen.getByDisplayValue('6π')).toBeTruthy()
  })

  it('draws a parametric surface typed in u and v with a range row for each', async () => {
    const mock = mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await pick('3D')
    await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const trailing = inputs[inputs.length - 1]
    fireEvent.change(trailing, { target: { value: '((2 + cos v) cos u, (2 + cos v) sin u, sin v)' } })
    const torus = (await screen.findAllByRole('listitem'))[2]
    await waitFor(() => expect(torus.getAttribute('data-kind')).toBe('psurface'))
    expect(within(torus).getByRole('textbox', { name: 'Start of u' }).getAttribute('placeholder')).toBe('0')
    expect(within(torus).getByRole('textbox', { name: 'End of v' }).getAttribute('placeholder')).toBe('2π')
    fireEvent.change(within(torus).getByRole('textbox', { name: 'End of u' }), { target: { value: 'π' } })
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"to": "π"'), { timeout: 2000 })
  })

  it('draws an equation in x, y and z as an implicit surface with a colour swatch and no range rows', async () => {
    mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await pick('3D')
    await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'x^2 + y^2 + z^2 = 16' } })
    const sphere = (await screen.findAllByRole('listitem'))[2]
    await waitFor(() => expect(sphere.getAttribute('data-kind')).toBe('implicit3'))
    expect(within(sphere).getByRole('button', { name: 'Hide graph' })).toBeTruthy()
    expect(within(sphere).queryByRole('textbox', { name: /^Start of/ })).toBeNull()
  })

  it('draws a vector field typed as F(x, y) = (…) and saves whether it is shaded by magnitude', async () => {
    const mock = mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await screen.findByDisplayValue('y = x^2 - 2')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const trailing = inputs[inputs.length - 1]
    fireEvent.change(trailing, { target: { value: 'F(x, y) = (-y, x)' } })
    const field = (await screen.findAllByRole('listitem'))[4]
    await waitFor(() => expect(field.getAttribute('data-kind')).toBe('field'))
    expect(field.querySelector('.gm-vec')?.textContent).toBe('F')
    const shading = within(field).getByRole('switch', { name: 'Shade by magnitude' })
    expect(shading.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(shading)
    expect(within(field).getByRole('switch', { name: 'Shade by magnitude' }).getAttribute('aria-checked')).toBe('false')
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"magnitude": false'), { timeout: 2000 })
    // The arrows flow once switched on, and a field switched back keeps no trace of it.
    const flow = within(field).getByRole('switch', { name: 'Animate flow' })
    expect(flow.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(flow)
    expect(within(field).getByRole('switch', { name: 'Animate flow' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"flow": true'), { timeout: 2000 })
    fireEvent.click(within(field).getByRole('switch', { name: 'Animate flow' }))
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).not.toContain('"flow"'), { timeout: 2000 })
  })

  it('shows a double integral on the 3D sheet with its value and typesets both integral signs', async () => {
    mount({ [FILE]: JSON.stringify({ version: 1, mode: 'space', sheets: { space: [{ id: 'a', text: 'int(4 - x^2 - y^2, -1, 1, -1, 1)' }, { id: 'b', text: 'int(1, 0, 2, 0, 3, 0, 4)' }] } }) })
    render(<Sidebar />)
    const rows = await screen.findAllByRole('listitem')
    await waitFor(() => expect(rows[0].getAttribute('data-kind')).toBe('volume'))
    expect(rows[0].querySelector('.grapher-value')?.textContent).toBe('= 13.33333333')
    expect(rows[0].querySelectorAll('.gm-int-sign')).toHaveLength(2)
    expect([...rows[0].querySelectorAll('.gm-dx')].map((node) => node.textContent)).toEqual(['dy', 'dx'])
    expect(rows[1].querySelector('.grapher-value')?.textContent).toBe('= 24')
    expect(rows[1].querySelectorAll('.gm-int-sign')).toHaveLength(3)
  })

  it('draws the level curves of f(x, y) with a level count, a step and labels, and floor curves under a 3D surface', async () => {
    const mock = mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await screen.findByDisplayValue('y = x^2 - 2')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'f(x, y) = x^2 - y^2' } })
    const contour = (await screen.findAllByRole('listitem'))[4]
    await waitFor(() => expect(contour.getAttribute('data-kind')).toBe('contour'))
    const count = within(contour).getByRole('spinbutton', { name: 'Number of levels' })
    expect((count as HTMLInputElement).value).toBe('10')
    fireEvent.change(count, { target: { value: '6' } })
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"levels": 6'), { timeout: 2000 })
    fireEvent.change(within(contour).getByRole('textbox', { name: 'Step between levels' }), { target: { value: '5' } })
    expect((within(contour).getByRole('spinbutton', { name: 'Number of levels' }) as HTMLInputElement).disabled).toBe(true)
    const labels = within(contour).getByRole('switch', { name: 'Label values' })
    expect(labels.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(labels)
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toMatch(/"step": "5",\s*"labels": false/), { timeout: 2000 })
    await pick('3D')
    const paraboloid = (await screen.findAllByRole('listitem'))[0]
    await waitFor(() => expect(paraboloid.getAttribute('data-kind')).toBe('surface'))
    expect(within(paraboloid).getByRole('switch', { name: 'Level curves on the floor' }).getAttribute('aria-checked')).toBe('true')
    expect(within(paraboloid).getByRole('spinbutton', { name: 'Number of levels' })).toBeTruthy()
    fireEvent.click(within(paraboloid).getByRole('switch', { name: 'Level curves on the floor' }))
    await waitFor(() => expect(within(paraboloid).queryByRole('spinbutton', { name: 'Number of levels' })).toBeNull())
  })

  it('suggests an integral, shades it with its value and draws a tangent with a slider and its equation', async () => {
    mount()
    render(<><Sidebar /><GraphTab /></>)
    await screen.findByDisplayValue('y = x^2 - 2')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const trailing = inputs[inputs.length - 1]
    expect(trailing.getAttribute('placeholder')).toBe('int(sin(x), 0, π)')
    fireEvent.change(trailing, { target: { value: 'int(sin(x), 0, π)' } })
    const integral = (await screen.findAllByRole('listitem'))[4]
    await waitFor(() => expect(integral.getAttribute('data-kind')).toBe('integral'))
    expect(integral.querySelector('.grapher-value')?.textContent).toBe('= 2')
    expect(integral.querySelector('.gm-int-sign')?.textContent).toBe('∫')
    expect(integral.querySelector('.gm-int-to')?.textContent).toBe('π')
    expect(integral.querySelector('.gm-dx')?.textContent).toBe('dx')
    expect(within(integral).getByRole('button', { name: 'Hide graph' })).toBeTruthy()
    const more = screen.getAllByRole('textbox', { name: /Expression/ })
    fireEvent.change(more[more.length - 1], { target: { value: 'f(x) = x^2' } })
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /Expression/ })).toHaveLength(7))
    const last = screen.getAllByRole('textbox', { name: /Expression/ })
    fireEvent.change(last[last.length - 1], { target: { value: "tangent(f, c)" } })
    const tangent = (await screen.findAllByRole('listitem'))[6]
    await waitFor(() => expect(tangent.getAttribute('data-kind')).toBe('error'))
    fireEvent.click(within(tangent).getByRole('button', { name: 'Add slider c' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')[6].getAttribute('data-kind')).toBe('tangent'))
    expect(screen.getAllByRole('listitem')[6].querySelector('.grapher-value')?.textContent).toBe('y = 2x − 1')
    fireEvent.change(screen.getByRole('slider', { name: 'Value of c' }), { target: { value: '-1.5' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')[6].querySelector('.grapher-value')?.textContent).toBe('y = −3x − 2.25'))
    expect(screen.getAllByRole('listitem')[6].querySelector('.gm-fn')?.textContent).toBe('tangent')
  })

  it('suggests the tangent plane of the fresh paraboloid with its equation, normal and a switch for the normal', async () => {
    const mock = mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await pick('3D')
    await screen.findByDisplayValue('z = (x^2 + y^2) / 5 - 6')
    const inputs = screen.getAllByRole('textbox', { name: /Expression/ })
    const trailing = inputs[inputs.length - 1]
    expect(trailing.getAttribute('placeholder')).toBe('tangent((x^2 + y^2) / 5 - 6, 3, 2)')
    fireEvent.change(trailing, { target: { value: 'tangent((x^2 + y^2) / 5 - 6, a, b)' } })
    const plane = (await screen.findAllByRole('listitem'))[2]
    await waitFor(() => expect(plane.getAttribute('data-kind')).toBe('error'))
    fireEvent.click(within(plane).getByRole('button', { name: 'Add slider a' }))
    fireEvent.click(within(screen.getAllByRole('listitem')[2]).getByRole('button', { name: 'Add slider b' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')[2].getAttribute('data-kind')).toBe('tplane'))
    const values = () => [...screen.getAllByRole('listitem')[2].querySelectorAll('.grapher-value')].map((value) => value.textContent)
    // At (1, 1): z = 0.4 − 6 + 0.4 (x − 1) + 0.4 (y − 1), normal (−0.4, −0.4, 1).
    expect(values()).toEqual(['z = 0.4x + 0.4y − 6.4', 'n = (−0.4, −0.4, 1)'])
    fireEvent.change(screen.getByRole('slider', { name: 'Value of a' }), { target: { value: '3' } })
    await waitFor(() => expect(values()).toEqual(['z = 1.2x + 0.4y − 8', 'n = (−1.2, −0.4, 1)']))
    const normal = within(screen.getAllByRole('listitem')[2]).getByRole('switch', { name: 'Normal vector' })
    expect(normal.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(normal)
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"normal": false'), { timeout: 2000 })
  })

  it('draws cylindrical surfaces with a range row for each of their two coordinates', async () => {
    const mock = mount()
    const { container } = render(<><Sidebar /><GraphTab /></>)
    await pick('Cylindrical')
    expect(await screen.findByDisplayValue('r = 1 + cos(φ)')).toBeTruthy()
    expect(await screen.findByLabelText(/^Cylindrical graph/)).toBeTruthy()
    const first = (await screen.findAllByRole('listitem'))[0]
    await waitFor(() => expect(first.getAttribute('data-kind')).toBe('coords'))
    expect(within(first).getByRole('textbox', { name: 'Start of φ' }).getAttribute('placeholder')).toBe('0')
    expect(within(first).getByRole('textbox', { name: 'End of φ' }).getAttribute('placeholder')).toBe('2π')
    expect((within(first).getByRole('textbox', { name: 'Start of z' }) as HTMLInputElement).value).toBe('-4')
    fireEvent.change(within(first).getByRole('textbox', { name: 'End of z' }), { target: { value: '2' } })
    await waitFor(async () => expect(await mock.api.data.files.readText('graphs.json')).toContain('"to2": "2"'), { timeout: 2000 })
    expect(within(first).getByRole('textbox', { name: 'End of z' }).closest('.grapher-domain')?.textContent).toContain('≤ z ≤')
  })

  it('draws spherical surfaces and states the convention in the reference', async () => {
    mount()
    const { container } = render(<><Sidebar /><GraphTab /><Reference /></>)
    await pick('Spherical')
    expect(await screen.findByDisplayValue('ρ = 2')).toBeTruthy()
    expect(await screen.findByLabelText(/^Spherical graph/)).toBeTruthy()
    const [sphere, cone] = await screen.findAllByRole('listitem')
    await waitFor(() => expect(cone.getAttribute('data-kind')).toBe('coords'))
    expect(within(sphere).getByRole('textbox', { name: 'End of φ' }).getAttribute('value')).toBe('π/4')
    expect(within(sphere).getByRole('textbox', { name: 'Start of θ' }).getAttribute('placeholder')).toBe('0')
    expect(within(cone).getByRole('textbox', { name: 'End of ρ' }).getAttribute('value')).toBe('2')
    expect(within(cone).getByRole('textbox', { name: 'End of θ' }).getAttribute('placeholder')).toBe('2π')
    expect(sphere.querySelector('.grapher-typeset')?.textContent).toBe('ρ=2')
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-group="spherical"] .grapher-ref-heading')!)
    const reference = container.querySelector('.grapher-reference')?.textContent ?? ''
    expect(reference).toContain('θ the azimuth from the x-axis')
    expect(reference).toContain('φ the polar angle from the z-axis')
  })

  it('draws w = f(z) over the complex plane in the complex 3D view', async () => {
    const mock = mount()
    render(<><Sidebar /><GraphTab /></>)
    await pick('Complex 3D')
    expect(await screen.findByDisplayValue('w = (z^2 - 4) / 4')).toBeTruthy()
    expect(await screen.findByLabelText(/^Complex 3D graph/)).toBeTruthy()
  })

  it('keeps each tab on its own graph and edits the focused one in the sidebar', async () => {
    const mock = mount()
    render(<><Sidebar /><GraphTab /><GraphTab instanceId="second" /></>)
    await screen.findByDisplayValue('y = x^2 - 2')
    await waitFor(() => expect(screen.getAllByText('Cartesian').length).toBeGreaterThanOrEqual(2))
    act(() => { mock.emitState({ activePluginTab: { pluginId: mock.api.pluginId, instanceId: 'second' } }) })
    await pick('Polar')
    expect(await screen.findByDisplayValue('r = 1 + cos(θ)')).toBeTruthy()
    expect(await screen.findByLabelText(/^Polar graph/)).toBeTruthy()
    expect(screen.getByLabelText(/^Cartesian graph/)).toBeTruthy()
    // A tab without an instance id is re-keyed in place to a tab that shows the main profile (Graph 1).
    act(() => { mock.emitState({ activePluginTab: { pluginId: mock.api.pluginId } }) })
    expect(await screen.findByDisplayValue('y = x^2 - 2')).toBeTruthy()
    const open = mock.api.workspace.openMainTab as unknown as { mock: { calls: [{ instanceId?: string; newTab?: boolean; title?: string }][] } }
    const adopted = open.mock.calls[open.mock.calls.length - 1][0]
    expect(adopted.instanceId).toMatch(/^t-/)
    expect(adopted.newTab).toBeUndefined()
    expect(adopted.title).toBe('Graph 1')
    await waitFor(async () => {
      const saved = JSON.parse(await mock.api.data.files.readText('graphs.json') ?? '{}') as { mode: string; graphs: Record<string, { mode: string }>; tabs: Record<string, string> }
      expect(saved.mode).toBe('cartesian')
      expect(saved.graphs.second.mode).toBe('polar')
      expect(saved.tabs[adopted.instanceId!]).toBe('main')
    }, { timeout: 2000 })
  })

  it('opens a fresh graph from the tab strip and from the open button with the modifier', async () => {
    const mock = mount()
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    act(() => { void mock.newTabHandlers[0]({ paneId: 'pane-1' }) })
    const open = mock.api.workspace.openMainTab as unknown as { mock: { calls: [{ instanceId?: string; newTab?: boolean; paneId?: string }][] } }
    const first = open.mock.calls[0][0]
    expect(first).toMatchObject({ newTab: true, paneId: 'pane-1' })
    expect(first.instanceId).toMatch(/^g-/)
    fireEvent.click(screen.getByRole('button', { name: 'Open graph' }), { metaKey: true, ctrlKey: true })
    const second = open.mock.calls[1][0]
    expect(second.newTab).toBe(true)
    expect(second.instanceId).not.toBe(first.instanceId)
  })

  it('names the active coordinate system and offers zoom controls', async () => {
    mount()
    render(<GraphTab />)
    expect(await screen.findByText('Cartesian')).toBeTruthy()
    for (const name of ['Zoom in', 'Zoom out', 'Reset view']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })
})
