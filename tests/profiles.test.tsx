import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { GraphTab } from '../src/GraphView'
import { defaultDocument, defaultGraph } from '../src/model'
import { getStore } from '../src/store'
import { PROFILE_ICONS } from '../src/profileIconSet'
import { refreshProfileIcons } from '../src/profileIcons'
import type { UiMenuItem } from '@valley/plugin-sdk'
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

  it('adds, renames, switches and deletes profiles through the row menu, titling the tabs with their names', async () => {
    const { mock, titles } = mount({}, ['main'])
    const openMenu = vi.spyOn(mock.api.ui, 'openMenu').mockResolvedValue(null)
    const select = (id: string): Promise<unknown> => act(async () => { await (openMenu.mock.calls.at(-1)![0] as UiMenuItem[]).find((item) => item.id === id)!.onSelect!() })
    render(<><Sidebar /><GraphTab /></>)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }))
    expect(picker().getAttribute('aria-label')).toBe('Profile: Graph 2')
    await waitFor(() => expect(titles).toHaveBeenLastCalledWith('Graph 2', 'main'))

    fireEvent.click(picker())
    const list = screen.getByRole('radiogroup', { name: 'Profiles' })
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.grapher-profile-row'))
    expect(rows.map((row) => row.querySelector('.grapher-profile-item-name')?.textContent)).toEqual(['Graph 1', 'Graph 2'])
    // One compact row each: grip, the whole-row radio (icon, name, view, tick) and a single three-dots button.
    expect(rows.map((row) => Array.from(row.querySelectorAll('button')).map((button) => button.className))).toEqual([['grapher-profile-grip', 'grapher-profile-item', 'grapher-profile-more'], ['grapher-profile-grip', 'grapher-profile-item', 'grapher-profile-more']])
    expect(rows[1].className).toContain('active')
    expect(rows[1].querySelector('.grapher-profile-item-view')?.textContent).toBe('Cartesian')
    const css = document.getElementById('grapher-styles')?.textContent ?? ''
    // Rows never wrap: 32px high, the name ellipsizes and the view name shrinks away first.
    expect(css).toContain('.grapher-profile-row { display:flex; align-items:center; height:32px;')
    expect(css).toContain('.grapher-profile-item-name { flex:0 1 auto; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;')
    expect(css).toContain('.grapher-profile-item-view { flex:0 1000 auto; min-width:0; overflow:hidden; white-space:nowrap;')

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'More for Graph 2' }))
    const items = openMenu.mock.calls.at(-1)![0] as UiMenuItem[]
    expect(items.filter((item) => item.type !== 'separator').map((item) => [item.id, Boolean(item.icon), item.enabled !== false])).toEqual([['rename', true, true], ['icon', true, true], ['duplicate', true, true], ['delete', true, true]])
    await select('rename')
    const field = screen.getByRole('textbox', { name: 'Name of Graph 2' }) as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Physics' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(within(list).getByRole('radio', { name: /Physics/ })).toBeTruthy()
    await waitFor(() => expect(titles).toHaveBeenLastCalledWith('Physics', 'main'))

    fireEvent.click(list.querySelector<HTMLElement>('[data-profile="main"] .grapher-profile-item-view')!)
    expect(picker().getAttribute('aria-label')).toBe('Profile: Graph 1')
    expect(getStore().getSnapshot().active).toBe('main')

    fireEvent.click(picker())
    fireEvent.contextMenu(screen.getByRole('radiogroup', { name: 'Profiles' }).querySelector('[data-profile="main"]')!, { clientX: 5, clientY: 5 })
    expect(openMenu.mock.calls.at(-1)![1]).toEqual({ x: 5, y: 5 })
    await select('delete')
    expect(picker().getAttribute('aria-label')).toBe('Profile: Physics')
    fireEvent.click(screen.getByRole('button', { name: 'More for Physics' }))
    const lastDelete = (openMenu.mock.calls.at(-1)![0] as UiMenuItem[]).find((item) => item.id === 'delete')!
    expect(lastDelete.enabled).toBe(false)
    expect(lastDelete.description).toBe('The last profile cannot be deleted')
    expect(Object.keys(getStore().getSnapshot().document.graphs)).toEqual([])
    expect(getStore().getSnapshot().document.names).toEqual({ main: 'Physics' })
  })

  it('reorders profiles by dragging the grip, keeps the order after a restart and loads older files in their order', async () => {
    const old = { ...defaultDocument(), graphs: { 'g-a': defaultGraph('polar'), 'g-b': defaultGraph('space') } }
    const { mock } = mount({ [FILE]: JSON.stringify(old) })
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    fireEvent.click(picker())
    const list = screen.getByRole('radiogroup', { name: 'Profiles' })
    const names = (): string[] => Array.from(list.querySelectorAll('.grapher-profile-item-name')).map((name) => name.textContent ?? '')
    expect(names()).toEqual(['Graph 1', 'Graph 2', 'Graph 3'])
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-profile]'))
    rows.forEach((row, index) => { row.getBoundingClientRect = () => ({ top: index * 32, height: 32, bottom: index * 32 + 32, left: 0, right: 200, width: 200, x: 0, y: index * 32, toJSON: () => ({}) }) })
    const grip = rows[2].querySelector<HTMLElement>('.grapher-profile-grip')!
    grip.setPointerCapture = () => {}
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 80 })
    fireEvent.pointerMove(list, { pointerId: 1, clientY: 5 })
    expect(list.querySelectorAll('.grapher-drop-marker')).toHaveLength(1)
    fireEvent.pointerUp(list, { pointerId: 1, clientY: 5 })
    expect(names()).toEqual(['Graph 3', 'Graph 1', 'Graph 2'])
    await getStore().flush()
    const saved = await mock.api.data.files.readText('graphs.json')
    expect(JSON.parse(saved!).order).toEqual(['g-b', 'main', 'g-a'])
    cleanup()
    await Promise.all(disposers.splice(0).map((dispose) => dispose()))
    mount({ [FILE]: saved! })
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    fireEvent.click(picker())
    expect(Array.from(screen.getByRole('radiogroup', { name: 'Profiles' }).querySelectorAll('.grapher-profile-item-name')).map((name) => name.textContent)).toEqual(['Graph 3', 'Graph 1', 'Graph 2'])
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

  it('gives every profile an object icon of its own and shows it with the name on the tab', async () => {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
    vi.spyOn(mock.api.workspace, 'getOpenMainTabs').mockReturnValue([])
    const provide = vi.spyOn(mock.api.interop.extensions, 'provide')
    disposers.push(plugin.register(mock.api))
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Profile: Graph 1' })
    const surface = provide.mock.calls.map(([, value]) => value as { id?: string; getSnapshot?: (id?: string) => { title: string; visual?: { src?: string } } }).find((value) => value.id === 'grapher.main_workspace')!
    act(() => getStore().renameProfile('main', 'Waves'))
    expect(surface.getSnapshot!('main').title).toBe('Waves')
    expect(getStore().getSnapshot().document.icons).toEqual({ main: 'cup' })
    act(() => { getStore().createProfile('main', 'space') })
    expect(surface.getSnapshot!('main').title).toBe('Graph 1')
    expect(getStore().getSnapshot().document.icons?.[getStore().profileOf('main')]).toBe('cat')
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toBe(`data:image/svg+xml,${PROFILE_ICONS.cat}`)
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
    const openMenu = vi.spyOn(mock.api.ui, 'openMenu').mockResolvedValue(null)
    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('button', { name: 'More for Graph 1' }))
    await act(async () => { await (openMenu.mock.calls.at(-1)![0] as UiMenuItem[]).find((item) => item.id === 'icon')!.onSelect!() })
    await waitFor(() => expect(call).toHaveBeenCalledWith('icons', expect.objectContaining({ defaults: PROFILE_ICONS })))
    // The seed set is everyday objects and animals, none of the view icons.
    expect(Object.keys(PROFILE_ICONS)).toHaveLength(30)
    for (const view of ['cartesian', 'polar', 'parametric', 'space', 'cylindrical', 'spherical', 'complex', 'complexSpace', 'function', 'wave', 'grid', 'sigma', 'cube', 'sphere']) expect(PROFILE_ICONS).not.toHaveProperty(view)
    expect(Object.keys(PROFILE_ICONS).every((name) => /^[a-z]+(-[a-z]+)*$/.test(name))).toBe(true)
    const close = vi.fn()
    const content = render(<>{(popover.mock.calls[0][0] as (context: { close: () => void }) => React.ReactNode)({ close })}</>)
    await waitFor(() => expect(within(content.container).getByRole('button', { name: 'star' })).toBeTruthy())
    fireEvent.click(within(content.container).getByRole('button', { name: 'star' }))
    expect(close).toHaveBeenCalled()
    expect(getStore().getSnapshot().document.icons?.main).toBe('star')
    const surface = provide.mock.calls.map(([, value]) => value as { id?: string; getSnapshot?: (id?: string) => { visual?: { src?: string } } }).find((value) => value.id === 'grapher.main_workspace')!
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toContain('M12 2l3 7h7')
    act(() => getStore().setProfileIcon('main', 'gone'))
    expect(decodeURIComponent(surface.getSnapshot!('main').visual!.src!)).toContain('M7.5 5c1.5 6 3.3 9 5.2 9s3.7-3 5.3-9')
    // Once the folder is listed, a profile whose icon file is gone gets the first free object icon the folder holds.
    await act(async () => { await refreshProfileIcons() })
    expect(getStore().getSnapshot().document.icons).toEqual({ main: 'star' })
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
