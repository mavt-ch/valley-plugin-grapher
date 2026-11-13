import { React } from './runtime'
import type { ReactElement } from 'react'
import { ChevronDown } from './icons'
import { uiText } from './localization'
import { MODES, createRow, filled, graphOf, type Mode } from './model'
import { insertTemplate, takesTables } from './Sidebar'
import { useGrapher } from './store'

/** One feature: its syntax, a sentence (`ref.<id>`) and examples that insert themselves. */
interface Entry { id: string; syntax: string; examples?: readonly string[] }
/** A group (`ref.group.<id>`) and the views it belongs to: those come first and open on that view. */
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
    { id: 'field3', syntax: 'F(x, y, z) = (P, Q, R)', examples: ['F(x, y, z) = (-y, x, 0)'] }
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
    { id: 'tplane', syntax: 'tangent(f, a, b)', examples: ['tangent((x^2 + y^2) / 5 - 6, 3, 2)'] }
  ] },
  { id: 'polar', views: ['polar'], entries: [{ id: 'polar', syntax: 'r = f(θ)', examples: ['r = 2cos(3θ)'] }] },
  { id: 'parametric', views: ['parametric'], entries: [{ id: 'curve', syntax: '(x(t), y(t))', examples: ['(cos t, sin(2t))'] }] },
  { id: 'cylindrical', views: ['cylindrical'], entries: [{ id: 'cylindrical', syntax: 'r, φ, z', examples: ['z = r^2', 'r = 1 + cos(φ)'] }] },
  { id: 'spherical', views: ['spherical'], entries: [{ id: 'spherical', syntax: 'ρ, θ, φ', examples: ['ρ = 2', 'φ = π/4'] }] },
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

/**
 * The right sidebar's reference: every feature with its syntax, a sentence and examples. An example the focused view's
 * kernel accepts (with the sheet's own rows, so f′(x) needs an f) inserts itself into the empty last row.
 */
export const Reference = (): ReactElement => {
  const { loaded, document, active, engine } = useGrapher()
  const graph = graphOf(document, active)
  const mode = graph.mode
  const rows = graph.sheets[mode]
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set(REFERENCE.filter((group) => group.views.includes(mode)).map((group) => group.id)))
  React.useEffect(() => setOpen(new Set(REFERENCE.filter((group) => group.views.includes(mode)).map((group) => group.id))), [mode])
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
  const toggle = (id: string): void => setOpen((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return (
    <div className="grapher-panel">
      <div className="panel-header grapher-header">
        <span className="grapher-ref-title">{uiText('ref.title', { mode: uiText(`mode.${mode}`) })}</span>
      </div>
      {loaded ? (
        <div className="grapher-reference" aria-label={uiText('ref.label')}>
          {referenceOrder(mode).map((group) => {
            const expanded = open.has(group.id)
            return (
              <section key={group.id} className="grapher-ref-group" data-group={group.id}>
                <button type="button" className="grapher-ref-heading" aria-expanded={expanded} onClick={() => toggle(group.id)}>
                  <ChevronDown className="grapher-ref-chevron" />
                  {uiText(`ref.group.${group.id}`)}
                </button>
                {expanded ? (
                  <ul className="grapher-ref-entries">
                    {group.entries.map((entry) => (
                      <li key={entry.id} className="grapher-ref-entry">
                        <code className="grapher-ref-syntax">{entry.syntax}</code>
                        <span className="grapher-ref-text">{uiText(`ref.${entry.id}`)}</span>
                        {entry.examples ? (
                          <span className="grapher-ref-examples">
                            {entry.examples.map((example) => {
                              const usable = valid.get(example) === true
                              const label = uiText(usable ? 'ref.insert' : 'ref.elsewhere', { example })
                              return (
                                <button key={example} type="button" className="grapher-ref-example" disabled={!usable} aria-label={label} title={label} onClick={() => insertTemplate(active, mode, { text: example })}>
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
        </div>
      ) : null}
    </div>
  )
}
