import { React, api } from './runtime'
import type { ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactElement } from 'react'
import { paletteCssValue, paletteRef } from '@valley/plugin-sdk/palette'
import type { UiMenuItem } from '@valley/plugin-sdk'
import type { RowAnalysis } from './engine'
import { Check, ChevronDown, Copy, Eye, EyeOff, FolderIcon, FolderPlus, Grip, More, Pause, Pencil, Play, Plus, Slider, Smile, TableIcon, Trash, Warning, X } from './icons'
import { SliderAnimator, snap, startMotion } from './animate'
import { uiText } from './localization'
import { MathText } from './MathText'
import { ANIMATION_SPEEDS, COLORS, DEFAULT_ANIMATION, DEFAULT_LEVELS, MAIN_GRAPH, MAX_LEVELS, MAX_NAME, MODES, profileIds, blockEnd, createRow, createTable, filled, graphOf, intoNewFolder, leaveFolder, moveIntoGap, rangeVariable, removeFolder, unitsOf, type Animation, type AxisUnits, type Mode, type Row, type Table } from './model'
import { getStore, useGrapher } from './store'
import { notePlaying } from './details'
import { PROFILE_ICON_FOLDER, profileIconElement, profileIconSource, profileIconSvgs, refreshProfileIcons, subscribeProfileIcons } from './profileIcons'
import { PROFILE_ICONS } from './profileIconSet'
import { MAX_TABLE_ROWS, looksTabular, parseTable, type Cells, type PastedTable } from './table'
import { formatComplex, formatLinear, formatNumber, formatPolar } from './ticks'
import { viewOf, type Insert } from './views'

/** The reference's Properties segment id (`src/Reference.tsx` imports this module, so it is spelled out here). */
const REFERENCE_SEGMENT = 'grapher.reference'

const DRAWN = new Set(['function', 'polar', 'curve', 'point', 'implicit', 'surface', 'curve3', 'point3', 'region', 'cpoint', 'csurface', 'coords', 'psurface', 'implicit3', 'field', 'field3', 'contour', 'integral', 'volume', 'tangent', 'tplane', 'table'])

/** The row whose input takes focus on its next render (after Enter adds a row or Backspace removes one). */
let pendingFocus: string | null = null
/** The selection a row's input takes with its next focus: the placeholder of an inserted template. */
let pendingSelection: { id: string; start: number; end: number } | null = null
/** A note for a table row's next render, such as a paste cut to the row cap. */
const pendingNotice = new Map<string, string>()

/** Sheets whose points are x and y in the plane take tables of points; 3D and complex sheets do not. */
export const takesTables = (mode: Mode): boolean => {
  const view = viewOf(mode)
  return view.canvas === 'plane' && !view.complex
}

/** What a paste kept, in words: rows cut at the cap, columns left out, one column read as y values. */
function pasteNotice(pasted: PastedTable, limit: number): string | null {
  const notes: string[] = []
  if (pasted.total > limit) notes.push(uiText('table.capped', { kept: Math.min(pasted.total, limit), total: pasted.total, max: MAX_TABLE_ROWS }))
  if (pasted.extra) notes.push(uiText('table.extra'))
  if (pasted.single) notes.push(uiText('table.single'))
  return notes.length ? notes.join(' ') : null
}

/** A row turned into a table from pasted text: the header names the columns. */
export function pastedTable(text: string): { table: Table; notice: string | null } {
  const pasted = parseTable(text)
  return { table: { head: pasted.head ?? ['x', 'y'], cells: pasted.cells }, notice: pasteNotice(pasted, MAX_TABLE_ROWS) }
}

/** Writes a pasted block into the cells from (`at`, `column`) on: two columns fill both, one column only the one pasted into.
 * A header names the columns when the block starts in the first row and is skipped otherwise. */
export function pasteInto(table: Table, text: string, at: number, column: 0 | 1): { table: Table; notice: string | null } {
  const limit = Math.max(0, MAX_TABLE_ROWS - at)
  const pasted = parseTable(text, limit)
  const cells: Cells = table.cells.map(([x, y]) => [x, y])
  pasted.cells.forEach(([x, y], offset) => {
    const index = at + offset
    while (cells.length <= index) cells.push(['', ''])
    if (pasted.single) cells[index][column] = y
    else cells[index] = [x, y]
  })
  const head: [string, string] = pasted.head && at === 0 ? (pasted.single ? (column === 0 ? [pasted.head[1], table.head[1]] : [table.head[0], pasted.head[1]]) : pasted.head) : table.head
  return { table: { head, cells: trimCells(cells) }, notice: pasteNotice({ ...pasted, single: false }, limit) }
}

/** Blank rows at the end are dropped: the grid always shows one empty row to type into. */
export function trimCells(cells: Cells): Cells {
  let end = cells.length
  while (end > 0 && !cells[end - 1][0].trim() && !cells[end - 1][1].trim()) end--
  return cells.slice(0, end)
}

function stepDigits(step: number): number {
  return Math.max(0, Math.min(10, Math.ceil(-Math.log10(step) - 1e-9)))
}

/** `a = 1.3`: the text a slider writes back into its row. */
export function sliderText(name: string, value: number, step: number): string {
  return `${name} = ${Number(value.toFixed(stepDigits(step)))}`
}

/**
 * Types an insert-bar template into a sheet through the same store edit a keystroke makes: into the row whose input is
 * focused, replacing its selection, or else into the empty last row. The template's placeholder is selected so typing
 * replaces it; `table` turns the empty last row (or the focused empty row) into a table of points, and a template that
 * needs a definition such as f(x) gets it in a row above when the sheet has none.
 */
export function insertTemplate(graph: string, mode: Mode, insert: Pick<Insert, 'text' | 'select' | 'needs'>, focused?: { id: string; start: number; end: number } | null): void {
  const store = getStore()
  store.updateRows(graph, mode, (rows) => {
    const table = insert.text === 'table'
    if (table && !takesTables(mode)) return rows
    const typed = focused ? rows.find((row) => row.id === focused.id && !row.table && !(table && row.text.trim())) : undefined
    const target = typed ?? rows[rows.length - 1]
    let next = rows.map((row) => {
      if (row.id !== target.id) return row
      if (table) return { ...row, text: '', table: createTable() }
      const [start, end] = typed && focused ? [Math.min(focused.start, row.text.length), Math.min(focused.end, row.text.length)] : [0, row.text.length]
      const text = row.text.slice(0, start) + insert.text + row.text.slice(end)
      const at = insert.select ? insert.text.indexOf(insert.select) : -1
      pendingSelection = at >= 0 ? { id: row.id, start: start + at, end: start + at + insert.select!.length } : { id: row.id, start: start + insert.text.length, end: start + insert.text.length }
      return { ...row, text }
    })
    pendingFocus = target.id
    const head = insert.needs?.split('=')[0].replace(/\s+/g, '')
    if (insert.needs && head && !rows.some((row) => row.text.replace(/\s+/g, '').startsWith(`${head}=`))) {
      const at = next.findIndex((row) => row.id === target.id)
      next = [...next.slice(0, at), { ...createRow(next), text: insert.needs }, ...next.slice(at)]
    }
    return next
  })
}

/** The row input focused in this document, with its selection: where the insert bar types. */
function focusedRow(document: Document | undefined): { id: string; start: number; end: number } | null {
  const input = document?.activeElement
  if (!(input instanceof (document?.defaultView ?? window).HTMLInputElement) || !input.hasAttribute('data-row-input')) return null
  const id = input.closest<HTMLElement>('[data-row-id]')?.dataset.rowId
  return id ? { id, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length } : null
}

