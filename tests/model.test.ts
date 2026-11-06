import { describe, expect, it } from 'vitest'
import { createRow, defaultDocument, normalizeDocument, withTrailingRow, type Row } from '../src/model'
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

