import { React, api } from './runtime'
import type { DragEvent, MouseEvent, ReactElement } from 'react'
import { paletteCssValue } from '@valley/plugin-sdk/palette'
import type { UiMenuItem } from '@valley/plugin-sdk'
import { bookmarksIn, definedByText, filedIn, folderMode, groupCount, sameExpression, subgroups, type BookmarkDrop } from './bookmarks'
import { Bookmark as BookmarkIcon, Check, ChevronDown, CollapseAll, ExpandAll, FolderIcon, FolderOpen, FolderPlus, More, NoteIcon, Pencil, Plus, TableIcon, Trash, X } from './icons'
import { uiText } from './localization'
import { INTEGRAL_AXES, MathText } from './MathText'
import { BOOKMARK_GROUP_NAME_MAX, MAIN_GRAPH, type Bookmark, type BookmarkGroup, type Mode, type Row } from './model'
import { NOTES_SEGMENT } from './Notes'
import { getStore, useGrapher } from './store'
import { viewOf } from './views'

type Dragged = { kind: 'bookmark' | 'group'; id: string }
type Mark = { key: string; position: 'before' | 'after' | 'inside' }

const menuTarget = (event: MouseEvent<HTMLElement>): { anchor: HTMLElement } | { x: number; y: number } =>
  event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : { anchor: event.currentTarget }

/**
 * The Bookmark entry of an expression row's menu: the top level and every group (a group with subgroups opens a flyout
 * that starts with itself), each ticked where this expression is already filed; picking a ticked one takes it out again.
 * New group files it in a fresh group and opens the bookmark list to name it.
 */
export function bookmarkMenu(mode: Mode, row: Row, showBookmarks: (renaming?: string) => void): UiMenuItem {
  const store = getStore()
  const bookmarks = store.bookmarks()
  const filed = filedIn(bookmarks, mode, row)
  const toggle = (group: string | undefined): void => {
    const existing = bookmarks.items.find((item) => item.mode === mode && item.group === group && sameExpression(item.row, row))
    if (existing) store.deleteBookmark(existing.id)
    else store.addBookmark(mode, row, group)
  }
  const entry = (id: string | undefined, label: string, icon: ReactElement): UiMenuItem => ({
    id: `bookmark:${id ?? ''}`,
    type: 'checkbox',
    checked: filed.has(id ?? ''),
    label,
    icon,
    enabled: filed.has(id ?? '') || store.canBookmark(),
    onSelect: () => toggle(id)
  })
  const groupEntry = (group: BookmarkGroup): UiMenuItem => entry(group.id, group.name || uiText('bookmarks.unnamed'), <FolderIcon />)
  return {
    id: 'bookmark',
    label: uiText(filed.size ? 'row.bookmarked' : 'row.bookmark'),
    icon: <BookmarkIcon />,
    submenu: [
      entry(undefined, uiText('bookmarks.title'), <BookmarkIcon />),
      ...bookmarks.groups.filter((group) => !group.parent).map((group): UiMenuItem => {
        const children = subgroups(bookmarks.groups, group.id)
        return children.length ? { id: `bookmark-group:${group.id}`, label: group.name || uiText('bookmarks.unnamed'), icon: <FolderIcon />, submenu: [groupEntry(group), ...children.map(groupEntry)] } : groupEntry(group)
      }),
      { type: 'separator' },
      {
        id: 'bookmark:new-group',
        label: uiText('bookmarks.newGroupItem'),
        icon: <FolderPlus />,
        enabled: store.canBookmark() && store.canAddBookmarkGroup(),
        onSelect: () => {
          const group = store.addBookmarkGroup(uiText('bookmarks.newGroup'))
          if (!group) return
          store.addBookmark(mode, row, group)
          showBookmarks(group)
        }
      }
    ]
  }
}

/** What a bookmark row shows: the typeset expression, or a table's point count. */
const BookmarkContent = ({ item }: { item: Bookmark }): ReactElement => {
  const table = item.row.table
  if (table) {
    const count = table.cells.filter(([x, y]) => x.trim() || y.trim()).length
    return <span className="grapher-bookmark-table"><TableIcon />{uiText('bookmarks.table', { count })}</span>
  }
  return <MathText text={item.row.text} otherwise={uiText('math.otherwise')} axes={INTEGRAL_AXES[item.mode]} />
}

