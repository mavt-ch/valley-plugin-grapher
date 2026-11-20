import { React } from './runtime'
import type { ReactElement } from 'react'
import { ChevronDown, CollapseAll, ExpandAll, Search, X } from './icons'
import { uiText } from './localization'
import { MAIN_GRAPH, MODES, createRow, filled, graphOf, graphIdOf, type Mode } from './model'
import { insertTemplate, takesTables } from './Sidebar'
import { useGrapher } from './store'

/** One feature: its syntax, a sentence (`ref.<id>`) and examples that insert themselves. */
interface Entry { id: string; syntax: string; examples?: readonly string[] }
/** A group (`ref.group.<id>`) and the views it belongs to: those come first on that view. */
interface Group { id: string; views: readonly Mode[]; entries: readonly Entry[] }

const PLANE: readonly Mode[] = ['cartesian', 'polar', 'parametric']

export const REFERENCE: readonly Group[] = [
  { id: 'basics', views: ['cartesian'], entries: [
    { id: 'function', syntax: 'y = f(x)', examples: ['y = x^2 - 2'] },
    { id: 'inverse', syntax: 'x = g(y)', examples: ['x = y^2'] },
    { id: 'define', syntax: 'f(x) = …', examples: ['f(x) = x^3'] },
    { id: 'equation', syntax: '… = …', examples: ['x^2 + y^2 = 4'] },
    { id: 'inequality', syntax: '<  ≤  >  ≥', examples: ['y > x^2'] },
    { id: 'point', syntax: '(a, b)', examples: ['(1, 2)'] },
    { id: 'slider', syntax: 'a = 1', examples: ['a = 1'] }
  ] },
  { id: 'calculus', views: ['cartesian'], entries: [
    { id: 'derivative', syntax: "f'(x), f''(x)", examples: ["f'(x)", "f''(x)"] },
    { id: 'integral', syntax: 'int(f, a, b)', examples: ['int(sin(x), 0, π)'] },
    { id: 'tangent', syntax: 'tangent(f, a)', examples: ['tangent(x^2, 1)'] }
  ] },
  { id: 'sums', views: MODES, entries: [
    { id: 'sum', syntax: 'sum(n, a, b, …)', examples: ['sum(n, 0, 5, x^n / n!)'] },
    { id: 'prod', syntax: 'prod(k, a, b, …)', examples: ['prod(k, 1, 3, x - k)'] }
  ] },
  { id: 'piecewise', views: MODES, entries: [
    { id: 'piecewise', syntax: '{condition: value, …, otherwise}', examples: ['{x < 0: -x, x^2}'] }
  ] },
  { id: 'fields', views: ['cartesian', 'space'], entries: [
    { id: 'field', syntax: 'F(x, y) = (P, Q)', examples: ['F(x, y) = (-y, x)'] },
    { id: 'field3', syntax: 'F(x, y, z) = (P, Q, R)', examples: ['F(x, y, z) = (-y, x, 0)'] },
    { id: 'flow', syntax: 'F(x, y) = (P, Q)' }
  ] },
  { id: 'levels', views: ['cartesian', 'space'], entries: [
    { id: 'levels', syntax: 'f(x, y) = …', examples: ['g(x, y) = x^2 - y^2'] },
    { id: 'floor', syntax: 'z = f(x, y)' }
  ] },
  { id: 'tables', views: PLANE, entries: [
    { id: 'table', syntax: 'table', examples: ['table'] },
    { id: 'list', syntax: '[(a, b), (c, d)]', examples: ['[(1, 2), (3, 4)]'] }
  ] },
  { id: 'markers', views: ['cartesian'], entries: [{ id: 'markers', syntax: 'y = f(x)' }] },
  { id: 'space', views: ['space'], entries: [
    { id: 'surface', syntax: 'z = f(x, y)', examples: ['z = (x^2 + y^2) / 5 - 6'] },
    { id: 'implicit3', syntax: 'F(x, y, z) = 0', examples: ['x^2 + y^2 + z^2 = 4'] },
    { id: 'psurface', syntax: '(x(u, v), y(u, v), z(u, v))', examples: ['(u cos v, u sin v, v)'] },
    { id: 'curve3', syntax: '(x(t), y(t), z(t))', examples: ['(6cos t, 6sin t, t / 2)'] },
    { id: 'point3', syntax: '(a, b, c)', examples: ['(1, 2, 3)'] },
    { id: 'tplane', syntax: 'tangent(f, a, b)', examples: ['tangent((x^2 + y^2) / 5 - 6, 3, 2)'] },
    { id: 'volume', syntax: 'int(f, a, b, c, d)', examples: ['int(6 - (x^2 + y^2) / 4, -3, 3, -3, 3)'] },
    { id: 'volume3', syntax: 'int(f, a, b, c, d, e, g)', examples: ['int(1, -4, 4, -sqrt(16 - x^2), sqrt(16 - x^2), 0, 8 - (x^2 + y^2) / 2)'] }
  ] },
  { id: 'polar', views: ['polar'], entries: [{ id: 'polar', syntax: 'r = f(θ)', examples: ['r = 2cos(3θ)'] }] },
  { id: 'parametric', views: ['parametric'], entries: [{ id: 'curve', syntax: '(x(t), y(t))', examples: ['(cos t, sin(2t))'] }] },
  { id: 'cylindrical', views: ['cylindrical'], entries: [
    { id: 'cylindrical', syntax: 'r, φ, z', examples: ['z = r^2', 'r = 1 + cos(φ)'] },
    { id: 'volumeCylindrical', syntax: 'int(f, r₁, r₂, φ₁, φ₂, z₁, z₂)', examples: ['int(1, 0, 2, 0, 2π, r, 2)', 'int(4 - r^2, 0, 2, 0, 2π)'] }
  ] },
  { id: 'spherical', views: ['spherical'], entries: [
    { id: 'spherical', syntax: 'ρ, θ, φ', examples: ['ρ = 2', 'φ = π/4'] },
    { id: 'volumeSpherical', syntax: 'int(f, ρ₁, ρ₂, θ₁, θ₂, φ₁, φ₂)', examples: ['int(1, 0, 2, 0, 2π, 0, π)', 'int(1, 0, 2, 0, 2π, 0, π/4)'] }
  ] },
  { id: 'complex', views: ['complex'], entries: [
    { id: 'number', syntax: 'a + bi, r e^(iφ)', examples: ['1 + 2i', '2e^(iπ/3)'] },
    { id: 'region', syntax: '|z - a| < r', examples: ['|z + 2| < 3', 'Re(z) > 1'] }
  ] },
  { id: 'complexSpace', views: ['complexSpace'], entries: [
    { id: 'wOfZ', syntax: 'w = f(z)', examples: ['w = (z^2 - 1) / z'] },
    { id: 'parts', syntax: 'Re(…), Im(…), arg(…)', examples: ['Re(z^2) / 5'] }
  ] },
  { id: 'sliders', views: MODES, entries: [{ id: 'play', syntax: '▶  →  ←  ↔  ½×  2×' }] },
  { id: 'export', views: MODES, entries: [{ id: 'export', syntax: 'PNG, SVG' }] }
]

