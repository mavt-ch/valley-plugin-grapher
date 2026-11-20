import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import { pluginDataDirectoryPath } from '@valley/plugin-sdk/paths'
import type { UiMenuItem } from '@valley/plugin-sdk'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { getStore } from '../src/store'
import { EXAMPLE_ENTRIES } from '../src/bookmarkExamples'
import { defaultDocument } from '../src/model'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
const FILE = `${pluginDataDirectoryPath('grapher')}/graphs.json`
/** A saved file whose bookmarks were all deleted: no examples come back. */
const NO_BOOKMARKS_FILE = { [FILE]: JSON.stringify({ ...defaultDocument(), bookmarks: { groups: [], items: [] } }) }
let module: PackageWasmModule
let disposers: (() => Promise<void>)[] = []

beforeAll(async () => { module = await loadPackageWasm(process.cwd(), 'plot') })
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  document.head.querySelectorAll('style[id]').forEach((style) => style.remove())
})

function mount(files: Record<string, string> = NO_BOOKMARKS_FILE) {
  const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] }, files })
  disposers.push(plugin.register(mock.api))
  const openMenu = vi.spyOn(mock.api.ui, 'openMenu').mockResolvedValue(null)
  return { mock, openMenu }
}

/** The items of the menu opened last, and a way to pick one by its path of ids. */
function lastMenu(openMenu: ReturnType<typeof mount>['openMenu']) {
  const items = (): UiMenuItem[] => openMenu.mock.calls.at(-1)![0] as UiMenuItem[]
  const find = (...path: string[]): UiMenuItem => path.reduce<UiMenuItem | undefined>((menu, id) => (menu ? menu.submenu : items())?.find((item) => item.id === id), undefined)!
  return { items, find, select: (...path: string[]) => act(async () => { await find(...path).onSelect!() }) }
}