/** Under the header: one 38px row of small buttons that type the view's templates (Σ, ∫, f′, …); it scrolls sideways when narrow. */
const InsertBar = ({ graph, mode }: { graph: string; mode: Mode }): ReactElement | null => {
  const inserts = viewOf(mode).inserts?.filter((insert) => insert.text !== 'table' || takesTables(mode)) ?? []
  if (!inserts.length) return null
  return (
    <div className="grapher-insert-bar" role="toolbar" aria-label={uiText('insert.bar')}>
      {inserts.map((insert) => {
        const label = uiText(`insert.${insert.id}`)
        const Glyph = insert.glyph
        return (
          <button
            key={insert.id}
            type="button"
            className="grapher-insert"
            aria-label={label}
            {...api.ui.tooltip(label)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => insertTemplate(graph, mode, insert, focusedRow(event.currentTarget.ownerDocument))}
          >
            {typeof Glyph === 'string' ? <span className="grapher-insert-glyph">{Glyph}</span> : <Glyph className="grapher-insert-icon" />}
          </button>
        )
      })}
    </div>
  )
}

/** Opens a new tab with a fresh graph of its own on the given view. */
export function openNewGraph(mode: Mode, paneId?: string): void {
  const id = getStore().createGraph(mode)
  api.workspace.openMainTab({ instanceId: id, title: getStore().profileName(id), newTab: true, paneId })
}

/** The header's view button: the focused graph's view; it swaps the expression list for the list of views. */
const ViewButton = ({ mode, open, toggle }: { mode: Mode; open: boolean; toggle: () => void }): ReactElement => {
  const Icon = viewOf(mode).icon
  return (
    <button type="button" className="grapher-view-picker" aria-expanded={open} aria-label={uiText('view.choose', { mode: uiText(`mode.${mode}`) })} onClick={toggle}>
      <Icon className="grapher-view-icon" />
      <span className="grapher-view-name">{uiText(`mode.${mode}`)}</span>
      <ChevronDown className="grapher-view-chevron" />
    </button>
  )
}

/** Every view as a full-width choice in place of the expressions; ⌘-click opens the view as a new graph in its own tab. */
const ViewList = ({ graph, mode, close }: { graph: string; mode: Mode; close: () => void }): ReactElement => {
  const store = getStore()
  const listRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])
    const at = buttons.indexOf(event.target as HTMLButtonElement)
    buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  return (
    <div ref={listRef} className="grapher-views" role="radiogroup" aria-label={uiText('mode.label')} onKeyDown={onKeyDown}>
      {MODES.map((candidate) => {
        const Icon = viewOf(candidate).icon
        const checked = candidate === mode
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={checked}
            className={checked ? 'grapher-view-option active' : 'grapher-view-option'}
            onClick={(event) => {
              if (api.ui.hasModKey(event)) openNewGraph(candidate)
              else store.setMode(graph, candidate)
              close()
            }}
          >
            <Icon className="grapher-view-option-icon" />
            <span className="grapher-view-option-text">
              <span className="grapher-view-option-name">{uiText(`mode.${candidate}`)}</span>
              <span className="grapher-view-option-hint">{uiText(`mode.${candidate}.hint`)}</span>
            </span>
            {checked ? <Check className="grapher-view-option-check" /> : <span className="grapher-view-option-check" />}
          </button>
        )
      })}
    </div>
  )
}

/** A profile's icon: its SVG from the icon folder (or the bundled copy of it), drawn in the text colour; the view's icon
 * only while a profile has none yet. */
export const ProfileGlyph = ({ profile, className }: { profile: string; className: string }): ReactElement => {
  const { document } = useGrapher()
  React.useSyncExternalStore(subscribeProfileIcons, profileIconSvgs)
  const source = profileIconSource(document.icons?.[profile])
  if (source) return <span className={`grapher-profile-glyph ${className}`} style={{ maskImage: `url("${source}")`, WebkitMaskImage: `url("${source}")` }} aria-hidden />
  const Icon = viewOf(graphOf(document, profile).mode).icon
  return <Icon className={className} />
}

/**
 * The icons of the folder as a compact grid drawn inside the profile list, under the profile's row. It is not a host
 * popover: one opened from a menu entry depended on the closed menu and its anchor, and never appeared.
 */
