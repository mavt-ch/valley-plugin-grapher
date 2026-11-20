import { paletteRef } from '@valley/plugin-sdk/palette'
import { bookmarkId } from './bookmarks'
import { colorOrder, createRow, type Bookmark, type BookmarkGroup, type Bookmarks, type Mode, type Row } from './model'

/** One example: its text, view and the row fields it needs (ranges, floor curves, flowing arrows). */
type Example = [mode: Mode, text: string, fields?: Partial<Pick<Row, 'from' | 'to' | 'from2' | 'to2' | 'floor' | 'flow'>>]
/** A group of examples (`key` names it in the locale catalogue), with subgroups one level deep. */
interface ExampleGroup {
  key: string
  items: Example[]
  subgroups?: { key: string; items: Example[] }[]
}

/** Self-contained expressions (no sliders or functions defined elsewhere), so each one draws on its own in any graph. */
const EXAMPLES: ExampleGroup[] = [
  {
    key: 'functions',
    items: [['cartesian', 'y = sin(x)'], ['cartesian', 'y = x^2 - 2'], ['cartesian', '{x < 0: -x, x ≥ 0: x^2}'], ['cartesian', 'x^2 + y^2 ≤ 4']],
    subgroups: [
      { key: 'calculus', items: [['cartesian', 'int(sin(x), 0, π)'], ['cartesian', 'tangent(x^2 / 2, 1)'], ['cartesian', 'sum(n, 0, 6, x^n / n!)']] },
      { key: 'fields', items: [['cartesian', 'F(x, y) = (-y, x)', { flow: true }], ['cartesian', 'f(x, y) = x^2 - y^2']] }
    ]
  },
  {
    key: 'curves',
    items: [['polar', 'r = 1 + cos(θ)'], ['polar', 'r = 2 sin(3θ)'], ['parametric', '(cos(3t), sin(2t))'], ['parametric', '(0.2t cos t, 0.2t sin t)', { from: '0', to: '6π' }]]
  },
  {
    key: 'space',
    items: [
      ['space', 'z = (x^2 + y^2) / 5 - 6', { floor: true }],
      ['space', 'x^2 + y^2 + z^2 = 4'],
      ['space', '((2 + cos v) cos u, (2 + cos v) sin u, sin v)'],
      ['space', '(6cos t, 6sin t, t / 2)', { from: '0', to: '6π' }],
      ['space', 'F(x, y, z) = (-y, x, z / 4)', { flow: true }]
    ],
    subgroups: [
      { key: 'integrals', items: [['space', 'int(3 + sin(x) cos(y), -5, 5, -5, 5)'], ['space', 'int(1, 0, 6, 0, 6 - x, 0, 6 - x - y)'], ['space', 'int(1, -5, 5, -sqrt(25 - x^2), sqrt(25 - x^2), -sqrt(25 - x^2 - y^2), sqrt(25 - x^2 - y^2))']] },
      { key: 'coordinates', items: [['cylindrical', 'r = 1 + cos(φ)', { from2: '-4', to2: '0' }], ['cylindrical', 'int(1, 0, 3, 0, 2π, r, 3)'], ['spherical', 'ρ = 2', { from2: '0', to2: 'π/4' }]] }
    ]
  },
  {
    key: 'complex',
    items: [['complex', 'w = 2e^(iπ/3)'], ['complex', '|z + 2| < 3'], ['complexSpace', 'w = (z^2 - 4) / 4']]
  }
]

/** Every example as plain data, for the tests: view, text and the group path of locale keys. */
export const EXAMPLE_ENTRIES: { mode: Mode; text: string; path: string[] }[] = EXAMPLES.flatMap((group) => [
  ...group.items.map(([mode, text]) => ({ mode, text, path: [group.key] })),
  ...(group.subgroups ?? []).flatMap((sub) => sub.items.map(([mode, text]) => ({ mode, text, path: [group.key, sub.key] })))
])

/** The bookmarks a file without any gets once: the examples in their groups, named in the user's language (`name(key)`). */
export function exampleBookmarks(name: (key: string) => string): Bookmarks {
  const groups: BookmarkGroup[] = []
  const items: Bookmark[] = []
  const add = (examples: Example[], group: string): void => examples.forEach(([mode, text, fields = {}], index) => {
    const { flow, ...range } = fields
    const row: Row = { ...createRow([], text, range), color: paletteRef(colorOrder()[index % colorOrder().length]), ...(flow ? { flow: true } : {}) }
    items.push({ id: bookmarkId('b'), mode, row, group })
  })
  for (const entry of EXAMPLES) {
    const id = bookmarkId('group')
    groups.push({ id, name: name(entry.key) })
    for (const sub of entry.subgroups ?? []) {
      const subId = bookmarkId('group')
      groups.push({ id: subId, name: name(sub.key), parent: id, collapsed: true })
      add(sub.items, subId)
    }
    add(entry.items, id)
  }
  return { groups, items }
}
