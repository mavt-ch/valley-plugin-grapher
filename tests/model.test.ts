import { describe, expect, it } from 'vitest'
import { createRow, defaultDocument, moveRow, normalizeDocument, unitsOf, withTrailingRow, type Row } from '../src/model'
import { parseMath, tokenizeMath } from '../src/MathText'
import { MODES, viewOf } from '../src/views'
import { sliderText } from '../src/Sidebar'
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