const IconPicker = ({ profile, close }: { profile: string; close: () => void }): ReactElement => {
  const store = getStore()
  const icons = React.useSyncExternalStore(subscribeProfileIcons, profileIconSvgs)
  React.useEffect(() => { void refreshProfileIcons() }, [])
  const chosen = store.getSnapshot().document.icons?.[profile]
  return (
    <div className="grapher-icon-grid" role="group" aria-label={uiText('profile.icons', { folder: PROFILE_ICON_FOLDER })} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      {Object.keys(icons).sort((a, b) => a.localeCompare(b)).map((name) => {
        const source = profileIconSource(name)!
        return (
          <button key={name} type="button" className="grapher-icon-choice" aria-pressed={chosen === name} aria-label={name} title={name} onClick={() => { store.setProfileIcon(profile, name); close() }}>
            <span className="grapher-profile-glyph" style={{ maskImage: `url("${source}")`, WebkitMaskImage: `url("${source}")` }} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

/** Under the view header: the profile the focused tab shows (its icon and name) and a button for a new one. */
const ProfileBar = ({ tab, profile, open, toggle }: { tab: string; profile: string; open: boolean; toggle: () => void }): ReactElement => {
  const store = getStore()
  const { document } = useGrapher()
  const name = store.profileName(profile)
  return (
    <div className="grapher-profile-bar">
      <button type="button" className="grapher-view-picker grapher-profile-picker" aria-expanded={open} aria-label={uiText('profile.choose', { name })} onClick={toggle}>
        <ProfileGlyph profile={profile} className="grapher-view-icon" />
        <span className="grapher-view-name">{name}</span>
        <ChevronDown className="grapher-view-chevron" />
      </button>
      <button
        type="button"
        className="grapher-profile-action"
        aria-label={uiText('profile.add')}
        title={uiText('profile.add')}
        disabled={!store.canAddProfile()}
        onClick={() => store.createProfile(tab, graphOf(document, profile).mode)}
      >
        <Plus />
      </button>
    </div>
  )
}

/** The icons the menu offers: the folder's, or the bundled ones until it has been listed. */
const iconNames = (): string[] => {
  const listed = Object.keys(profileIconSvgs())
  return (listed.length ? listed : Object.keys(PROFILE_ICONS)).sort((a, b) => a.localeCompare(b))
}

/** Every profile in place of the expressions, one compact row each: the whole row picks it for the focused tab; the
 * three dots (or a right-click) open Rename, Change icon, Duplicate and Delete. */
const ProfileList = ({ tab, profile, close }: { tab: string; profile: string; close: () => void }): ReactElement => {
  const store = getStore()
  const { document } = useGrapher()
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [picking, setPicking] = React.useState<string | null>(null)
  const ids = profileIds(document)
  const last = ids.length < 2
  // Reordering by the grip, as the expression rows do: one marker at the midpoint of the gap nearest the pointer.
  const listRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ pointer: number; from: number; to: number } | null>(null)
  const [drag, setDrag] = React.useState<{ from: number; to: number; marker: number } | null>(null)
  const gapAt = (clientY: number): { gap: number; marker: number } | null => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-profile]') ?? [])
    if (!rows.length) return null
    let gap = 0
    rows.forEach((row, at) => {
      const rect = row.getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) gap = at + 1
    })
    const before = rows[gap - 1]
    const after = rows[gap]
    const marker = before && after ? (before.offsetTop + before.offsetHeight + after.offsetTop) / 2 : after ? after.offsetTop : before.offsetTop + before.offsetHeight
    return { gap, marker }
  }
  const startDrag = (index: number) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const found = gapAt(event.clientY)
    dragRef.current = { pointer: event.pointerId, from: index, to: index }
    setDrag({ from: index, to: index, marker: found?.marker ?? 0 })
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current || current.pointer !== event.pointerId) return
    const found = gapAt(event.clientY)
    if (!found) return
    current.to = found.gap
    setDrag({ from: current.from, to: found.gap, marker: found.marker })
  }
  const endDrag = (commit: boolean) => (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current || current.pointer !== event.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (commit) store.moveProfile(current.from, current.to)
  }
  const showMarker = drag !== null && drag.to !== drag.from && drag.to !== drag.from + 1
  const menu = (id: string, target: { anchor: HTMLElement } | { x: number; y: number }): void => {
    const items: UiMenuItem[] = [
      { id: 'rename', label: uiText('profile.renameItem'), icon: <Pencil />, onSelect: () => setRenaming(id) },
      {
        id: 'icon',
        label: uiText('profile.iconItem'),
        icon: <Smile />,
        // A flyout beside the menu with every icon of the folder; picking one closes the menu and saves it.
        submenu: iconNames().map((icon): UiMenuItem => ({
          id: `icon:${icon}`,
          type: 'radio',
          checked: document.icons?.[id] === icon,
          label: icon,
          icon: profileIconElement(icon) ?? <Smile />,
          onSelect: () => store.setProfileIcon(id, icon)
        }))
      },
      { id: 'duplicate', label: uiText('profile.duplicateItem'), icon: <Copy />, enabled: store.canAddProfile(), onSelect: () => store.duplicateProfile(tab, id) },
      { type: 'separator' },
      { id: 'delete', label: uiText('profile.deleteItem'), icon: <Trash />, danger: true, enabled: !last, ...(last ? { description: uiText('profile.lastOne') } : {}), onSelect: () => store.deleteProfile(id) }
    ]
    void refreshProfileIcons()
    void api.ui.openMenu(items, target).catch(() => {})
  }
  return (
    <div
      ref={listRef}
      className="grapher-views grapher-profiles"
      role="radiogroup"
      aria-label={uiText('profile.list')}
      data-dragging={drag ? '' : undefined}
      onKeyDown={(event) => { if (event.key === 'Escape' && !renaming) { event.preventDefault(); close() } }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag(true)}
      onPointerCancel={endDrag(false)}
    >
      {ids.map((id, index) => {
        const name = store.profileName(id)
        const checked = id === profile
        return (
          <React.Fragment key={id}>
          <div
            className={checked ? 'grapher-profile-row active' : 'grapher-profile-row'}
            data-profile={id}
            data-dragging={drag?.from === index || undefined}
            onContextMenu={(event) => { event.preventDefault(); menu(id, { x: event.clientX, y: event.clientY }) }}
          >
            <button type="button" className="grapher-profile-grip" tabIndex={-1} aria-label={uiText('profile.drag', { name })} title={uiText('profile.drag', { name })} onPointerDown={startDrag(index)}>
              <Grip />
            </button>
            <button type="button" className="grapher-profile-icon" aria-expanded={picking === id} aria-label={uiText('profile.icon', { name })} title={uiText('profile.icon', { name })} onClick={() => setPicking((open) => (open === id ? null : id))}>
              <ProfileGlyph profile={id} className="grapher-profile-item-icon" />
            </button>
            {renaming === id ? (
              <span className="grapher-profile-item">
                <input
                  className="grapher-profile-name-field"
                  defaultValue={name}
                  maxLength={MAX_NAME}
                  aria-label={uiText('profile.nameField', { name })}
                  spellCheck={false}
                  autoComplete="off"
                  ref={(input) => { if (input && input.ownerDocument.activeElement !== input) { input.focus(); input.select() } }}
                  onBlur={(event) => { store.renameProfile(id, event.currentTarget.value); setRenaming(null) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.value = name; setRenaming(null) }
                  }}
                />
              </span>
            ) : (
              <button type="button" role="radio" aria-checked={checked} className="grapher-profile-item" onClick={() => { store.setTabProfile(tab, id); close() }}>
                <span className="grapher-profile-item-name">{name}</span>
                {checked ? <Check className="grapher-profile-item-check" /> : null}
              </button>
            )}
            <button type="button" className="grapher-profile-more" aria-haspopup="menu" aria-label={uiText('profile.more', { name })} title={uiText('profile.more', { name })} onClick={(event) => menu(id, { anchor: event.currentTarget })}>
              <More />
            </button>
          </div>
          {picking === id ? <IconPicker profile={id} close={() => setPicking(null)} /> : null}
          </React.Fragment>
        )
      })}
      {showMarker ? <div className="grapher-drop-marker" style={{ top: drag.marker }} aria-hidden /> : null}
    </div>
  )
}

/** Beside the open-graph button on every view: label the axes in real numbers or in multiples of π; only the labels change. */
const UnitsSwitch = ({ graph, mode, units }: { graph: string; mode: Mode; units: AxisUnits }): ReactElement => {
  const store = getStore()
  return (
    <div className="grapher-units" role="radiogroup" aria-label={uiText('units.label')}>
      {(['decimal', 'pi'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="radio"
          aria-checked={units === candidate}
          className={units === candidate ? 'grapher-unit active' : 'grapher-unit'}
          aria-label={uiText(`units.${candidate}`)}
          {...api.ui.tooltip(uiText(`units.${candidate}`))}
          onClick={() => store.setUnits(graph, mode, candidate)}
        >
          {candidate === 'pi' ? 'π' : 'ℝ'}
        </button>
      ))}
    </div>
  )
}

interface RowProps {
  mode: Mode
  row: Row
  index: number
  trailing: boolean
  analysis: RowAnalysis | undefined
  edit: (change: (row: Row) => Row) => void
  insertAfter: () => void
  remove: (focus: 'previous' | 'next') => void
  addSlider: (name: string) => void
  dragging: boolean
  startDrag: (event: PointerEvent<HTMLButtonElement>) => void
  /** Rows in a folder are indented, and dimmed while the folder is hidden. */
  inFolder: boolean
  folderHidden: boolean
  leaveFolder: () => void
  intoNewFolder: () => void
}

/** Focuses the input of the rendered row `delta` places away (rows in a closed folder are not rendered). */
function focusNeighbour(from: HTMLElement, delta: number): boolean {
  const row = from.closest<HTMLElement>('[data-row-index]')
  const rows = Array.from(row?.closest('.grapher-list')?.querySelectorAll<HTMLElement>('[data-row-index]') ?? [])
  const target = rows[rows.indexOf(row!) + delta]?.querySelector<HTMLInputElement>(':is(input[data-row-input], input[data-folder-input], input[data-cell])')
  target?.focus()
  return Boolean(target)
}

const SliderControl = (props: Pick<RowProps, 'mode' | 'row' | 'analysis' | 'edit'>): ReactElement | null => {
  const { analysis } = props
  if (analysis?.kind !== 'param' || !analysis.slider || analysis.name === undefined || analysis.value === undefined) return null
  return <SliderBody {...props} name={analysis.name} value={analysis.value} />
}

const DIRECTIONS = ['forward', 'backward', 'bounce'] as const
const DIRECTION_SIGNS: Record<Animation['direction'], string> = { forward: '→', backward: '←', bounce: '↔' }
const speedText = (speed: number): string => (speed === 0.25 ? '¼×' : speed === 0.5 ? '½×' : `${speed}×`)

/** The open graph tab, as a key: an animation stops when another tab (of any plugin, or a file) takes the focus. */
const tabKey = (): string => {
  const tab = api.getState().activePluginTab
  return tab ? `${tab.pluginId}:${tab.instanceId ?? ''}` : ''
}

/**
 * A slider row: play button, bounds and range, and a toggle for its animation options (direction, speed, loop). Playing
 * writes the value into the row quietly each frame (at most 30 a second) and saves once when it stops; it stops when the
 * sidebar edits another graph, another tab takes the focus, the document is hidden, the row is edited or dragged by hand,
 * or the row goes away.
 */