describe('bookmarks', () => {
  it('start with the examples in groups and subgroups once, every one of them drawing on its own view', async () => {
    const { mock } = mount({})
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    expect(screen.queryByRole('button', { name: /^Profile/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New profile' })).toBeNull()
    const bookmarks = getStore().bookmarks()
    const top = bookmarks.groups.filter((group) => !group.parent).map((group) => group.name)
    expect(top).toEqual(['Functions', 'Curves', '3D', 'Complex numbers'])
    expect(bookmarks.groups.filter((group) => group.parent).map((group) => group.name)).toEqual(['Calculus', 'Fields and level curves', 'Integrals', 'Cylindrical and spherical'])
    expect(bookmarks.items.map((item) => item.row.text).sort()).toEqual(EXAMPLE_ENTRIES.map((entry) => entry.text).sort())
    await waitFor(() => expect(getStore().getSnapshot().engine).toBeTruthy())
    const engine = getStore().getSnapshot().engine!
    for (const item of bookmarks.items) {
      const [analysis] = engine.analyze(item.mode, [item.row])
      expect(analysis.kind, `${item.mode}: ${item.row.text}`).not.toBe('error')
    }
    // The list shows them; subgroups start closed.
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    const list = screen.getByRole('group', { name: 'Bookmarks' })
    expect(within(list).getByText('Functions')).toBeTruthy()
    expect(within(list).getByText('Calculus').closest('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
    // A new realm writes no file until something changes; the examples are saved with the first edit.
    expect(await mock.api.data.files.readText('graphs.json')).toBeNull()
    act(() => getStore().setBookmarkGroupCollapsed(null, false))
    await waitFor(async () => expect(JSON.parse((await mock.api.data.files.readText('graphs.json')) ?? '{}').bookmarks?.items).toHaveLength(EXAMPLE_ENTRIES.length), { timeout: 2000 })
  })

  it('come to an older file once and not again after they were all deleted', async () => {
    const older = { ...defaultDocument(), names: { main: 'Graph 1' }, icons: { main: 'cat' }, order: ['main'] }
    const { mock } = mount({ [FILE]: JSON.stringify(older) })
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    expect(getStore().bookmarks().items).toHaveLength(EXAMPLE_ENTRIES.length)
    act(() => { for (const group of getStore().bookmarks().groups) getStore().deleteBookmarkGroup(group.id) })
    act(() => { for (const item of getStore().bookmarks().items) getStore().deleteBookmark(item.id) })
    await getStore().flush()
    const saved = JSON.parse((await mock.api.data.files.readText('graphs.json')) ?? '{}')
    expect(saved.bookmarks).toEqual({ groups: [], items: [] })
    expect(saved.names).toBeUndefined()
    expect(saved.icons).toBeUndefined()
    expect(saved.order).toBeUndefined()
  })

  it('replace the row’s × with a menu, keep a bookmarked expression after it is deleted and add it back from the list', async () => {
    const { mock, openMenu } = mount()
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    expect(screen.queryByRole('button', { name: 'Delete expression' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add folder' })).toBeNull()

    // The arrow at the end of the row opens its menu, Bookmark first, anchored to the button.
    fireEvent.click(screen.getByRole('button', { name: 'Menu for expression 1' }))
    const menu = lastMenu(openMenu)
    expect(menu.items().map((item) => item.id ?? item.type)).toEqual(['bookmark', 'separator', 'visibility', 'separator', 'color:red', 'color:blue', 'color:green', 'color:purple', 'color:orange', 'color:magenta', 'color:cyan', 'separator', 'delete'])
    expect(openMenu.mock.calls.at(-1)![1]).toHaveProperty('anchor')
    expect(menu.find('bookmark').submenu!.map((item) => item.id ?? item.type)).toEqual(['bookmark:', 'separator', 'bookmark:new-group'])
    await menu.select('bookmark', 'bookmark:')
    expect(getStore().bookmarks().items.map((item) => [item.mode, item.row.text, item.group ?? null])).toEqual([['cartesian', 'y = x^2 - 2', null]])

    // Bookmarked again from the menu, the entry is ticked; a second pick of the same place adds nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Menu for expression 1' }))
    expect(lastMenu(openMenu).find('bookmark', 'bookmark:').checked).toBe(true)
    expect(lastMenu(openMenu).find('bookmark').label).toBe('Bookmarked')
    act(() => getStore().addBookmark('cartesian', getStore().graph('main').sheets.cartesian[0]))
    expect(getStore().bookmarks().items).toHaveLength(1)

    // Deleting the expression leaves the bookmark.
    await lastMenu(openMenu).select('delete')
    expect(screen.queryByDisplayValue('y = x^2 - 2')).toBeNull()
    expect(getStore().bookmarks().items).toHaveLength(1)
    await waitFor(async () => expect(JSON.parse((await mock.api.data.files.readText('graphs.json')) ?? '{}').bookmarks.items[0].row.text).toBe('y = x^2 - 2'), { timeout: 2000 })

    // The header's bookmark opens the list in place of the expressions; a click on a bookmark adds it to the graph and
    // the list stays open, the bookmark marked as in the graph; a second click takes it out again, the bookmark stays.
    const toggle = screen.getByRole('button', { name: 'Bookmarks' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('list')).toBeNull()
    const bookmark = screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' })
    expect(bookmark.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(bookmark)
    expect(screen.getByRole('button', { name: 'Bookmarks' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' }).classList.contains('selected')).toBe(true)
    const rows = getStore().graph('main').sheets.cartesian
    expect(rows.map((row) => row.text)).toEqual(['y = a x + b', 'a = 1', 'b = 0', 'y = x^2 - 2', ''])
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' }))
    expect(getStore().graph('main').sheets.cartesian.map((row) => row.text)).toEqual(['y = a x + b', 'a = 1', 'b = 0', ''])
    expect(screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' }).getAttribute('aria-pressed')).toBe('false')
    expect(getStore().bookmarks().items).toHaveLength(1)
    // Escape goes back to the expressions.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bookmark y = x^2 - 2' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Bookmarks' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('file into a new group from the row menu, nest one subgroup level and move up when a group is deleted', async () => {
    const { openMenu } = mount()
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    fireEvent.click(screen.getByRole('button', { name: 'Menu for expression 1' }))
    await lastMenu(openMenu).select('bookmark', 'bookmark:new-group')

    // The list opens with the new group's name field focused.
    const field = await screen.findByRole('textbox', { name: 'Group name' })
    expect(field.ownerDocument.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'Parabolas' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)
    const group = getStore().bookmarks().groups[0]
    expect(group.name).toBe('Parabolas')
    expect(getStore().bookmarks().items[0].group).toBe(group.id)

    // A top-level group's menu offers a subgroup; a subgroup's menu does not.
    fireEvent.click(screen.getByRole('button', { name: 'More for Parabolas' }))
    await lastMenu(openMenu).select('subgroup')
    const sub = await screen.findByRole('textbox', { name: 'Group name' })
    fireEvent.change(sub, { target: { value: 'Shifted' } })
    fireEvent.blur(sub)
    expect(getStore().bookmarks().groups.map((entry) => [entry.name, entry.parent ?? null])).toEqual([['Parabolas', null], ['Shifted', group.id]])
    fireEvent.click(screen.getByRole('button', { name: 'More for Shifted' }))
    expect(lastMenu(openMenu).items().some((item) => item.id === 'subgroup')).toBe(false)

    // The row menu lists the group with its subgroup in a flyout.
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Menu for expression 2' }))
    const flyout = lastMenu(openMenu).find('bookmark', `bookmark-group:${group.id}`)
    expect(flyout.submenu!.map((item) => item.label)).toEqual(['Parabolas', 'Shifted'])
    await act(async () => { await flyout.submenu![1].onSelect!() })
    expect(getStore().bookmarks().items.map((item) => item.row.text)).toEqual(['y = x^2 - 2', 'y = a x + b'])

    // Deleting the top-level group keeps both bookmarks; the subgroup becomes a group of its own.
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    fireEvent.click(screen.getByRole('button', { name: 'More for Parabolas' }))
    await lastMenu(openMenu).select('delete')
    const bookmarks = getStore().bookmarks()
    expect(bookmarks.groups.map((entry) => [entry.name, entry.parent ?? null])).toEqual([['Shifted', null]])
    expect(bookmarks.items.map((item) => item.group ?? null)).toEqual([null, bookmarks.groups[0].id])
    const list = screen.getByRole('group', { name: 'Bookmarks' })
    expect(within(list).getByText('Shifted')).toBeTruthy()
  })

  it('show a bookmark on its own view: switching to it when the graph holds it there, adding it when not', async () => {
    mount()
    render(<Sidebar />)
    await screen.findByDisplayValue('y = x^2 - 2')
    const polar = getStore().graph('main').sheets.polar[0]
    act(() => getStore().addBookmark('polar', polar))
    act(() => getStore().addBookmark('space', { ...polar, id: 'surface', text: 'z = x y' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bookmarks' }))
    // The polar sheet already holds it: the click shows it by switching the view and adds no copy.
    const shown = screen.getByRole('button', { name: `Bookmark ${polar.text}` })
    expect(shown.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(shown)
    expect(await screen.findByRole('button', { name: 'View: Polar' })).toBeTruthy()
    expect(getStore().graph('main').sheets.polar.filter((row) => row.text === polar.text)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Bookmarks' }).getAttribute('aria-pressed')).toBe('true')
    // One the graph does not hold is added on its own view.
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark z = x y' }))
    expect(await screen.findByRole('button', { name: 'View: 3D' })).toBeTruthy()
    expect(getStore().graph('main').sheets.space.filter((row) => row.text === 'z = x y')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Bookmark z = x y' }).getAttribute('aria-pressed')).toBe('true')
  })
})
