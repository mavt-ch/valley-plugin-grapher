import { describe, expect, it } from 'vitest'
import { createRow, defaultDocument, moveRow, normalizeDocument, withTrailingRow, type Row } from '../src/model'
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
    expect(() => normalizeDocument({ version: 2 })).toThrow()
    expect(() => normalizeDocument('nope')).toThrow()
    const document = normalizeDocument({ version: 1, mode: 'polar', sheets: { polar: [{ id: 'a', text: 'r = 2', color: 'palette:blue', slider: { min: 5, max: 1 } }, { id: 'a', text: 7 }, null] } })
    expect(document.mode).toBe('polar')
    expect(document.sheets.polar.map((row) => row.text)).toEqual(['r = 2', ''])
    expect(document.sheets.polar[0].slider).toEqual({ min: -10, max: 10, step: 0.1 })
    expect(new Set(document.sheets.polar.map((row) => row.id)).size).toBe(2)
    expect(document.sheets.cartesian).toEqual(expect.any(Array))
    expect(defaultDocument().sheets.trig.some((row) => row.text === 'sin(x)')).toBe(true)
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
    expect(MODES).toEqual(['cartesian', 'trig', 'polar', 'parametric', 'space', 'complex', 'complexSpace'])
    expect(new Set(MODES.map((mode) => viewOf(mode).kernel)).size).toBe(MODES.length)
    expect(defaultDocument().sheets.complexSpace.map((row) => row.text)).toEqual(['w = (z^2 - 4) / 4', 'Re(z^2) / 5', '1 + 2i', ''])
    expect(normalizeDocument({ version: 1, sheets: {} }).sheets.complexSpace).toHaveLength(4)
  })

  it('typesets input the way it is read', () => {
    expect(tokenizeMath('2xsin theta')).toEqual([{ t: 'num', v: '2' }, { t: 'id', v: 'x' }, { t: 'fn', v: 'sin' }, { t: 'id', v: 'θ' }])
    expect(tokenizeMath('log_2 x <= Re z')).toEqual([{ t: 'fn', v: 'log', sub: '2' }, { t: 'id', v: 'x' }, { t: 'op', v: '<=' }, { t: 'fn', v: 'real' }, { t: 'id', v: 'z' }])
    expect(parseMath('x^2/3')).toMatchObject({ k: 'frac', top: { k: 'pow', exp: { k: 'num', text: '2' } }, bottom: { k: 'num', text: '3' } })
    expect(parseMath('sqrt(x+1)')).toMatchObject({ k: 'root', body: { k: 'seq' } })
    expect(parseMath('e^(i π/3)')).toMatchObject({ k: 'pow', exp: { k: 'frac', bottom: { k: 'num', text: '3' } } })
    expect(parseMath('|z + 2')).toMatchObject({ k: 'group', open: '|', closed: false })
    expect(() => parseMath(')) ^^ ,, (( sin^ |')).not.toThrow()
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