/** The names of the sliders and functions saved with a bookmark, shown after its expression. */
const needNames = (item: Bookmark): string[] => [...new Set((item.needs ?? []).map(definedByText).filter((name): name is string => name !== null))]

/**
 * The bookmark list, in place of the expressions while the header's bookmark is on: groups with one level of subgroups
 * and the bookmarks filed in them, like Map's Favorites. A click on a bookmark puts a copy into the focused graph (on the
 * bookmark's view, with the sliders saved with it) and a second click takes it out; the list stays open and ticks the
 * bookmarks the view shown holds. A folder whose bookmarks all belong to one view shows them all at once on a click (and
 * takes them out on the next); a folder that mixes views only opens and closes. Clicking a folder also points
 * Properties → Notes at its notes. Rows drag to another place or group, and the ⋯ button (or a right-click) has the rest.
 */
export const BookmarkList = ({ graph, mode, renaming: initial, close }: { graph: string; mode: Mode; renaming?: string; close: () => void }): ReactElement => {
  const store = getStore()
  const { tab, active } = useGrapher()
  const bookmarks = store.bookmarks()
  // Properties → Notes follows the folder clicked last only while the list is open.
  React.useEffect(() => () => store.showFolderNote(null), [store])
  const { groups, items } = bookmarks
  const [renaming, setRenaming] = React.useState<string | null>(initial ?? null)
  React.useEffect(() => { if (initial) setRenaming(initial) }, [initial])
  const dragged = React.useRef<Dragged | null>(null)
  const pending = React.useRef<BookmarkDrop | null>(null)
  const [mark, setMark] = React.useState<Mark | null>(null)

  const addGroup = (parent?: string): void => {
    const id = store.addBookmarkGroup(uiText('bookmarks.newGroup'), parent)
    if (id) setRenaming(id)
  }
  const rename = (id: string, name: string): void => {
    setRenaming(null)
    store.renameBookmarkGroup(id, name)
  }
  // A click puts the bookmark into the focused graph or takes it out again; the list stays open, and the row shows whether
  // the graph holds it.
  const toggleInGraph = (item: Bookmark): void => { store.toggleBookmarkInGraph(graph, item.id) }
  /** Opens Properties on the Notes tab of the focused graph tab, showing a folder's notes. */
  const openNotes = (group: BookmarkGroup): void => {
    store.showFolderNote(group.id)
    api.workspace.showProperties(tab === MAIN_GRAPH ? store.forkGraph(active) : tab, { segmentId: NOTES_SEGMENT })
  }
  /** A mouse click leaves no focus ring behind; keyboard focus keeps it. */
  const settle = (event: MouseEvent<HTMLElement>): void => { if (event.detail > 0) event.currentTarget.blur() }

  // ---- drag and drop ----
  const clear = (): void => { dragged.current = null; pending.current = null; setMark(null) }
  const show = (next: Mark | null): void => { if (next?.key !== mark?.key || next?.position !== mark?.position) setMark(next) }
  const dragProps = (kind: Dragged['kind'], id: string) => ({
    draggable: renaming !== id,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation()
      dragged.current = { kind, id }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', id)
    },
    onDragEnd: clear
  })
  /** Where a drag over this row lands: its upper or lower half, or inside a group (a group dragged over a group may also nest). */
  const dropAt = (event: DragEvent<HTMLElement>, kind: Dragged['kind'], id: string): BookmarkDrop | null => {
    const drag = dragged.current
    if (!drag || (drag.kind === kind && drag.id === id)) return null
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - rect.top) / Math.max(1, rect.height)
    const candidates: BookmarkDrop[] = kind === 'bookmark'
      ? [{ kind, id, position: fraction < 0.5 ? 'before' : 'after' }]
      : drag.kind === 'bookmark'
        ? [{ kind, id, position: 'inside' }]
        : fraction < 0.3 ? [{ kind, id, position: 'before' }, { kind, id, position: 'inside' }]
          : fraction > 0.7 ? [{ kind, id, position: 'after' }, { kind, id, position: 'inside' }]
            : [{ kind, id, position: 'inside' }, { kind, id, position: fraction < 0.5 ? 'before' : 'after' }]
    return candidates.find((drop) => store.canMoveInBookmarks(drag.kind, drag.id, drop)) ?? null
  }
  const drop = (event: DragEvent<HTMLElement>): void => {
    event.stopPropagation()
    const drag = dragged.current
    const target = pending.current
    clear()
    if (!drag || !target) return
    event.preventDefault()
    store.moveInBookmarks(drag.kind, drag.id, target)
  }
  const dropProps = (kind: Dragged['kind'], id: string) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragged.current) return
      event.stopPropagation()
      const target = dropAt(event, kind, id)
      pending.current = target
      if (!target || target.kind === 'root') { show(null); return }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      show({ key: `${kind}:${id}`, position: target.position })
    },
    onDrop: drop
  })
  const markClass = (key: string): string => (mark?.key === key ? ` drop-${mark.position}` : '')

  // ---- menus ----
  const moveMenu = (item: Bookmark): UiMenuItem[] => {
    const moveTo = (group: string | undefined): void => {
      if (group !== item.group) store.moveInBookmarks('bookmark', item.id, group ? { kind: 'group', id: group, position: 'inside' } : { kind: 'root' })
    }
    const entry = (group: BookmarkGroup): UiMenuItem => ({ id: `move:${group.id}`, type: 'radio', checked: item.group === group.id, label: group.name || uiText('bookmarks.unnamed'), icon: <FolderIcon />, onSelect: () => moveTo(group.id) })
    return [
      { id: 'move:top', type: 'radio', checked: item.group === undefined, label: uiText('bookmarks.title'), icon: <BookmarkIcon />, onSelect: () => moveTo(undefined) },
      ...groups.filter((group) => !group.parent).map((group): UiMenuItem => {
        const children = subgroups(groups, group.id)
        return children.length ? { id: `move-group:${group.id}`, label: group.name || uiText('bookmarks.unnamed'), icon: <FolderIcon />, submenu: [entry(group), ...children.map(entry)] } : entry(group)
      })
    ]
  }
  const bookmarkMenuFor = (event: MouseEvent<HTMLElement>, item: Bookmark): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      store.bookmarkInGraph(graph, item.id)
        ? item.mode === mode
          ? { id: 'remove', label: uiText('bookmarks.removeFromGraph'), icon: <X />, onSelect: () => toggleInGraph(item) }
          : { id: 'show', label: uiText('bookmarks.showInGraph'), icon: <Check />, onSelect: () => toggleInGraph(item) }
        : { id: 'insert', label: uiText('bookmarks.insert'), icon: <Plus />, onSelect: () => toggleInGraph(item) },
      { id: 'move', label: uiText('bookmarks.move'), icon: <FolderIcon />, enabled: groups.length > 0, submenu: moveMenu(item) },
      { type: 'separator' },
      { id: 'delete', label: uiText('bookmarks.delete'), icon: <Trash />, danger: true, onSelect: () => store.deleteBookmark(item.id) }
    ], menuTarget(event)).catch(() => {})
  }
  const groupMenuFor = (event: MouseEvent<HTMLElement>, group: BookmarkGroup): void => {
    event.preventDefault()
    event.stopPropagation()
    void api.ui.openMenu([
      ...(!group.parent ? [{ id: 'subgroup', label: uiText('bookmarks.addSubgroup'), icon: <FolderPlus />, enabled: store.canAddBookmarkGroup(), onSelect: () => addGroup(group.id) }] : []),
      { id: 'rename', label: uiText('bookmarks.rename'), icon: <Pencil />, onSelect: () => setRenaming(group.id) },
      { id: 'notes', label: uiText('bookmarks.notes'), icon: <NoteIcon />, onSelect: () => openNotes(group) },
      { type: 'separator' },
      { id: 'delete', label: uiText('bookmarks.deleteGroup'), description: uiText('bookmarks.deleteGroupHint'), icon: <Trash />, danger: true, onSelect: () => store.deleteBookmarkGroup(group.id) }
    ], menuTarget(event)).catch(() => {})
  }
  const moreButton = (label: string, onOpen: (event: MouseEvent<HTMLElement>) => void): ReactElement => (
    <button type="button" className="grapher-bookmark-more" aria-haspopup="menu" aria-label={label} title={label}
      onClick={onOpen} onDoubleClick={(event) => event.stopPropagation()}>
      <More />
    </button>
  )

  // ---- rows ----
  const bookmarkRow = (item: Bookmark, depth: number): ReactElement => {
    const view = viewOf(item.mode)
    const ViewIcon = view.icon
    const viewName = uiText(`mode.${item.mode}`)
    const held = store.bookmarkInGraph(graph, item.id)
    // Ticked only while the view shown holds it, so ticks never stand on two views at once.
    const selected = held && item.mode === mode
    const name = item.row.table ? uiText('bookmarks.table', { count: item.row.table.cells.length }) : item.row.text
    const hint = uiText(item.mode === mode ? (held ? 'bookmarks.hintRemove' : 'bookmarks.hintAdd') : held ? 'bookmarks.hintShow' : 'bookmarks.hintAddView', { view: viewName })
    const needs = needNames(item)
    return (
      <div key={item.id} className={`grapher-bookmark-row${selected ? ' selected' : ''}${markClass(`bookmark:${item.id}`)}`} data-bookmark={item.id}
        style={{ ['--bookmark-depth' as string]: depth }} role="button" tabIndex={0} aria-pressed={selected}
        aria-label={uiText('bookmarks.itemNamed', { name })} {...api.ui.tooltip(hint)}
        onClick={(event) => { settle(event); if (event.detail < 2) toggleInGraph(item) }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleInGraph(item) } }}
        onContextMenu={(event) => bookmarkMenuFor(event, item)}
        {...dragProps('bookmark', item.id)} {...dropProps('bookmark', item.id)}>
        <span className="grapher-bookmark-slot" />
        <span className="grapher-bookmark-swatch" style={{ ['--swatch' as string]: paletteCssValue(item.row.color) }} aria-hidden />
        <span className="grapher-bookmark-math"><BookmarkContent item={item} /></span>
        {needs.length ? <span className="grapher-bookmark-needs" {...api.ui.tooltip(uiText('bookmarks.needs', { names: needs.join(', ') }))}>{needs.join(' · ')}</span> : null}
        {selected ? <Check className="grapher-bookmark-check" /> : null}
        <span className="grapher-bookmark-view" role="img" aria-label={viewName} data-other={item.mode !== mode || undefined}><ViewIcon /></span>
        {moreButton(uiText('bookmarks.more'), (event) => bookmarkMenuFor(event, item))}
      </div>
    )
  }
  const groupRows = (group: BookmarkGroup, depth: number): ReactElement[] => {
    const folded = group.collapsed === true
    const name = group.name || uiText('bookmarks.unnamed')
    const fold = (): void => {
      store.showFolderNote(group.id)
      store.setBookmarkGroupCollapsed(group.id, !folded)
    }
    // A one-view folder shows (or hides) all of its bookmarks; a folder that mixes views only opens and closes.
    const only = folderMode(bookmarks, group.id)
    const shown = only !== null && store.folderInGraph(graph, group.id)
    const activate = (): void => {
      if (only === null) { fold(); return }
      store.showFolderNote(group.id)
      store.toggleFolderInGraph(graph, group.id)
    }
    const OnlyIcon = only ? viewOf(only).icon : null
    const onlyName = only ? uiText(`mode.${only}`) : ''
    const hint = only === null ? undefined : uiText(shown ? 'bookmarks.folderHintRemove' : only === mode ? 'bookmarks.folderHintAdd' : 'bookmarks.folderHintAddView', { view: onlyName })
    const row = (
      <div key={group.id} className={`grapher-bookmark-row grapher-bookmark-group${markClass(`group:${group.id}`)}`} data-group={group.id}
        data-view={only ?? undefined}
        style={{ ['--bookmark-depth' as string]: depth }} role="button" tabIndex={0} aria-expanded={!folded}
        aria-pressed={only === null ? undefined : shown}
        aria-label={uiText(only === null ? 'bookmarks.folderNamed' : 'bookmarks.folderNamedView', { name, view: onlyName })}
        {...(hint ? api.ui.tooltip(hint) : {})}
        onClick={(event) => { settle(event); if (renaming !== group.id && event.detail < 2) activate() }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
          else if ((event.key === 'ArrowRight' && folded) || (event.key === 'ArrowLeft' && !folded)) { event.preventDefault(); fold() }
        }}
        onContextMenu={(event) => groupMenuFor(event, group)}
        {...dragProps('group', group.id)} {...dropProps('group', group.id)}>
        <button type="button" className="grapher-bookmark-slot grapher-bookmark-chevron" data-open={!folded || undefined} tabIndex={-1}
          aria-label={uiText(folded ? 'bookmarks.openFolder' : 'bookmarks.closeFolder', { name })}
          onClick={(event) => { event.stopPropagation(); settle(event); fold() }} onDoubleClick={(event) => event.stopPropagation()}>
          <ChevronDown />
        </button>
        {folded ? <FolderIcon className="grapher-bookmark-folder" /> : <FolderOpen className="grapher-bookmark-folder" />}
        {renaming === group.id ? (
          <input className="grapher-bookmark-name-field" autoFocus defaultValue={group.name} maxLength={BOOKMARK_GROUP_NAME_MAX} aria-label={uiText('bookmarks.groupName')}
            spellCheck={false} autoComplete="off"
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={(event) => rename(group.id, event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') { event.preventDefault(); setRenaming(null) }
            }} />
        ) : <span className="grapher-bookmark-name">{name}</span>}
        {renaming !== group.id ? <>
          {group.note ? <span className="grapher-bookmark-note" role="img" aria-label={uiText('bookmarks.hasNotes')} {...api.ui.tooltip(uiText('bookmarks.hasNotes'))}><NoteIcon /></span> : null}
          {shown ? <Check className="grapher-bookmark-check" /> : null}
          {OnlyIcon ? <span className="grapher-bookmark-view" role="img" aria-label={onlyName} data-other={only !== mode || undefined}><OnlyIcon /></span> : null}
          <span className="grapher-bookmark-count">{groupCount(bookmarks, group.id)}</span>
          {moreButton(uiText('bookmarks.groupMore', { name }), (event) => groupMenuFor(event, group))}
        </> : null}
      </div>
    )
    if (folded) return [row]
    return [row, ...subgroups(groups, group.id).flatMap((child) => groupRows(child, depth + 1)), ...bookmarksIn(items, group.id).map((item) => bookmarkRow(item, depth + 1))]
  }

  const allFolded = groups.length > 0 && groups.filter((group) => !group.parent || !groups.find((parent) => parent.id === group.parent)?.collapsed).every((group) => group.collapsed)
  const empty = !groups.length && !items.length
  return (
    <div className="grapher-bookmarks" onKeyDown={(event) => { if (event.key === 'Escape' && !renaming) { event.preventDefault(); close() } }}>
      <div className="grapher-bookmarks-bar">
        <span className="panel-title grapher-bookmarks-title">{uiText('bookmarks.title')}</span>
        <div className="panel-toolbar">
          {groups.length ? (
            <button type="button" className="panel-tool-btn" aria-label={uiText(allFolded ? 'bookmarks.expandAll' : 'bookmarks.collapseAll')} title={uiText(allFolded ? 'bookmarks.expandAll' : 'bookmarks.collapseAll')}
              onClick={() => store.setBookmarkGroupCollapsed(null, !allFolded)}>
              {allFolded ? <ExpandAll /> : <CollapseAll />}
            </button>
          ) : null}
          <button type="button" className="panel-tool-btn" aria-label={uiText('bookmarks.addGroup')} title={uiText('bookmarks.addGroup')} disabled={!store.canAddBookmarkGroup()} onClick={() => addGroup()}>
            <FolderPlus />
          </button>
        </div>
      </div>
      {empty ? (
        <p className="grapher-bookmarks-empty">{uiText('bookmarks.empty')}</p>
      ) : (
        <div className={`grapher-bookmark-tree${mark?.key === 'root' ? ' drop-root' : ''}`} role="group" aria-label={uiText('bookmarks.title')}
          onDragOver={(event) => {
            const drag = dragged.current
            if (!drag) return
            const target: BookmarkDrop = { kind: 'root' }
            pending.current = store.canMoveInBookmarks(drag.kind, drag.id, target) ? target : null
            if (!pending.current) { show(null); return }
            event.preventDefault()
            show({ key: 'root', position: 'after' })
          }}
          onDragLeave={(event) => { if (event.currentTarget === event.target && mark?.key === 'root') show(null) }}
          onDrop={drop}>
          {groups.filter((group) => !group.parent).flatMap((group) => groupRows(group, 0))}
          {bookmarksIn(items, undefined).map((item) => bookmarkRow(item, 0))}
        </div>
      )}
    </div>
  )
}