const SliderBody = ({ mode, row, edit, name, value }: Pick<RowProps, 'mode' | 'row' | 'edit'> & { name: string; value: number }): ReactElement => {
  const { active } = useGrapher()
  const { step } = row.slider
  const min = Math.min(row.slider.min, value)
  const max = Math.max(row.slider.max, value)
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  const settings = row.animation ?? DEFAULT_ANIMATION
  const ref = React.useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [options, setOptions] = React.useState(false)
  const live = React.useRef({ bounds: { min: row.slider.min, max: row.slider.max }, settings })
  live.current = { bounds: { min: row.slider.min, max: row.slider.max }, settings }
  const run = React.useRef<{ animator: SliderAnimator; graph: string; row: string; written: string; off: () => void } | null>(null)

  const stop = React.useCallback((): void => {
    const current = run.current
    if (!current) return
    run.current = null
    current.animator.stop()
    current.off()
    notePlaying(current.graph, current.row, false)
    setPlaying(false)
    getStore().commit()
  }, [])

  const play = (): void => {
    const view = ref.current?.ownerDocument.defaultView
    if (!view || run.current) return
    const graph = active
    const id = row.id
    const tab = tabKey()
    const off = api.subscribeState(['activePluginTab'], () => { if (tabKey() !== tab) stop() })
    const animator = new SliderAnimator(view, startMotion(value, live.current.bounds, settings), {
      bounds: () => live.current.bounds,
      settings: () => live.current.settings,
      frame: (next) => {
        const current = run.current
        if (!current) return
        const text = sliderText(name, snap(next, live.current.bounds, step), step)
        if (text === current.written) return
        current.written = text
        getStore().updateRows(graph, mode, (rows) => rows.map((candidate) => (candidate.id === id ? { ...candidate, text } : candidate)), { quiet: true })
      },
      end: stop
    })
    run.current = { animator, graph, row: id, written: row.text, off }
    notePlaying(graph, id, true)
    setPlaying(true)
    animator.start()
  }

  // A hand edit of the row (typing, dragging the range) or another graph in the sidebar stops it; so does unmounting.
  React.useEffect(() => { if (run.current && row.text !== run.current.written) stop() }, [row.text, stop])
  React.useEffect(() => { if (run.current && run.current.graph !== active) stop() }, [active, stop])
  React.useEffect(() => stop, [stop])

  // A bound that leaves the value outside the range pulls the value in, so the bar shows what was typed.
  const setBound = (key: 'min' | 'max') => (next: number): boolean => {
    const slider = { ...row.slider, min, max, [key]: next }
    if (!(slider.min < slider.max)) return false
    const clamped = Math.min(slider.max, Math.max(slider.min, value))
    edit((current) => ({ ...current, slider, ...(clamped !== value ? { text: sliderText(name, clamped, step) } : {}) }))
    return true
  }
  const setAnimation = (patch: Partial<Animation>): void => edit((current) => ({ ...current, animation: { ...(current.animation ?? DEFAULT_ANIMATION), ...patch } }))
  return (
    <div className="grapher-slider-block" ref={ref}>
      <div className="grapher-slider">
        <button
          type="button"
          className="grapher-play"
          aria-pressed={playing}
          aria-label={uiText(playing ? 'slider.pause' : 'slider.play', { name })}
          title={uiText(playing ? 'slider.pause' : 'slider.play', { name })}
          onClick={playing ? stop : play}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <input
          className="grapher-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ ['--slider-fill' as string]: `${fill}%` }}
          aria-label={uiText('slider.value', { name })}
          onChange={(event) => {
            const next = Number(event.target.value)
            edit((current) => ({ ...current, text: sliderText(name, next, step) }))
          }}
        />
        <button
          type="button"
          className="grapher-play-options"
          aria-expanded={options}
          aria-label={uiText('slider.options', { name })}
          title={uiText('slider.options', { name })}
          onClick={() => setOptions((open) => !open)}
        >
          <ChevronDown />
        </button>
      </div>
      <div className="grapher-slider-bounds">
        <BoundField value={min} align="start" label={uiText('slider.min', { name })} commit={setBound('min')} />
        <BoundField value={max} align="end" label={uiText('slider.max', { name })} commit={setBound('max')} />
      </div>
      {options ? (
        <div className="grapher-animation">
          <div className="grapher-units" role="radiogroup" aria-label={uiText('slider.direction')}>
            {DIRECTIONS.map((direction) => (
              <button key={direction} type="button" role="radio" aria-checked={settings.direction === direction} className={`grapher-unit${settings.direction === direction ? ' active' : ''}`} aria-label={uiText(`slider.${direction}`)} title={uiText(`slider.${direction}`)} onClick={() => setAnimation({ direction })}>
                {DIRECTION_SIGNS[direction]}
              </button>
            ))}
          </div>
          <div className="grapher-units" role="radiogroup" aria-label={uiText('slider.speed')}>
            {ANIMATION_SPEEDS.map((speed) => (
              <button key={speed} type="button" role="radio" aria-checked={settings.speed === speed} className={`grapher-unit${settings.speed === speed ? ' active' : ''}`} aria-label={uiText('slider.speedValue', { speed })} title={uiText('slider.speedValue', { speed })} onClick={() => setAnimation({ speed })}>
                {speedText(speed)}
              </button>
            ))}
          </div>
          <OptionToggle label={uiText('slider.loop')} checked={settings.loop} onChange={(loop) => setAnimation({ loop })} />
        </div>
      ) : null}
    </div>
  )
}

const formatBound = (value: number): string => String(Number(value.toPrecision(8)))

/** A typed bound: a plain decimal number, with a decimal comma or a typographic minus accepted. */
export function parseBound(text: string): number | null {
  const clean = text.trim().replace(/\u2212/g, '-').replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(clean)) return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

/**
 * One end of a slider, under the bar's end. While focused it keeps the typed text, so the field can be emptied or start
 * with a minus or a point; each complete number that keeps min below max applies at once, Enter or leaving the field
 * shows the bound again and Escape puts back the bound it had when focused.
 */
