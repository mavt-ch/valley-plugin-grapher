import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { GraphTab } from '../src/GraphView'
import { defaultDocument, defaultGraph } from '../src/model'
import { getStore } from '../src/store'
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

function mount(files: Record<string, string> = {}, open: string[] = []) {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
  vi.spyOn(mock.api.workspace, 'getOpenMainTabs').mockReturnValue(open)
  const titles = vi.spyOn(mock.api.workspace, 'setMainTabTitle').mockImplementation(() => {})
  disposers.push(plugin.register(mock.api))
  return { mock, titles }
}

const picker = (): HTMLElement => screen.getByRole('button', { name: /^Profile: / })

describe('profiles', () => {
  it('turns every graph of an older file into a numbered profile and keeps tabs on their graphs', async () => {
    const old = { ...defaultDocument(), graphs: { 'g-a': defaultGraph('polar'), second: defaultGraph('space') } }
    mount({ [FILE]: JSON.stringify(old) })
    render(<><Sidebar /><GraphTab instanceId="second" /></>)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    expect(getStore().getSnapshot().document.names).toEqual({ main: 'Graph 1', 'g-a': 'Graph 2', second: 'Graph 3' })
    expect(getStore().profileOf('second')).toBe('second')
    expect(await screen.findByLabelText(/^3D graph/)).toBeTruthy()
  })

  it('adds, renames, switches and deletes profiles, titling the tabs with their names', async () => {
    const { titles } = mount({}, ['main'])
    render(<><Sidebar /><GraphTab /></>)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    expect(picker().getAttribute('aria-label')).toBe('Profile: Graph 2')
    expect(screen.getByDisplayValue('y = x^2 - 2')).toBeTruthy()
    await waitFor(() => expect(titles).toHaveBeenLastCalledWith('Graph 2', 'main'))

    fireEvent.click(picker())
    const list = screen.getByRole('radiogroup', { name: 'Profiles' })
    expect(within(list).getAllByRole('radio').map((radio) => radio.querySelector('.grapher-view-option-name')?.textContent)).toEqual(['Graph 1', 'Graph 2'])
    expect(within(list).getByRole('radio', { name: /Graph 2/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(list).getByRole('button', { name: 'Rename Graph 2' }))
    const field = screen.getByRole('textbox', { name: 'Name of Graph 2' }) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Physics' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(within(list).getByRole('radio', { name: /Physics/ })).toBeTruthy()
    await waitFor(() => expect(titles).toHaveBeenLastCalledWith('Physics', 'main'))

    fireEvent.click(within(list).getByRole('radio', { name: /Graph 1/ }))
    expect(picker().getAttribute('aria-label')).toBe('Profile: Graph 1')
    expect(getStore().getSnapshot().active).toBe('main')

    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Graph 1' }))
    expect(picker().getAttribute('aria-label')).toBe('Profile: Physics')
    const remaining = screen.getByRole('button', { name: 'Delete Physics' })
    expect(remaining.hasAttribute('disabled')).toBe(true)
    expect(remaining.getAttribute('title')).toBe('The last profile cannot be deleted')
    expect(Object.keys(getStore().getSnapshot().document.graphs)).toEqual([])
    expect(getStore().getSnapshot().document.names).toEqual({ main: 'Physics' })
  })

  it('deletes a profile other tabs show and moves them to its neighbour', async () => {
    mount()
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    const store = getStore()
    let polar = ''
    act(() => { polar = store.createProfile('other', 'polar')! })
    expect(store.profileOf('other')).toBe(polar)
    act(() => store.duplicateProfile('third', polar))
    expect(store.profileName(store.profileOf('third'))).toBe('Graph 2 copy')
    act(() => store.deleteProfile(polar))
    expect(store.profileOf('other')).toBe(store.profileOf('third'))
    expect(store.getSnapshot().active).toBe('main')
  })

  it('gives the tab the profile name and its view icon in the surface snapshot', async () => {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
    vi.spyOn(mock.api.workspace, 'getOpenMainTabs').mockReturnValue([])
    const provide = vi.spyOn(mock.api.interop.extensions, 'provide')
    disposers.push(plugin.register(mock.api))
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    const surface = provide.mock.calls.map(([, value]) => value as { id?: string; getSnapshot?: (id?: string) => { title: string; visual?: { src?: string } } }).find((value) => value.id === 'grapher.main_workspace')!
    act(() => getStore().renameProfile('main', 'Waves'))
    expect(surface.getSnapshot!('main').title).toBe('Waves')
    act(() => { getStore().createProfile('main', 'space') })
    expect(surface.getSnapshot!('main').title).toBe('Graph 1')
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toContain('M12 3l8 4.5v9L12 21l-8-4.5v-9z')
  })
})

describe('profile icons', () => {
  it('seeds the bundled icons without overwriting and lists what the folder holds', async () => {
    const { profileIcons } = await import('../src/backend/icons')
    const files = new Map<string, string>([['wave.svg', '<svg>mine</svg>'], ['star.svg', '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>'], ['notes.txt', 'x']])
    const storage = {
      open: vi.fn(async () => ({ handle: 'h' })), close: vi.fn(async () => {}), mkdir: vi.fn(async () => {}),
      stat: vi.fn(async ({ path }: { path: string }) => (files.has(path) ? {} : null)),
      list: vi.fn(async () => [...files].map(([name, text]) => ({ name, kind: 'file', size: text.length }))),
      read: vi.fn(async ({ path }: { path: string }) => files.get(path)!),
      write: vi.fn(async ({ path }: { path: string }, text: string) => { files.set(path, text) })
    }
    const { icons } = await profileIcons(storage, { wave: '<svg>bundled</svg>', cartesian: '<svg>axes</svg>' })
    expect(storage.open).toHaveBeenCalledWith({ area: 'metadata', path: 'assets/icons/grapher-icon', kind: 'directory', mode: 'write' })
    expect(files.get('wave.svg')).toBe('<svg>mine</svg>')
    expect(files.get('cartesian.svg')).toBe('<svg>axes</svg>')
    expect(Object.keys(icons).sort()).toEqual(['cartesian', 'star', 'wave'])
    expect(storage.close).toHaveBeenCalledWith('h')
  })

  it('picks an icon from the folder, shows it on the tab and falls back to the view icon', async () => {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
    vi.spyOn(mock.api.workspace, 'getOpenMainTabs').mockReturnValue([])
    const call = vi.spyOn(mock.api.backend, 'call').mockResolvedValue({ icons: { star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>', wave: '<svg viewBox="0 0 24 24"><path d="M2 12h20"/></svg>' } } as never)
    const popover = vi.spyOn(mock.api.ui, 'openPopover').mockResolvedValue(undefined)
    const provide = vi.spyOn(mock.api.interop.extensions, 'provide')
    disposers.push(plugin.register(mock.api))
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('button', { name: 'Icon of Graph 1' }))
    await waitFor(() => expect(call).toHaveBeenCalledWith('icons', expect.objectContaining({ defaults: expect.objectContaining({ cartesian: expect.stringContaining('<svg'), sigma: expect.stringContaining('<svg') }) })))
    const close = vi.fn()
    const content = render(<>{(popover.mock.calls[0][0] as (context: { close: () => void }) => React.ReactNode)({ close })}</>)
    await waitFor(() => expect(within(content.container).getByRole('button', { name: 'star' })).toBeTruthy())
    fireEvent.click(within(content.container).getByRole('button', { name: 'star' }))
    expect(close).toHaveBeenCalled()
    expect(getStore().getSnapshot().document.icons).toEqual({ main: 'star' })
    const surface = provide.mock.calls.map(([, value]) => value as { id?: string; getSnapshot?: (id?: string) => { visual?: { src?: string } } }).find((value) => value.id === 'grapher.main_workspace')!
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toContain('M12 2l3 7h7')
    act(() => getStore().setProfileIcon('main', 'gone'))
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toContain('M7.5 5c1.5 6 3.3 9 5.2 9s3.7-3 5.3-9')
  })

  it('keeps every view sheet, the axis labels and the cameras of a profile across a restart', async () => {
    const { mock } = mount()
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    const store = getStore()
    act(() => {
      store.updateRows('main', 'cartesian', (rows) => [{ ...rows[0], text: 'y = 3x' }])
      store.setMode('main', 'polar')
      store.updateRows('main', 'polar', (rows) => [{ ...rows[0], text: 'r = 3' }])
      store.setUnits('main', 'polar', 'decimal')
    })
    store.viewports['main:polar'] = { cx: 1, cy: 2, scale: 30 }
    store.cameras['main:space'] = { yaw: 0.5, pitch: 0.25, range: 8 }
    store.noteCamera()
    await store.flush()
    const saved = await mock.api.data.files.readText('graphs.json')
    await Promise.all(disposers.splice(0).map((dispose) => dispose()))
    mount({ [FILE]: saved! })
    render(<Sidebar />)
    await screen.findByDisplayValue('r = 3')
    const next = getStore()
    expect(next.graph('main').sheets.cartesian[0].text).toBe('y = 3x')
    expect(next.graph('main').units.polar).toBe('decimal')
    expect(next.viewports['main:polar']).toEqual({ cx: 1, cy: 2, scale: 30 })
    expect(next.cameras['main:space']).toEqual({ yaw: 0.5, pitch: 0.25, range: 8 })
  })
})