/** Groups of the focused view first (they start open), the others after them, closed. */
export function referenceOrder(mode: Mode): Group[] {
  return [...REFERENCE.filter((group) => group.views.includes(mode)), ...REFERENCE.filter((group) => !group.views.includes(mode))]
}

/** The entries of a group whose syntax, name or sentence contain every word of the query (case-insensitive). */
export function matching(group: Group, query: string): readonly Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return group.entries
  const heading = uiText(`ref.group.${group.id}`)
  return group.entries.filter((entry) => {
    const haystack = [entry.syntax, entry.id, heading, uiText(`ref.${entry.id}`), ...(entry.examples ?? [])].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** The Properties segment of a graph tab: Grapher's reference. */
export const REFERENCE_SEGMENT = 'grapher.reference'

/**
 * Grapher's tab in the right sidebar's Properties while a graph tab is focused: a search row, then every feature with its
 * syntax, a sentence and examples. Without a query the focused view's groups come first, all closed; a query lists the
 * matching entries of every group. An example the view's kernel accepts (with the sheet's own rows, so f′(x) needs an f)
 * inserts itself into the empty last row of that graph.
 */
export const Reference = ({ tab }: { tab?: string }): ReactElement => {
  const { loaded, document, active, engine } = useGrapher()
  const id = tab ? graphIdOf(document, tab) : active
  const graph = graphOf(document, id)
  const mode = graph.mode
  const rows = graph.sheets[mode]
  const [query, setQuery] = React.useState('')
  // Every group starts closed; the groups opened by hand (outside a search) stay open for this mount.
  const opened = React.useRef(new Set<string>())
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set())
  const valid = React.useMemo(() => {
    const kept = rows.filter(filled)
    const all = REFERENCE.flatMap((group) => group.entries.flatMap((entry) => entry.examples ?? []))
    const result = new Map<string, boolean>()
    for (const example of all) {
      if (example === 'table') { result.set(example, takesTables(mode)); continue }
      const kind = engine?.analyze(mode, [...kept, { ...createRow(kept), text: example }]).at(-1)?.kind
      result.set(example, kind !== undefined && kind !== 'error' && kind !== 'empty')
    }
    return result
  }, [engine, mode, rows])
  const searching = query.trim() !== ''
  const remember = (group: string, isOpen: boolean): void => {
    if (searching) return
    if (isOpen) opened.current.add(group)
    else opened.current.delete(group)
  }
  const toggle = (group: string): void => {
    const isOpen = !open.has(group)
    remember(group, isOpen)
    setOpen((current) => {
      const next = new Set(current)
      if (isOpen) next.add(group)
      else next.delete(group)
      return next
    })
  }
  const groups = referenceOrder(mode).map((group) => ({ group, entries: matching(group, query) })).filter(({ entries }) => entries.length)
  // A query opens every matching group; clearing it closes them again, except the groups opened by hand.
  const search = (next: string): void => {
    setQuery(next)
    setOpen(next.trim() ? new Set(REFERENCE.filter((group) => matching(group, next).length).map((group) => group.id)) : new Set(opened.current))
  }
  const anyOpen = groups.some(({ group }) => open.has(group.id))
  const toggleAll = (): void => {
    for (const { group } of groups) remember(group.id, !anyOpen)
    setOpen((current) => {
      const next = new Set(current)
      for (const { group } of groups) {
        if (anyOpen) next.delete(group.id)
        else next.add(group.id)
      }
      return next
    })
  }
  const allLabel = uiText(anyOpen ? 'ref.collapseAll' : 'ref.expandAll')
  return (
    <div className="grapher-panel grapher-ref-panel">
      <div className="search-field-row grapher-ref-search">
        <label className="search-field">
          <Search className="search-field-icon" />
          <input
            className="search-field-input"
            type="search"
            value={query}
            placeholder={uiText('ref.search')}
            aria-label={uiText('ref.search')}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => search(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); search('') } }}
          />
          {query ? (
            <button type="button" className="search-field-action" aria-label={uiText('ref.clear')} title={uiText('ref.clear')} onClick={() => search('')}>
              <X />
            </button>
          ) : null}
        </label>
        <button type="button" className="grapher-ref-all" aria-label={allLabel} title={allLabel} disabled={!groups.length} onClick={toggleAll}>
          {anyOpen ? <CollapseAll /> : <ExpandAll />}
        </button>
      </div>
      {loaded ? (
        <div className="grapher-reference" aria-label={uiText('ref.label')}>
          {groups.map(({ group, entries }) => {
            const expanded = open.has(group.id)
            return (
              <section key={group.id} className="grapher-ref-group" data-group={group.id}>
                <button type="button" className="grapher-ref-heading" aria-expanded={expanded} onClick={() => toggle(group.id)}>
                  <ChevronDown className="grapher-ref-chevron" />
                  {uiText(`ref.group.${group.id}`)}
                </button>
                {expanded ? (
                  <ul className="grapher-ref-entries">
                    {entries.map((entry) => (
                      <li key={entry.id} className="grapher-ref-entry">
                        <code className="grapher-ref-syntax">{entry.syntax}</code>
                        <span className="grapher-ref-text">{uiText(`ref.${entry.id}`)}</span>
                        {entry.examples ? (
                          <span className="grapher-ref-examples">
                            {entry.examples.map((example) => {
                              const usable = valid.get(example) === true
                              const label = uiText(usable ? 'ref.insert' : 'ref.elsewhere', { example })
                              return (
                                <button key={example} type="button" className="grapher-ref-example" disabled={!usable} aria-label={label} title={label} onClick={() => insertTemplate(id || MAIN_GRAPH, mode, { text: example })}>
                                  {example}
                                </button>
                              )
                            })}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
          {searching && !groups.length ? <p className="grapher-ref-empty" role="status">{uiText('ref.none', { query: query.trim() })}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