const BoundField = ({ value, align, label, commit }: { value: number; align: 'start' | 'end'; label: string; commit: (next: number) => boolean }): ReactElement => {
  const [draft, setDraft] = React.useState<string | null>(null)
  const [bad, setBad] = React.useState(false)
  const initial = React.useRef(value)
  return (
    <input
      className={`grapher-slider-bound grapher-slider-bound-${align}`}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      value={draft ?? formatBound(value)}
      aria-label={label}
      aria-invalid={bad || undefined}
      onFocus={(event) => {
        initial.current = value
        setDraft(formatBound(value))
        event.currentTarget.select()
      }}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const next = parseBound(text)
        setBad(text.trim() !== '' && next !== null && !commit(next))
      }}
      onBlur={() => {
        setDraft(null)
        setBad(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          commit(initial.current)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

/** One range row, `from ≤ variable ≤ to`, editing the row's first (`from`, `to`) or second (`from2`, `to2`) range. */
const Domain = ({ row, edit, keys, variable, placeholders }: Pick<RowProps, 'row' | 'edit'> & { keys: readonly ['from', 'to'] | readonly ['from2', 'to2']; variable: string; placeholders: readonly [string, string] }): ReactElement => {
  const field = (key: 'from' | 'to' | 'from2' | 'to2', label: 'range.from' | 'range.to', placeholder: string): ReactElement => (
    <input
      className="grapher-bound grapher-range-bound"
      value={row[key]}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      aria-label={uiText(label, { name: variable })}
      onChange={(event) => {
        const value = event.target.value
        edit((current) => ({ ...current, [key]: value }))
      }}
    />
  )
  return (
    <div className="grapher-domain">
      {field(keys[0], 'range.from', placeholders[0])}
      <span className="grapher-domain-variable">≤ {variable} ≤</span>
      {field(keys[1], 'range.to', placeholders[1])}
    </div>
  )
}

const RangeControl = ({ mode, row, analysis, edit }: Pick<RowProps, 'mode' | 'row' | 'analysis' | 'edit'>): ReactElement | null => {
  if ((analysis?.kind === 'coords' || analysis?.kind === 'psurface') && analysis.over) {
    const view = viewOf(mode)
    const ranges = view.canvas === 'space' ? view.ranges ?? {} : {}
    const [u, v] = analysis.over
    return (
      <>
        <Domain row={row} edit={edit} keys={['from', 'to']} variable={u} placeholders={ranges[u] ?? ['0', '2π']} />
        <Domain row={row} edit={edit} keys={['from2', 'to2']} variable={v} placeholders={ranges[v] ?? ['0', '2π']} />
      </>
    )
  }
  if (analysis?.kind !== 'polar' && analysis?.kind !== 'curve' && analysis?.kind !== 'curve3') return null
  return <Domain row={row} edit={edit} keys={['from', 'to']} variable={rangeVariable(analysis.kind)} placeholders={['0', '2π']} />
}

/** A row option that is on or off, as a compact chip under the row. */
/** The row with its arrows flowing or still; a still field carries no `flow` at all, like a row of an older file. */
function withFlow(row: Row, flow: boolean): Row {
  const { flow: _, ...rest } = row
  return flow ? { ...rest, flow: true } : rest
}

const OptionToggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement => (
  <button type="button" role="switch" aria-checked={checked} className="grapher-option" onClick={() => onChange(!checked)}>
    <span className="grapher-option-box">{checked ? <Check /> : null}</span>
    {label}
  </button>
)

/** How many level curves a row draws (at most this many round levels in view) or the step between them, which takes over when set. */
const LevelsControl = ({ row, edit }: Pick<RowProps, 'row' | 'edit'>): ReactElement => {
  const stepped = Boolean(row.step?.trim())
  return (
    <div className="grapher-domain">
      <input
        className="grapher-bound grapher-levels-count"
        type="number"
        min={1}
        max={MAX_LEVELS}
        step={1}
        value={row.levels ?? DEFAULT_LEVELS}
        disabled={stepped}
        aria-label={uiText('levels.count')}
        onChange={(event) => {
          const value = Number(event.target.value)
          if (Number.isInteger(value) && value >= 1 && value <= MAX_LEVELS) edit((current) => ({ ...current, levels: value }))
        }}
      />
      <span className="grapher-domain-variable">{uiText('levels.unit')}</span>
      <input
        className="grapher-bound grapher-range-bound"
        value={row.step ?? ''}
        placeholder={uiText('levels.auto')}
        spellCheck={false}
        autoComplete="off"
        aria-label={uiText('levels.step')}
        onChange={(event) => {
          const value = event.target.value
          edit((current) => ({ ...current, step: value }))
        }}
      />
      <span className="grapher-domain-variable">{uiText('levels.stepUnit')}</span>
    </div>
  )
}

const Details = (props: RowProps): ReactElement | null => {
  const { analysis, row } = props
  if (!analysis || !row.text.trim()) return null
  switch (analysis.kind) {
    case 'error': {
      const error = analysis.error
      if (!error) return null
      return (
        <div className="grapher-error" role="status">
          <span>{uiText(error.key, { name: error.param })}</span>
          {error.missing.length ? (
            <span className="grapher-chips">
              {error.missing.map((name) => (
                <button key={name} type="button" className="grapher-chip" onClick={() => props.addSlider(name)}>
                  <Slider />
                  {uiText('row.addSlider', { name })}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      )
    }
    case 'value':
    case 'integral':
    case 'volume':
      return <div className="grapher-value">= {formatNumber(analysis.value ?? Number.NaN, 8)}</div>
    case 'tangent':
      return <div className="grapher-value">y = {formatLinear([[analysis.slope ?? Number.NaN, 'x']], analysis.intercept ?? Number.NaN)}</div>
    case 'tplane': {
      const [gx, gy] = analysis.gradient ?? [Number.NaN, Number.NaN]
      const [a, b, c] = [analysis.x ?? Number.NaN, analysis.y ?? Number.NaN, analysis.z ?? Number.NaN]
      return (
        <>
          <div className="grapher-value">z = {formatLinear([[gx, 'x'], [gy, 'y']], c - gx * a - gy * b)}</div>
          <div className="grapher-value">n = ({[-gx, -gy, 1].map((value) => formatNumber(value, 4)).join(', ')})</div>
          <div className="grapher-options">
            <OptionToggle label={uiText('row.normal')} checked={row.normal !== false} onChange={(checked) => props.edit((current) => ({ ...current, normal: checked }))} />
          </div>
        </>
      )
    }
    case 'cpoint': {
      const [re, im] = [analysis.x ?? Number.NaN, analysis.y ?? Number.NaN]
      return <div className="grapher-value">= {formatComplex(re, im, 6)} = {formatPolar(re, im, 6)}</div>
    }
    case 'param':
      return analysis.slider ? <SliderControl {...props} /> : <div className="grapher-value">= {formatNumber(analysis.value ?? Number.NaN, 8)}</div>
    case 'polar':
    case 'curve':
    case 'curve3':
    case 'coords':
    case 'psurface':
      return <RangeControl {...props} />
    case 'contour':
      return (
        <>
          <LevelsControl row={row} edit={props.edit} />
          <div className="grapher-options">
            <OptionToggle label={uiText('levels.labels')} checked={row.labels !== false} onChange={(checked) => props.edit((current) => ({ ...current, labels: checked }))} />
          </div>
        </>
      )
    case 'surface':
      if (analysis.axis !== 'z') return null
      return (
        <>
          <div className="grapher-options">
            <OptionToggle label={uiText('levels.floor')} checked={row.floor === true} onChange={(checked) => props.edit((current) => ({ ...current, floor: checked }))} />
          </div>
          {row.floor ? <LevelsControl row={row} edit={props.edit} /> : null}
        </>
      )
    case 'table':
      return (
        <div className="grapher-options">
          <OptionToggle label={uiText('table.connect')} checked={row.connect === true} onChange={(checked) => props.edit((current) => ({ ...current, connect: checked }))} />
          <span className="grapher-value">{uiText('table.points', { count: analysis.count ?? 0 })}</span>
        </div>
      )
    case 'field':
    case 'field3':
      return (
        <div className="grapher-options">
          <OptionToggle label={uiText('row.magnitude')} checked={row.magnitude !== false} onChange={(checked) => props.edit((current) => ({ ...current, magnitude: checked }))} />
          <OptionToggle label={uiText('row.flow')} checked={row.flow === true} onChange={(checked) => props.edit((current) => withFlow(current, checked))} />
        </div>
      )
    default:
      return null
  }
}

/** Height of one table row in pixels (`.grapher-cell`), and how many rows the grid renders around the scrolled position. */
const CELL_HEIGHT = 22
const CELL_WINDOW = 48

/** A table of points: the column names, the cells (plus an empty row to type into), Connect points and what was drawn.
 * Only the rows near the scrolled position are rendered, so a table of 1000 rows stays light. */
const TableGrid = ({ row, index: rowIndex, analysis, edit, addSlider }: Pick<RowProps, 'row' | 'index' | 'analysis' | 'edit' | 'addSlider'>): ReactElement | null => {
  const gridRef = React.useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = React.useState(0)
  const [notice, setNotice] = React.useState<string | null>(() => {
    const note = pendingNotice.get(row.id) ?? null
    pendingNotice.delete(row.id)
    return note
  })
  React.useEffect(() => {
    if (pendingFocus !== row.id) return
    pendingFocus = null
    gridRef.current?.querySelector<HTMLInputElement>('input[data-cell="0:0"]')?.focus()
  })
  const table = row.table
  if (!table) return null
  const shown: Cells = table.cells.length < MAX_TABLE_ROWS ? [...table.cells, ['', '']] : table.cells
  const bad = new Set(analysis?.kind === 'table' ? analysis.bad ?? [] : [])
  const setTable = (change: (table: Table) => Table): void => edit((current) => (current.table ? { ...current, table: change(current.table) } : current))
  const focusCell = (at: number, column: number): void => {
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${at}:${column}"]`)?.focus())
  }
  const setCell = (at: number, column: 0 | 1, value: string): void => setTable((current) => {
    const cells: Cells = current.cells.map(([x, y]) => [x, y])
    while (cells.length <= at) cells.push(['', ''])
    cells[at][column] = value
    return { ...current, cells: trimCells(cells) }
  })
  const onPaste = (at: number, column: 0 | 1) => (event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData.getData('text/plain')
    if (!/[\t\n\r;]/.test(text.trim())) return
    event.preventDefault()
    const result = pasteInto(table, text, at, column)
    setTable(() => result.table)
    setNotice(result.notice)
  }
  const onKeyDown = (at: number, column: 0 | 1) => (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusCell(Math.min(at + 1, MAX_TABLE_ROWS - 1), column)
    } else if (event.key === 'ArrowUp' && at > 0) {
      event.preventDefault()
      focusCell(at - 1, column)
    } else if (event.key === 'Backspace' && at < table.cells.length && !table.cells[at][0] && !table.cells[at][1]) {
      event.preventDefault()
      setTable((current) => ({ ...current, cells: trimCells(current.cells.filter((_, index) => index !== at)) }))
      focusCell(Math.max(0, at - 1), column)
    }
  }
  const head = (column: 0 | 1): ReactElement => (
    <input
      className="grapher-cell grapher-cell-head"
      value={table.head[column]}
      placeholder={column === 0 ? 'x' : 'y'}
      spellCheck={false}
      autoComplete="off"
      aria-label={uiText('table.head', { name: column === 0 ? 'x' : 'y' })}
      onChange={(event) => {
        const value = event.target.value
        setTable((current) => ({ ...current, head: column === 0 ? [value, current.head[1]] : [current.head[0], value] }))
      }}
    />
  )
  const first = Math.max(0, Math.floor(scrolled / CELL_HEIGHT) - CELL_WINDOW / 4)
  const last = Math.min(shown.length, first + CELL_WINDOW)
  const spacer = (rows: number): ReactElement | null => (rows > 0 ? <div className="grapher-table-spacer" style={{ height: rows * CELL_HEIGHT }} aria-hidden /> : null)
  const points = analysis?.kind === 'table' ? analysis.count ?? 0 : 0
  const missing = analysis?.kind === 'table' ? analysis.missing ?? [] : []
  return (
    <>
      <div ref={gridRef} className="grapher-table" role="group" aria-label={uiText('table.label', { index: rowIndex + 1 })} onScroll={(event) => setScrolled(event.currentTarget.scrollTop)}>
        {head(0)}
        {head(1)}
        {spacer(first)}
        {shown.slice(first, last).map(([x, y], offset) => ([x, y] as const).map((value, column) => {
          const at = first + offset
          return (
          <input
            key={`${at}:${column}`}
            data-cell={`${at}:${column}`}
            className="grapher-cell"
            value={value}
            spellCheck={false}
            autoComplete="off"
            inputMode="decimal"
            aria-label={uiText('table.cell', { name: table.head[column] || (column === 0 ? 'x' : 'y'), index: at + 1 })}
            aria-invalid={bad.has(2 * at + column) || undefined}
            onChange={(event) => setCell(at, column as 0 | 1, event.target.value)}
            onPaste={onPaste(at, column as 0 | 1)}
            onKeyDown={onKeyDown(at, column as 0 | 1)}
          />
          )
        }))}
        {spacer(shown.length - last)}
      </div>
      <div className="grapher-options">
        <OptionToggle label={uiText('table.connect')} checked={row.connect === true} onChange={(checked) => edit((current) => ({ ...current, connect: checked }))} />
        <span className="grapher-value">{uiText('table.points', { count: points })}</span>
      </div>
      {bad.size ? (
        <div className="grapher-error" role="status">
          <span>{uiText('table.bad', { count: bad.size })}</span>
          {missing.length ? (
            <span className="grapher-chips">
              {missing.map((name) => (
                <button key={name} type="button" className="grapher-chip" onClick={() => addSlider(name)}>
                  <Slider />
                  {uiText('row.addSlider', { name })}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      {notice ? <div className="grapher-notice" role="status">{notice}</div> : null}
    </>
  )
}

const ExpressionRow = (props: RowProps): ReactElement => {
  const { mode, row, index, trailing, analysis, edit } = props
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [editing, setEditing] = React.useState(false)
  React.useEffect(() => {
    if (pendingFocus !== row.id) return
    pendingFocus = null
    const input = inputRef.current
    const selection = pendingSelection?.id === row.id ? pendingSelection : null
    pendingSelection = null
    input?.focus()
    input?.setSelectionRange(selection?.start ?? input.value.length, selection?.end ?? input.value.length)
  })
  const drawn = analysis ? DRAWN.has(analysis.kind) : false
  const typeset = !editing && row.text.trim() !== ''
  const error = analysis?.kind === 'error' && analysis.error ? uiText(analysis.error.key, { name: analysis.error.param }) : null
  const color = paletteCssValue(row.color)
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    const items: UiMenuItem[] = [
      { id: 'visibility', label: uiText(row.hidden ? 'row.show' : 'row.hide'), icon: row.hidden ? <Eye /> : <EyeOff />, onSelect: () => edit((current) => ({ ...current, hidden: !current.hidden })) },
      { type: 'separator' },
      ...COLORS.map((id): UiMenuItem => ({
        id: `color:${id}`,
        type: 'radio',
        checked: row.color === paletteRef(id),
        label: uiText(`color.${id}`),
        icon: <span className="grapher-menu-swatch" style={{ background: paletteCssValue(paletteRef(id)) }} />,
        onSelect: () => edit((current) => ({ ...current, color: paletteRef(id) }))
      })),
      ...(trailing ? [] : [
        { type: 'separator' } as UiMenuItem,
        props.inFolder
          ? { id: 'leave-folder', label: uiText('row.leaveFolder'), icon: <FolderIcon />, onSelect: props.leaveFolder }
          : { id: 'new-folder', label: uiText('row.newFolder'), icon: <FolderPlus />, onSelect: props.intoNewFolder },
        { type: 'separator' } as UiMenuItem,
        { id: 'delete', label: uiText('row.delete'), icon: <Trash />, danger: true, onSelect: () => props.remove('next') }
      ])
    ]
    void api.ui.openMenu(items, { x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const move = (delta: number): void => {
      if (focusNeighbour(event.currentTarget, delta)) event.preventDefault()
    }
    const typed = event.currentTarget.value.trim().toLowerCase()
    if (event.key === 'Enter' && takesTables(mode) && typed === 'table') {
      event.preventDefault()
      pendingFocus = row.id
      edit((current) => ({ ...current, text: '', table: createTable() }))
    } else if (event.key === 'Enter' && typed === 'folder' && !props.inFolder) {
      event.preventDefault()
      addFolder()
    } else if (event.key === 'Enter' && !trailing) {
      event.preventDefault()
      props.insertAfter()
    } else if (event.key === 'Backspace' && !event.currentTarget.value && !trailing) {
      event.preventDefault()
      props.remove(index > 0 ? 'previous' : 'next')
    } else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'ArrowDown') move(1)
  }
  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const input = event.currentTarget
    const text = event.clipboardData.getData('text/plain')
    const whole = input.selectionStart === 0 && input.selectionEnd === input.value.length
    if (!takesTables(mode) || !(whole || !input.value) || !looksTabular(text)) return
    event.preventDefault()
    const { table, notice } = pastedTable(text)
    if (notice) pendingNotice.set(row.id, notice)
    edit((current) => ({ ...current, text: '', table }))
  }
  const addTable = (): void => {
    pendingFocus = row.id
    edit((current) => ({ ...current, text: '', table: createTable() }))
  }
  const addFolder = (): void => {
    pendingFocus = row.id
    edit((current) => ({ ...current, text: '', folder: { collapsed: false } }))
  }
  return (
    <div className="grapher-row" role="listitem" data-row-index={index} data-row-id={row.id} data-kind={analysis?.kind ?? 'empty'} data-hidden={row.hidden || props.folderHidden || undefined} data-in-folder={props.inFolder || undefined} data-trailing={trailing || undefined} data-dragging={props.dragging || undefined}>
      <div className="grapher-gutter">
        {trailing ? <span className="grapher-handle"><span className="grapher-index">{index + 1}</span></span> : (
          <button
            type="button"
            className="grapher-handle"
            tabIndex={-1}
            aria-label={uiText('row.drag')}
            title={uiText('row.drag')}
            onPointerDown={props.startDrag}
          >
            <span className="grapher-index">{index + 1}</span>
            <Grip className="grapher-grip-icon" />
          </button>
        )}
        <span className="grapher-mark">
        {error ? (
          <span className="grapher-warning" role="img" aria-label={error} {...api.ui.tooltip(error)}><Warning /></span>
        ) : drawn ? (
          <button
            type="button"
            className={analysis?.kind === 'csurface' ? 'grapher-swatch grapher-swatch-hue' : 'grapher-swatch'}
            style={{ ['--swatch' as string]: color }}
            aria-pressed={!row.hidden}
            aria-label={uiText(row.hidden ? 'row.show' : 'row.hide')}
            title={uiText('row.swatch')}
            onClick={() => edit((current) => ({ ...current, hidden: !current.hidden }))}
            onContextMenu={openMenu}
          />
        ) : null}
        </span>
      </div>
      <div className="grapher-row-main">
        {row.table ? <TableGrid row={row} index={index} analysis={analysis} edit={edit} addSlider={props.addSlider} /> : (<>
        <div className="grapher-field" data-typeset={typeset || undefined}>
        {typeset ? <div className="grapher-typeset"><MathText text={row.text} otherwise={uiText('math.otherwise')} /></div> : null}
        <input
          ref={inputRef}
          data-row-input=""
          className="grapher-input"
          value={row.text}
          placeholder={trailing ? viewOf(mode).placeholder : ''}
          spellCheck={false}
          autoComplete="off"
          aria-label={uiText('row.input', { index: index + 1 })}
          aria-invalid={analysis?.kind === 'error' || undefined}
          onChange={(event) => {
            const text = event.target.value
            edit((current) => ({ ...current, text }))
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onContextMenu={trailing ? undefined : openMenu}
        />
        </div>
        <Details {...props} />
        </>)}
      </div>
      {trailing ? (
        <span className="grapher-trailing-actions">
          <button type="button" className="grapher-delete grapher-add-table" aria-label={uiText('folder.add')} {...api.ui.tooltip(uiText('folder.add'))} onClick={addFolder}>
            <FolderPlus />
          </button>
          {takesTables(mode) ? (
            <button type="button" className="grapher-delete grapher-add-table" aria-label={uiText('table.add')} {...api.ui.tooltip(uiText('table.add'))} onClick={addTable}>
              <TableIcon />
            </button>
          ) : null}
        </span>
      ) : (
        <button type="button" className="grapher-delete" aria-label={uiText('row.delete')} title={uiText('row.delete')} onClick={() => props.remove('next')}>
          <X />
        </button>
      )}
    </div>
  )
}

interface FolderProps {
  row: Row
  index: number
  /** How many rows the folder holds. */
  count: number
  edit: (change: (row: Row) => Row) => void
  /** Adds an empty first row inside the folder (opening it) and focuses it. */
  insertInside: () => void
  remove: (withRows: boolean) => void
  dragging: boolean
  startDrag: (event: PointerEvent<HTMLButtonElement>) => void
}

/**
 * A folder row: grip, a chevron that opens or closes it, its name and an eye that hides or shows every row in it.
 * Folders hold expressions only, one level deep: a folder is never dropped into another one.
 */
const FolderRow = ({ row, index, count, edit, insertInside, remove, dragging, startDrag }: FolderProps): ReactElement => {
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (pendingFocus !== row.id) return
    pendingFocus = null
    inputRef.current?.focus()
  })
  const collapsed = row.folder?.collapsed === true
  const toggle = (): void => edit((current) => ({ ...current, folder: { collapsed: !current.folder?.collapsed } }))
  const toggleHidden = (): void => edit((current) => ({ ...current, hidden: !current.hidden }))
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    const items: UiMenuItem[] = [
      { id: 'visibility', label: uiText(row.hidden ? 'folder.show' : 'folder.hide'), icon: row.hidden ? <Eye /> : <EyeOff />, onSelect: toggleHidden },
      { type: 'separator' },
      { id: 'ungroup', label: uiText('folder.delete'), icon: <FolderIcon />, onSelect: () => remove(false) },
      { id: 'delete', label: uiText('folder.deleteAll'), icon: <Trash />, danger: true, onSelect: () => remove(true) }
    ]
    void api.ui.openMenu(items, { x: event.clientX, y: event.clientY })
  }
  return (
    <div className="grapher-row grapher-folder" role="listitem" data-row-index={index} data-row-id={row.id} data-kind="folder" data-hidden={row.hidden || undefined} data-dragging={dragging || undefined} onContextMenu={openMenu}>
      <div className="grapher-gutter">
        <button type="button" className="grapher-handle" tabIndex={-1} aria-label={uiText('row.drag')} title={uiText('row.drag')} onPointerDown={startDrag}>
          <span className="grapher-index">{index + 1}</span>
          <Grip className="grapher-grip-icon" />
        </button>
        <span className="grapher-mark">
          <button type="button" className="grapher-folder-toggle" aria-expanded={!collapsed} aria-label={uiText(collapsed ? 'folder.expand' : 'folder.collapse')} title={uiText(collapsed ? 'folder.expand' : 'folder.collapse')} onClick={toggle}>
            <ChevronDown />
          </button>
        </span>
      </div>
      <div className="grapher-folder-main">
        <FolderIcon className="grapher-folder-icon" />
        <input
          ref={inputRef}
          data-folder-input=""
          className="grapher-input grapher-folder-name"
          value={row.text}
          placeholder={uiText('folder.name')}
          spellCheck={false}
          autoComplete="off"
          aria-label={uiText('folder.input', { index: index + 1 })}
          onChange={(event) => {
            const text = event.target.value
            edit((current) => ({ ...current, text }))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              insertInside()
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              if (focusNeighbour(event.currentTarget, event.key === 'ArrowUp' ? -1 : 1)) event.preventDefault()
            }
          }}
        />
        {collapsed && count ? <span className="grapher-folder-count">{count}</span> : null}
        <button type="button" className="grapher-folder-eye" aria-pressed={!row.hidden} aria-label={uiText(row.hidden ? 'folder.show' : 'folder.hide')} title={uiText(row.hidden ? 'folder.show' : 'folder.hide')} onClick={toggleHidden}>
          {row.hidden ? <EyeOff /> : <Eye />}
        </button>
      </div>
      <button type="button" className="grapher-delete" aria-label={uiText('folder.delete')} title={uiText('folder.delete')} onClick={() => remove(false)}>
        <X />
      </button>
    </div>
  )
}

/** Where a dragged row lands: the gap before row `gap`, in `folder` or on the top level, and the marker's y. */
interface DropGap {
  gap: number
  folder?: string
  marker: number
}

/** Left sidebar: the focused graph's view button, axis labels and open button in the 38px header, then its expressions. */
export const Sidebar = (): ReactElement => {
  const store = getStore()
  const { loaded, document, active, tab, engine, problems } = useGrapher()
  const graph = graphOf(document, active)
  const mode = graph.mode
  const rows = graph.sheets[mode]
  const units = unitsOf(graph, mode)
  const [choosing, setChoosing] = React.useState(false)
  const [profiling, setProfiling] = React.useState(false)
  React.useEffect(() => setChoosing(false), [active])
  React.useEffect(() => setProfiling(false), [tab])
  const analyses = React.useMemo(() => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const editRow = (id: string) => (change: (row: Row) => Row): void => {
    store.updateRows(active, mode, (current) => current.map((row) => (row.id === id ? change(row) : row)))
  }
  // A row added after a folder row opens the folder and becomes its first row; one added after a folder's row joins it.
  const insertAfter = (index: number) => (): void => {
    store.updateRows(active, mode, (current) => {
      const at = current[index]
      const row = createRow(current)
      pendingFocus = row.id
      if (at?.folder) return [...current.slice(0, index), { ...at, folder: { collapsed: false } }, { ...row, parent: at.id }, ...current.slice(index + 1)]
      return [...current.slice(0, index + 1), at?.parent !== undefined ? { ...row, parent: at.parent } : row, ...current.slice(index + 1)]
    })
  }
  const remove = (index: number) => (focus: 'previous' | 'next'): void => {
    store.updateRows(active, mode, (current) => {
      const target = focus === 'previous' ? current[index - 1] : current[index + 1]
      pendingFocus = target?.id ?? null
      return current.filter((_, at) => at !== index)
    })
  }
  const listRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ pointer: number; from: number; gap: DropGap | null } | null>(null)
  const [drag, setDrag] = React.useState<{ from: number; gap: DropGap | null } | null>(null)
  /**
   * The gap nearest the pointer among the rendered typed rows, and whether a dropped row lands in a folder there: between
   * a folder's rows always; right under an open folder's last row (or an empty open folder) when the pointer is right
   * of the gutter. A folder only lands on the top level, so a gap inside another folder takes none.
   */
  const gapAt = (clientX: number, clientY: number, from: number): DropGap | null => {
    const list = listRef.current
    const moving = rows[from]
    if (!list || !moving) return null
    const elements = Array.from(list.querySelectorAll<HTMLElement>('[data-row-index]')).filter((element) => Number(element.dataset.rowIndex) < rows.length - 1)
    if (!elements.length) return null
    let after = -1
    elements.forEach((element, at) => {
      const rect = element.getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) after = at
    })
    if (after < 0) return { gap: Number(elements[0].dataset.rowIndex), marker: elements[0].offsetTop }
    const element = elements[after]
    const marker = element.offsetTop + element.offsetHeight
    const index = Number(element.dataset.rowIndex)
    const above = rows[index]
    const owner = above.folder ? (above.folder.collapsed ? undefined : above.id) : above.parent
    if (owner === undefined) return { gap: above.folder ? blockEnd(rows, index) : index + 1, marker }
    const inside = rows[index + 1]?.parent === owner
    if (inside) return moving.folder ? null : { gap: index + 1, folder: owner, marker }
    const right = clientX > list.getBoundingClientRect().left + 46
    return { gap: index + 1, ...(right && !moving.folder ? { folder: owner } : {}), marker }
  }
  const startDrag = (index: number) => (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointer: event.pointerId, from: index, gap: null }
    setDrag({ from: index, gap: null })
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    const list = listRef.current
    if (!current || current.pointer !== event.pointerId || !list) return
    const bounds = list.getBoundingClientRect()
    if (event.clientY < bounds.top + 24) list.scrollTop -= 8
    else if (event.clientY > bounds.bottom - 24) list.scrollTop += 8
    current.gap = gapAt(event.clientX, event.clientY, current.from)
    setDrag({ from: current.from, gap: current.gap })
  }
  const endDrag = (commit: boolean) => (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current || current.pointer !== event.pointerId) return
    dragRef.current = null
    setDrag(null)
    const gap = current.gap
    if (commit && gap) store.updateRows(active, mode, (all) => moveIntoGap(all, current.from, Math.min(gap.gap, all.length - 1), gap.folder))
  }
  const moves = (from: number, gap: DropGap): boolean => {
    const moving = rows[from]
    return !(gap.gap >= from && gap.gap <= blockEnd(rows, from) && (moving.folder || moving.parent === gap.folder))
  }
  const marker = drag?.gap && moves(drag.from, drag.gap) ? drag.gap : null
  const folders = new Map(rows.filter((row) => row.folder).map((row) => [row.id, row]))
  const removeFolderAt = (index: number) => (withRows: boolean): void => store.updateRows(active, mode, (current) => removeFolder(current, index, withRows))
  const leaveFolderAt = (index: number) => (): void => store.updateRows(active, mode, (current) => leaveFolder(current, index))
  const intoNewFolderAt = (index: number) => (): void => store.updateRows(active, mode, (current) => {
    const result = intoNewFolder(current, index)
    pendingFocus = result.folder.id
    return result.rows
  })
  const addSlider = (name: string): void => {
    store.updateRows(active, mode, (current) => {
      const kept = current.filter(filled)
      return [...kept, { ...createRow(kept), text: `${name} = 1` }]
    })
  }
  return (
    <div className="grapher-panel">
      <div className="panel-header grapher-header">
        <ViewButton mode={mode} open={choosing} toggle={() => { setProfiling(false); setChoosing((open) => !open) }} />
        {!choosing ? <UnitsSwitch graph={active} mode={mode} units={units} /> : null}
        <button
          type="button"
          className="plugin-open-page"
          onClick={(event) => {
            if (api.ui.hasModKey(event)) openNewGraph(mode)
            else api.workspace.openMainTab({ instanceId: tab === MAIN_GRAPH ? store.tabFor(active) : tab, title: store.profileName(active) })
          }}
          aria-label={uiText('graph.open')}
          title={uiText('graph.open')}
        />
      </div>
      {loaded ? <ProfileBar tab={tab} profile={active} open={profiling} toggle={() => { setChoosing(false); setProfiling((open) => !open) }} /> : null}
      {loaded && !choosing && !profiling ? <InsertBar graph={active} mode={mode} /> : null}
      {problems.filter((problem) => problem.key !== 'problem.engine').map((problem) => (
        <p key={problem.key} role="alert" className="grapher-alert">{uiText(problem.key, { message: problem.message })}</p>
      ))}
      {loaded && profiling ? (
        <ProfileList tab={tab} profile={active} close={() => setProfiling(false)} />
      ) : loaded && choosing ? (
        <ViewList graph={active} mode={mode} close={() => setChoosing(false)} />
      ) : loaded ? (
        <div
          ref={listRef}
          className="grapher-list"
          role="list"
          aria-label={uiText('list.label', { mode: uiText(`mode.${mode}`) })}
          data-dragging={drag ? '' : undefined}
          onPointerMove={moveDrag}
          onPointerUp={endDrag(true)}
          onPointerCancel={endDrag(false)}
        >
          {rows.map((row, index) => {
            const folder = row.parent !== undefined ? folders.get(row.parent) : undefined
            if (folder?.folder?.collapsed) return null
            const dragging = drag !== null && (drag.from === index || (rows[drag.from]?.folder !== undefined && row.parent === rows[drag.from].id))
            if (row.folder) {
              return (
                <FolderRow
                  key={row.id}
                  row={row}
                  index={index}
                  count={blockEnd(rows, index) - index - 1}
                  edit={editRow(row.id)}
                  insertInside={insertAfter(index)}
                  remove={removeFolderAt(index)}
                  dragging={dragging}
                  startDrag={startDrag(index)}
                />
              )
            }
            return (
              <ExpressionRow
                key={row.id}
                mode={mode}
                row={row}
                index={index}
                trailing={index === rows.length - 1 && !filled(row)}
                analysis={analyses[index]}
                edit={editRow(row.id)}
                insertAfter={insertAfter(index)}
                remove={remove(index)}
                addSlider={addSlider}
                dragging={dragging}
                startDrag={startDrag(index)}
                inFolder={folder !== undefined}
                folderHidden={folder?.hidden === true}
                leaveFolder={leaveFolderAt(index)}
                intoNewFolder={intoNewFolderAt(index)}
              />
            )
          })}
          {marker ? <div className="grapher-drop-marker" data-in-folder={marker.folder !== undefined || undefined} style={{ top: marker.marker }} aria-hidden /> : null}
          <p className="grapher-hint">
            {uiText('hint.short')}{' '}
            <button type="button" className="grapher-hint-link" onClick={() => api.workspace.showProperties(tab === MAIN_GRAPH ? store.tabFor(active) : tab, { segmentId: REFERENCE_SEGMENT })}>{uiText('hint.open')}</button>
          </p>
        </div>
      ) : (
        <api.ui.ContentLoader compact />
      )}
    </div>
  )
}
