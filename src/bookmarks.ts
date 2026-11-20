import { BOOKMARK_GROUP_NAME_MAX, type Bookmark, type BookmarkGroup, type Bookmarks, type Mode, type Row } from './model'

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
