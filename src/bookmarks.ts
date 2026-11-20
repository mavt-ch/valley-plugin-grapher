import type { RowAnalysis } from './engine'
import { BOOKMARK_GROUP_NAME_MAX, MAX_BOOKMARK_NEEDS, filled, rowId, type Bookmark, type BookmarkGroup, type Bookmarks, type Mode, type Row } from './model'

/** Where a dragged bookmark or group lands: on a row's upper or lower half, inside a group, or at the end of the top level. */
export type BookmarkDrop =
  | { kind: 'bookmark' | 'group'; id: string; position: 'before' | 'after' | 'inside' }
  | { kind: 'root' }

export const NO_BOOKMARKS: Bookmarks = { groups: [], items: [] }

export function bookmarkId(prefix: 'b' | 'group'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `${prefix}-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function withParent(group: BookmarkGroup, parent: string | undefined): BookmarkGroup {
  const copy: BookmarkGroup = { ...group }
  if (parent) copy.parent = parent
  else delete copy.parent
  return copy
}

export function subgroups(groups: readonly BookmarkGroup[], id: string): BookmarkGroup[] {
  return groups.filter((group) => group.parent === id)
}

/** The bookmarks filed in `group` (the top level for undefined), in list order. */
export function bookmarksIn(items: readonly Bookmark[], group: string | undefined): Bookmark[] {
  return items.filter((item) => item.group === group)
}

/** Bookmarks in a group and its subgroups. */
export function groupCount(bookmarks: Bookmarks, id: string): number {
  const ids = new Set([id, ...subgroups(bookmarks.groups, id).map((group) => group.id)])
  return bookmarks.items.filter((item) => item.group !== undefined && ids.has(item.group)).length
}

/** A row's expression without what only the sheet cares about (its id, colour and eye): two bookmarks of it are the same. */
const content = (row: Row): string => {
  const { id: _id, color: _color, hidden: _hidden, ...rest } = row
  const sorted = (value: unknown): unknown => (value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, entry]) => [key, sorted(entry)]))
    : Array.isArray(value) ? value.map(sorted) : value)
  return JSON.stringify(sorted(rest))
}

export function sameExpression(a: Row, b: Row): boolean {
  return a.text === b.text && content(a) === content(b)
}

/** The groups (`''` for the top level) that already hold this expression of this view. */
export function filedIn(bookmarks: Bookmarks, mode: Mode, row: Row): Set<string> {
  return new Set(bookmarks.items.filter((item) => item.mode === mode && sameExpression(item.row, row)).map((item) => item.group ?? ''))
}

/** Adds a group; a subgroup goes after its group's last subgroup, and only under a top-level group. */
export function addGroup(groups: readonly BookmarkGroup[], group: BookmarkGroup): BookmarkGroup[] {
  const parent = group.parent ? groups.find((entry) => entry.id === group.parent) : undefined
  if (group.parent && (!parent || parent.parent)) return [...groups]
  const next = withParent({ ...group, name: group.name.slice(0, BOOKMARK_GROUP_NAME_MAX) }, parent?.id)
  if (!parent) return [...groups, next]
  const family = groups.reduce((last, entry, index) => (entry.id === parent.id || entry.parent === parent.id ? index : last), -1)
  return [...groups.slice(0, family + 1), next, ...groups.slice(family + 1)]
}

const sameGroups = (a: readonly BookmarkGroup[], b: readonly BookmarkGroup[]): boolean =>
  a.length === b.length && a.every((group, index) => group.id === b[index].id && group.parent === b[index].parent)

/**
 * Moves a group. `inside` makes it a subgroup of a top-level group, refused when that would make a third level (it has
 * subgroups of its own, or the target is a subgroup); `before`/`after` place it beside the target at the target's level.
 * Returns null for a drop that is not allowed or changes nothing.
 */
export function moveGroup(groups: readonly BookmarkGroup[], dragId: string, drop: BookmarkDrop): BookmarkGroup[] | null {
  const dragged = groups.find((group) => group.id === dragId)
  if (!dragged) return null
  const hasChildren = groups.some((group) => group.parent === dragId)
  const rest = groups.filter((group) => group.id !== dragId)
  if (drop.kind === 'root') {
    const next = [...rest, withParent(dragged, undefined)]
    return sameGroups(groups, next) ? null : next
  }
  if (drop.kind !== 'group' || drop.id === dragId) return null
  const target = rest.find((group) => group.id === drop.id)
  if (!target) return null
  if (drop.position === 'inside') {
    if (target.parent || hasChildren) return null
    const family = rest.reduce((last, group, index) => (group.id === target.id || group.parent === target.id ? index : last), -1)
    const next = [...rest.slice(0, family + 1), withParent(dragged, target.id), ...rest.slice(family + 1)]
    return sameGroups(groups, next) ? null : next
  }
  if (target.parent && hasChildren) return null
  let index = rest.indexOf(target)
  // After a top-level group means after its subgroups too, so they stay together.
  if (drop.position === 'after') index = target.parent ? index + 1 : rest.reduce((last, group, at) => (group.id === target.id || group.parent === target.id ? at : last), index) + 1
  const next = [...rest.slice(0, index), withParent(dragged, target.parent), ...rest.slice(index)]
  return sameGroups(groups, next) ? null : next
}

/**
 * Moves a bookmark: `inside` a group (at its end), before or after another bookmark (taking that bookmark's group), or to
 * the end of the top level. Returns null for a drop that is not allowed or changes nothing.
 */
export function moveBookmark(items: readonly Bookmark[], groups: readonly BookmarkGroup[], dragId: string, drop: BookmarkDrop): Bookmark[] | null {
  const dragged = items.find((item) => item.id === dragId)
  if (!dragged) return null
  const rest = items.filter((item) => item.id !== dragId)
  let group: string | undefined
  let index: number
  if (drop.kind === 'root') {
    index = rest.length
  } else if (drop.kind === 'group') {
    if (!groups.some((entry) => entry.id === drop.id)) return null
    group = drop.id
    const last = rest.reduce((at, item, position) => (item.group === group ? position : at), -1)
    index = last === -1 ? rest.length : last + 1
  } else {
    if (drop.id === dragId) return null
    const target = rest.find((item) => item.id === drop.id)
    if (!target) return null
    group = target.group
    index = rest.indexOf(target) + (drop.position === 'after' ? 1 : 0)
  }
  const moved: Bookmark = { ...dragged }
  if (group) moved.group = group
  else delete moved.group
  const next = [...rest.slice(0, index), moved, ...rest.slice(index)]
  return next.every((item, position) => item.id === items[position].id && item.group === items[position].group) ? null : next
}

/** Removes a group: its bookmarks move to its group (or the top level) and its subgroups become top-level groups in its place. */
export function deleteGroup(bookmarks: Bookmarks, id: string): Bookmarks {
  const group = bookmarks.groups.find((entry) => entry.id === id)
  if (!group) return bookmarks
  return {
    groups: bookmarks.groups.filter((entry) => entry.id !== id).map((entry) => (entry.parent === id ? withParent(entry, undefined) : entry)),
    items: bookmarks.items.map((item) => {
      if (item.group !== id) return item
      const moved: Bookmark = { ...item }
      if (group.parent) moved.group = group.parent
      else delete moved.group
      return moved
    })
  }
}

/** The bookmarks of a group and of its subgroups, in list order. */
export function folderItems(bookmarks: Bookmarks, id: string): Bookmark[] {
  const ids = new Set([id, ...subgroups(bookmarks.groups, id).map((group) => group.id)])
  return bookmarks.items.filter((item) => item.group !== undefined && ids.has(item.group))
}

/** The view every bookmark of a folder (subfolders included) belongs to, or null when the folder is empty or mixes views:
 * only a one-view folder shows all of its bookmarks at once. */
export function folderMode(bookmarks: Bookmarks, id: string): Mode | null {
  const modes = new Set(folderItems(bookmarks, id).map((item) => item.mode))
  return modes.size === 1 ? [...modes][0] : null
}

/** The engine's analysis of rows on one view (`null` before the engine has loaded). */
export type Analyze = (rows: readonly Row[]) => RowAnalysis[]

/** `name = …` or `name(args) = …` at the start of a row; reserved coordinate names define nothing. */
const DEFINITION = /^\s*([\p{L}][\p{L}\p{N}_]*)\s*(?:\([^()=]*\))?\s*=(?!=)/u
const COORDINATES = new Set(['x', 'y', 'z', 'r', 'θ', 't', 'ρ', 'φ', 'w'])

/** The name a row's text defines, read from the text alone (for display, and for a definition that does not evaluate). */
export function definedByText(row: Row): string | null {
  const name = row.table ? undefined : DEFINITION.exec(row.text)?.[1]
  return name && !COORDINATES.has(name) ? name : null
}

/** The name a definition row gives: a parameter (`m = 1`) or a function (`f(x) = …`). */
function definedName(row: Row, analysis: RowAnalysis | undefined): string | null {
  if (analysis && (analysis.kind === 'param' || analysis.kind === 'definition') && analysis.name) return analysis.name
  return analysis?.kind === 'error' ? definedByText(row) : null
}

/** Every name the rows define, mapped to the first row that defines it. */
function definitions(analyze: Analyze, rows: readonly Row[]): Map<string, Row> {
  const names = new Map<string, Row>()
  const analyses = analyze(rows)
  rows.forEach((row, index) => {
    if (!filled(row)) return
    const name = definedName(row, analyses[index])
    if (name && !names.has(name)) names.set(name, row)
  })
  return names
}

const missingNames = (analysis: RowAnalysis): string[] => [...(analysis.error?.missing ?? []), ...(analysis.missing ?? [])]

/**
 * The definitions an expression reads from its sheet, and the ones those read in turn: for `y = m·x + c` the sliders
 * `m = …` and `c = …`. They are saved with the bookmark (in sheet order) so it draws on its own wherever it is shown.
 */
export function needsOf(analyze: Analyze, rows: readonly Row[], row: Row): Row[] {
  const names = definitions(analyze, rows)
  const picked: Row[] = []
  for (let round = 0; round < MAX_BOOKMARK_NEEDS && picked.length < MAX_BOOKMARK_NEEDS; round++) {
    const missing = new Set(analyze([row, ...picked]).flatMap(missingNames))
    const found = [...missing].map((name) => names.get(name)).filter((need): need is Row => need !== undefined && need.id !== row.id && !picked.includes(need))
    if (!found.length) break
    picked.push(...found)
  }
  const order = new Map(rows.map((entry, index) => [entry.id, index]))
  return picked
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .slice(0, MAX_BOOKMARK_NEEDS)
    .map((need) => ({ ...need, hidden: false }))
}

const holds = (rows: readonly Row[], row: Row): boolean => rows.some((entry) => filled(entry) && sameExpression(entry, row))

/**
 * A sheet's rows with bookmarks added: each expression the sheet does not hold yet, then the definitions it needs. A
 * definition whose name the sheet already defines is not added again, so a slider of the graph keeps its value.
 */
export function withBookmarks(analyze: Analyze | null, rows: readonly Row[], items: readonly Bookmark[]): Row[] {
  const next = [...rows]
  while (next.length && !filled(next[next.length - 1])) next.pop()
  for (const item of items) {
    if (!holds(next, item.row)) next.push({ ...item.row, id: rowId(), hidden: false })
    for (const need of item.needs ?? []) {
      if (holds(next, need)) continue
      const name = analyze ? definedName(need, analyze([need])[0]) : definedByText(need)
      if (name && (analyze ? definitions(analyze, next).has(name) : next.some((entry) => definedByText(entry) === name))) continue
      next.push({ ...need, id: rowId(), hidden: false })
    }
  }
  return next
}

/**
 * A sheet's rows with bookmarks taken out: their expressions, and each saved definition that came with them unless it
 * was changed (a moved slider) or another row still reads it.
 */
export function withoutBookmarks(analyze: Analyze | null, rows: readonly Row[], items: readonly Bookmark[]): Row[] {
  let next = rows.filter((row) => !(filled(row) && items.some((item) => sameExpression(row, item.row))))
  if (!analyze) return next
  for (const need of items.flatMap((item) => item.needs ?? []).reverse()) {
    const at = next.findIndex((row) => filled(row) && sameExpression(row, need))
    if (at < 0) continue
    const name = definedName(need, analyze([need])[0])
    const candidate = next.filter((_, index) => index !== at)
    if (name === null || !analyze(candidate).some((analysis) => missingNames(analysis).includes(name))) next = candidate
  }
  return next
}

/** Whether a sheet holds the expression of every one of these bookmarks. */
export function sheetHolds(rows: readonly Row[], items: readonly Bookmark[]): boolean {
  return items.length > 0 && items.every((item) => holds(rows, item.row))
}
