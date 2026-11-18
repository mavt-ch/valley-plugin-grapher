import { describe, expect, it } from 'vitest'
import { createFolder, createRow, defaultDocument, drawnRows, leaveFolder, moveIntoGap, moveRow, normalizeDocument, removeFolder, unitsOf, withFolders, withTrailingRow, type Row } from '../src/model'
import { parseMath, tokenizeMath } from '../src/MathText'
import { MODES, viewOf } from '../src/views'
import { parseBound, sliderText } from '../src/Sidebar'
import { rgb, shaded } from '../src/Space'

describe('sheets', () => {
  it('always end in exactly one empty row', () => {
    const typed = { ...createRow([]), text: 'x' }
    expect(withTrailingRow([typed]).map((row) => row.text)).toEqual(['x', ''])
    const empty = (): Row => createRow([])
    expect(withTrailingRow([typed, empty(), empty(), empty()]).map((row) => row.text)).toEqual(['x', ''])
    expect(withTrailingRow([])).toHaveLength(1)
  })

  it('gives each new graph the next free colour', () => {
    const first = { ...createRow([]), text: 'x' }
    expect(createRow([first]).color).not.toBe(first.color)
  })

  it('repairs stored rows and refuses foreign files', () => {
    const tabs = normalizeDocument({ version: 1, mode: 'space', graphs: { second: { mode: 'polar', sheets: { polar: [{ id: 'p', text: 'r = 3' }] } }, main: { mode: 'complex' }, bad: 7 } })
    expect(tabs.mode).toBe('space')
    expect(Object.keys(tabs.graphs)).toEqual(['second'])
    expect(tabs.graphs.second.sheets.polar.map((row) => row.text)).toEqual(['r = 3', ''])
    expect(tabs.graphs.second.sheets.cartesian.length).toBeGreaterThan(1)
    expect(() => normalizeDocument({ version: 2 })).toThrow()
    expect(() => normalizeDocument('nope')).toThrow()
    const document = normalizeDocument({ version: 1, mode: 'polar', sheets: { polar: [{ id: 'a', text: 'r = 2', color: 'palette:blue', slider: { min: 5, max: 1 } }, { id: 'a', text: 7 }, null] } })
    expect(document.mode).toBe('polar')
    expect(document.sheets.polar.map((row) => row.text)).toEqual(['r = 2', ''])
    expect(document.sheets.polar[0].slider).toEqual({ min: -10, max: 10, step: 0.1 })
    expect(new Set(document.sheets.polar.map((row) => row.id)).size).toBe(2)
    expect(document.sheets.cartesian).toEqual(expect.any(Array))
    expect(defaultDocument().sheets.complex.map((row) => row.text)).toEqual(['w = 2e^(iπ/3)', 'cos(φ) + i sin(φ)', 'φ = 0.8', '|z + 2| < 3', ''])
    expect(defaultDocument().sheets.space.map((row) => row.text)).toEqual(['z = (x^2 + y^2) / 5 - 6', '(6cos t, 6sin t, t / 2)', ''])
  })

  it('moves rows into the gap they are dropped in', () => {
    const rows = ['a', 'b', 'c', 'd'].map((text) => ({ ...createRow([]), text }))
    const texts = (list: Row[]): string[] => list.map((row) => row.text)
    expect(texts(moveRow(rows, 0, 3))).toEqual(['b', 'c', 'a', 'd'])
    expect(texts(moveRow(rows, 3, 0))).toEqual(['d', 'a', 'b', 'c'])
    expect(texts(moveRow(rows, 1, 4))).toEqual(['a', 'c', 'd', 'b'])
    expect(texts(moveRow(rows, 1, 1))).toEqual(['a', 'b', 'c', 'd'])
    expect(texts(moveRow(rows, 1, 2))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps one folder per view, each with its own kernel mode', () => {
    expect(MODES).toEqual(['cartesian', 'polar', 'parametric', 'space', 'cylindrical', 'spherical', 'complex', 'complexSpace'])
    expect(new Set(MODES.map((mode) => viewOf(mode).kernel)).size).toBe(MODES.length)
    expect(defaultDocument().sheets.complexSpace.map((row) => row.text)).toEqual(['w = (z^2 - 4) / 4', 'Re(z^2) / 5', '1 + 2i', ''])
    expect(normalizeDocument({ version: 1, sheets: {} }).sheets.complexSpace).toHaveLength(4)
  })

  it('loads files written before the second range and the cylindrical view, and keeps both once saved', () => {
    const older = normalizeDocument({ version: 1, mode: 'space', sheets: { space: [{ id: 'a', text: 'z = x y', color: 'palette:red', hidden: false, from: '', to: '', slider: { min: -10, max: 10, step: 0.1 } }] }, units: { space: 'pi' }, graphs: { tab: { mode: 'polar', sheets: {} } } })
    expect(older.mode).toBe('space')
    expect(older.sheets.space[0]).toMatchObject({ id: 'a', text: 'z = x y', from: '', to: '', from2: '', to2: '' })
    expect(unitsOf(older, 'space')).toBe('pi')
    expect(older.sheets.cylindrical.map((row) => row.text)).toEqual(['r = 1 + cos(φ)', 'z = φ / 2', ''])
    expect(older.sheets.cylindrical[0]).toMatchObject({ from: '', to: '', from2: '-4', to2: '0' })
    expect(older.graphs.tab.sheets.cylindrical).toHaveLength(3)
    const saved = JSON.parse(JSON.stringify({ ...older, mode: 'cylindrical' })) as unknown
    const again = normalizeDocument(saved)
    expect(again.mode).toBe('cylindrical')
    expect(again.sheets.cylindrical[1]).toMatchObject({ text: 'z = φ / 2', from: '', to: '', from2: '0', to2: '3' })
    expect(viewOf('cylindrical')).toMatchObject({ canvas: 'space', kernel: 7, homeRange: 5 })
    expect(older.sheets.spherical.map((row) => row.text)).toEqual(['ρ = 2', 'φ = π/4', ''])
    expect(older.sheets.spherical[0]).toMatchObject({ from2: '0', to2: 'π/4' })
    expect(viewOf('spherical')).toMatchObject({ canvas: 'space', kernel: 8, homeRange: 3 })
  })

  it('keeps the vector field shading choice only where it was made', () => {
    const document = normalizeDocument({ version: 1, sheets: { cartesian: [{ id: 'a', text: '(-y, x)', magnitude: false }, { id: 'b', text: '(y, x)', magnitude: 'no' }, { id: 'c', text: 'x' }] } })
    expect(document.sheets.cartesian[0].magnitude).toBe(false)
    expect('magnitude' in document.sheets.cartesian[1]).toBe(false)
    expect('magnitude' in document.sheets.cartesian[2]).toBe(false)
    expect(parseMath('F(x, y) = (-y, x)')).toMatchObject({ k: 'seq', items: [{ k: 'var', text: 'F', vector: true }, { k: 'group' }, { k: 'op', text: '=' }, { k: 'group' }] })
    const named = (text: string): boolean => { const node = parseMath(text); return node.k === 'seq' && node.items[0].k === 'var' && node.items[0].vector === true }
    expect(named('F(x, y, z) = (y, z, x)')).toBe(true)
    expect(named('f(x) = (x + 1)')).toBe(false)
    expect(named('f(x, y) = x y')).toBe(false)
    expect(named('F(x, y) = (-y, x) + 1')).toBe(false)
  })

  it('keeps a flowing vector field only where it was switched on', () => {
    const document = normalizeDocument({ version: 1, sheets: { cartesian: [{ id: 'a', text: '(-y, x)', flow: true }, { id: 'b', text: '(y, x)', flow: false }, { id: 'c', text: '(1, x)', flow: 'yes' }] } })
    expect(document.sheets.cartesian[0].flow).toBe(true)
    expect('flow' in document.sheets.cartesian[1]).toBe(false)
    expect('flow' in document.sheets.cartesian[2]).toBe(false)
  })

  it('typesets double and triple integrals with one sign and one differential per variable', () => {
    expect(parseMath('int(x y, 0, 1, 0, x)')).toMatchObject({ k: 'integral', from: { k: 'num', text: '0' }, to: { k: 'num', text: '1' }, inner: [{ from: { k: 'num', text: '0' }, to: { k: 'var', text: 'x' } }] })
    const triple = parseMath('∫(1, 0, 2, 0, 3, 0, 4)')
    expect(triple).toMatchObject({ k: 'integral', inner: [{ to: { k: 'num', text: '3' } }, { to: { k: 'num', text: '4' } }] })
    expect(parseMath('int(x, 0, 1, 2)')).toMatchObject({ k: 'fn', text: '∫' })
  })

  it('keeps the normal-vector choice of a tangent plane only where it was made', () => {
    const document = normalizeDocument({ version: 1, sheets: { space: [{ id: 'a', text: 'tangent(f, a, b)', normal: false }, { id: 'b', text: 'tangent(f, 1, 2)', normal: 'off' }, { id: 'c', text: 'z = x y' }] } })
    expect(document.sheets.space[0].normal).toBe(false)
    expect('normal' in document.sheets.space[1]).toBe(false)
    expect('normal' in document.sheets.space[2]).toBe(false)
    expect(viewOf('space').placeholder).toBe('tangent((x^2 + y^2) / 5 - 6, 3, 2)')
  })

  it('typesets primes, integrals with their limits and tangents', () => {
    expect(parseMath("f'(x)")).toMatchObject({ k: 'seq', items: [{ k: 'post', base: { k: 'var', text: 'f' }, text: '′' }, { k: 'group' }] })
    expect(parseMath("f''(x)")).toMatchObject({ items: [{ k: 'post', text: '″' }, { k: 'group' }] })
    expect(parseMath('g‴(x) + h’(x)')).toMatchObject({ items: [{ k: 'post', text: '‴' }, { k: 'group' }, { k: 'op', text: '+' }, { k: 'post', text: '′' }, { k: 'group' }] })
    expect(parseMath('int(f, 0, 1)')).toMatchObject({ k: 'integral', body: { k: 'var', text: 'f' }, from: { k: 'num', text: '0' }, to: { k: 'num', text: '1' } })
    expect(parseMath('∫(x^2 + 1, a, π)')).toMatchObject({ k: 'integral', body: { k: 'group', open: '(' }, from: { k: 'var', text: 'a' }, to: { k: 'sym', text: 'π' } })
    expect(parseMath("integral(f', -1, b)")).toMatchObject({ k: 'integral', body: { k: 'post', text: '′' } })
    expect(parseMath('int(x^2, 0')).toMatchObject({ k: 'fn', text: '∫' })
    expect(parseMath('sum(n, 0, N, x^n / n!)')).toMatchObject({ k: 'series', sign: 'Σ', index: { k: 'var', text: 'n' }, from: { k: 'num', text: '0' }, to: { k: 'var', text: 'N' }, body: { k: 'frac' } })
    expect(parseMath('Σ(k, 1, n, k + 1)')).toMatchObject({ k: 'series', sign: 'Σ', body: { k: 'group', open: '(' } })
    expect(parseMath('∏(k, 1, 5, k)')).toMatchObject({ k: 'series', sign: '∏' })
    expect(parseMath('Product(k, 1, 5, k)')).toMatchObject({ k: 'series', sign: '∏' })
    expect(parseMath('2xΣ(k, 1, 3, k)')).toMatchObject({ k: 'seq', items: [{ k: 'num' }, { k: 'var', text: 'x' }, { k: 'series' }] })
    expect(parseMath('sum(k, 1')).toMatchObject({ k: 'fn', text: 'sum' })
    expect(parseMath('{x < 0: −x, x ≥ 0: x^2}')).toMatchObject({ k: 'cases', closed: true, branches: [{ condition: { k: 'seq', items: [{ text: 'x' }, { text: '<', relation: true }, { text: '0' }] } }, { condition: { k: 'seq' }, value: { k: 'pow' } }] })
    expect(parseMath('y = {x < 0: -x, x^2')).toMatchObject({ k: 'seq', items: [{ text: 'y' }, { text: '=' }, { k: 'cases', closed: false, branches: [{ condition: {} }, { value: { k: 'pow' } }] }] })
    const joined = parseMath('{0 <= x < 1 and x != 0.5 or x > 2: 1, 0}')
    expect(joined).toMatchObject({ k: 'cases', branches: [{ condition: { k: 'seq' } }, { value: { k: 'num', text: '0' } }] })
    const condition = joined.k === 'cases' ? joined.branches[0].condition : undefined
    expect(condition?.k === 'seq' ? condition.items.filter((item) => item.k === 'op').map((item) => item.k === 'op' && item.text) : []).toEqual(['≤', '<', 'and', '≠', 'or', '>'])
    const plain = parseMath('{x + 1}')
    expect(plain.k === 'seq' ? plain.items[0] : plain).toMatchObject({ k: 'sym', text: '{' })
    expect(tokenizeMath('x!=3').map((token) => token.v)).toEqual(['x', '!', '=', '3'])
    expect(parseMath('tangent(f, a)')).toMatchObject({ k: 'fn', text: 'tangent', arg: { k: 'group' } })
    expect(tokenizeMath('tangent tan')).toEqual([{ t: 'fn', v: 'tangent' }, { t: 'fn', v: 'tan' }])
  })

  it('reads level-curve settings additively and starts the 3D paraboloid with its floor curves', () => {
    const document = normalizeDocument({ version: 1, sheets: { cartesian: [{ id: 'a', text: 'f(x, y) = x y', levels: 12, step: '0.5', labels: false }, { id: 'b', text: 'g(x, y) = x', levels: 0, step: 3 }, { id: 'c', text: 'z' }], space: [{ id: 'd', text: 'x y', floor: true }] } })
    expect(document.sheets.cartesian[0]).toMatchObject({ levels: 12, step: '0.5', labels: false })
    expect(['levels', 'step', 'labels', 'floor'].some((key) => key in document.sheets.cartesian[1])).toBe(false)
    expect(['levels', 'step', 'labels', 'floor'].some((key) => key in document.sheets.cartesian[2])).toBe(false)
    expect(document.sheets.space[0].floor).toBe(true)
    const fresh = defaultDocument()
    expect(fresh.sheets.space[0]).toMatchObject({ text: 'z = (x^2 + y^2) / 5 - 6', floor: true })
    expect('floor' in fresh.sheets.space[1]).toBe(false)
  })

  it('turns the old trigonometric sheet into Cartesian with π axes', () => {
    const row = (id: string, text: string) => ({ id, text, color: 'palette:red' })
    const examples = normalizeDocument({ version: 1, mode: 'trig', sheets: { cartesian: [row('a', 'y = x')], trig: ['sin(x)', 'cos(x)', 'y = A sin(k x)', 'A = 2', 'k = 0.5'].map((text, at) => row(`t${at}`, text)) } })
    expect(examples.mode).toBe('cartesian')
    expect(unitsOf(examples, 'cartesian')).toBe('pi')
    expect(examples.sheets.cartesian.map((entry) => entry.text)).toEqual(['y = x', ''])
    const own = normalizeDocument({ version: 1, mode: 'polar', units: { polar: 'decimal' }, sheets: { cartesian: [row('a', 'y = x')], trig: [row('a', 'tan x'), row('b', '')] } })
    expect(own.mode).toBe('polar')
    expect(unitsOf(own, 'cartesian')).toBe('decimal')
    expect(unitsOf(own, 'polar')).toBe('decimal')
    expect(unitsOf(own, 'space')).toBe('decimal')
    expect(own.sheets.cartesian.map((entry) => entry.text)).toEqual(['y = x', 'tan x', ''])
    expect(new Set(own.sheets.cartesian.map((entry) => entry.id)).size).toBe(3)
  })

  it('typesets input the way it is read', () => {
    expect(tokenizeMath('2xsin theta')).toEqual([{ t: 'num', v: '2' }, { t: 'id', v: 'x' }, { t: 'fn', v: 'sin' }, { t: 'id', v: 'θ' }])
    expect(tokenizeMath('log_2 x <= Re z')).toEqual([{ t: 'fn', v: 'log', sub: '2' }, { t: 'id', v: 'x' }, { t: 'op', v: '<=' }, { t: 'fn', v: 'real' }, { t: 'id', v: 'z' }])
    expect(parseMath('x^2/3')).toMatchObject({ k: 'frac', top: { k: 'pow', exp: { k: 'num', text: '2' } }, bottom: { k: 'num', text: '3' } })
    expect(parseMath('sqrt(x+1)')).toMatchObject({ k: 'root', body: { k: 'seq' } })
    expect(parseMath('e^(i π/3)')).toMatchObject({ k: 'pow', exp: { k: 'frac', bottom: { k: 'num', text: '3' } } })
    expect(parseMath('|z + 2')).toMatchObject({ k: 'group', open: '|', closed: false })
    expect(() => parseMath(')) ^^ ,, (( sin^ |')).not.toThrow()
    expect(tokenizeMath('rho = 1 + cos(Phi)')).toEqual([{ t: 'id', v: 'ρ' }, { t: 'op', v: '=' }, { t: 'num', v: '1' }, { t: 'op', v: '+' }, { t: 'fn', v: 'cos' }, { t: 'op', v: '(' }, { t: 'id', v: 'φ' }, { t: 'op', v: ')' }])
    expect(parseMath('z = phi / 2')).toMatchObject({ k: 'seq', items: [{ k: 'var', text: 'z' }, { k: 'op', relation: true }, { k: 'frac', top: { k: 'var', text: 'φ' }, bottom: { k: 'num', text: '2' } }] })
    expect(tokenizeMath('(ucos v, u sin v, v)').filter((token) => token.t !== 'op')).toEqual([{ t: 'id', v: 'u' }, { t: 'fn', v: 'cos' }, { t: 'id', v: 'v' }, { t: 'id', v: 'u' }, { t: 'fn', v: 'sin' }, { t: 'id', v: 'v' }, { t: 'id', v: 'v' }])
    expect(parseMath('A = -1.3')).toMatchObject({ k: 'seq', items: [{ k: 'var' }, { k: 'op', relation: true }, { k: 'op', text: '−', sign: true }, { k: 'num', text: '1.3' }] })
  })

  it('writes slider values at the precision of their step', () => {
    expect(sliderText('a', 1.2300000001, 0.1)).toBe('a = 1.2')
    expect(sliderText('k', -0.456, 0.01)).toBe('k = -0.46')
    expect(sliderText('n', 3, 1)).toBe('n = 3')
  })

  it('shades resolved surface colours', () => {
    expect(rgb('#d33542')).toEqual([211, 53, 66])
    expect(rgb('#fff')).toEqual([255, 255, 255])
    expect(rgb('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(rgb('var(--color-red)')).toBeNull()
    expect(shaded('#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
    expect(shaded('var(--color-red)', 0.5)).toBe('var(--color-red)')
  })
})


describe('folders', () => {
  const row = (text: string, parent?: string): Row => ({ ...createRow([]), text, ...(parent ? { parent } : {}) })
  const folder = (name: string): Row => createFolder([], name)
  const shape = (rows: readonly Row[]): string[] => rows.map((entry) => (entry.folder ? `[${entry.text}]` : entry.parent ? `  ${entry.text}` : entry.text))

  it('stay one level deep and keep their rows together', () => {
    const a = folder('A')
    const b = folder('B')
    const nested = { ...b, parent: a.id }
    expect(shape(withFolders([a, row('x', a.id), nested, row('y', a.id), row('z', b.id)]))).toEqual(['[A]', '  x', '[B]', 'y', 'z'])
    expect(shape(withFolders([row('x', 'missing'), a, row('w'), row('v', a.id)]))).toEqual(['x', '[A]', 'w', 'v'])
  })

  it('move rows in and out, and a folder only to the top level with its rows', () => {
    const a = folder('A')
    const b = folder('B')
    const rows = [a, row('x', a.id), row('y', a.id), row('z'), b, row('w', b.id), row('')]
    expect(shape(moveIntoGap(rows, 3, 2, a.id))).toEqual(['[A]', '  x', '  z', '  y', '[B]', '  w', ''])
    expect(shape(moveIntoGap(rows, 1, 4))).toEqual(['[A]', '  y', 'z', 'x', '[B]', '  w', ''])
    expect(shape(moveIntoGap(rows, 4, 0))).toEqual(['[B]', '  w', '[A]', '  x', '  y', 'z', ''])
    expect(moveIntoGap(rows, 4, 2, a.id)).toEqual(rows)
    expect(shape(leaveFolder(rows, 1))).toEqual(['[A]', '  y', 'x', 'z', '[B]', '  w', ''])
  })

  it('come away with or without their rows', () => {
    const a = folder('A')
    const rows = [a, row('x', a.id), row('y')]
    expect(shape(removeFolder(rows, 0, false))).toEqual(['x', 'y'])
    expect(shape(removeFolder(rows, 0, true))).toEqual(['y'])
  })

  it('hide their rows, never send their name to the kernel and keep the empty last row outside', () => {
    const a = { ...folder('a = 1'), hidden: true }
    const drawn = drawnRows([a, row('x', a.id), row('y')])
    expect(drawn.map((entry) => entry.hidden)).toEqual([true, true, false])
    expect(shape(withTrailingRow([a, row('x', a.id)]))).toEqual(['[a = 1]', '  x', ''])
    expect(withTrailingRow([a, row('', a.id)]).at(-1)?.parent).toBeUndefined()
  })

  it('survive a save and reload', () => {
    const document = defaultDocument()
    const a = folder('A')
    document.sheets.cartesian = [{ ...a, folder: { collapsed: true } }, row('x', a.id), row('')]
    const back = normalizeDocument(JSON.parse(JSON.stringify(document)))
    expect(back.sheets.cartesian[0].folder).toEqual({ collapsed: true })
    expect(back.sheets.cartesian[1].parent).toBe(a.id)
  })
})

describe('slider bounds', () => {
  it('accept partial typing only once it is a number', () => {
    expect(['', '-', '.', '0.', '-.', 'e'].map(parseBound)).toEqual([null, null, null, 0, null, null])
    expect(['0.5', '-3', '−2', '1,5', '.25', '1e3'].map(parseBound)).toEqual([0.5, -3, -2, 1.5, 0.25, 1000])
  })
})
