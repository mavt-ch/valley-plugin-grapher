import { describe, expect, it } from 'vitest'
import { decimalAxis, decimalStep, formatNumber, formatPi, piAxis } from '../src/ticks'

describe('axis ticks', () => {
  it('steps decimal axes by 1, 2 and 5', () => {
    expect(decimalStep(20)).toEqual({ major: 5, divisions: 5 })
    expect(decimalStep(35)).toEqual({ major: 2, divisions: 4 })
    expect(decimalStep(50)).toEqual({ major: 2, divisions: 4 })
    expect(decimalStep(60)).toEqual({ major: 1, divisions: 5 })
    expect(decimalStep(32)).toEqual({ major: 2, divisions: 4 })
    expect(decimalAxis(-10.5, 10.5, 20).labels.map((label) => label.text)).toEqual(['−10', '−5', '5', '10'])
    expect(decimalAxis(-1, 1, 500).labels.map((label) => label.text)).toContain('0.2')
  })

  it('labels the trigonometric axis in exact multiples of π', () => {
    expect(piAxis(-7, 7, 60).labels.map((label) => label.text)).toEqual(['−2π', '−3π/2', '−π', '−π/2', 'π/2', 'π', '3π/2', '2π'])
    expect(piAxis(-1, 1, 400).labels.map((label) => label.text)).toEqual(['−π/4', '−π/6', '−π/12', 'π/12', 'π/6', 'π/4'])
    expect(piAxis(-100, 100, 2).labels.map((label) => label.text)).toContain('20π')
  })

  it('formats π fractions and numbers', () => {
    expect([formatPi(0, 6), formatPi(3, 6), formatPi(-4, 6), formatPi(11, 6), formatPi(12, 6)]).toEqual(['0', 'π/2', '−2π/3', '11π/6', '2π'])
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(-2)).toBe('−2')
    expect(formatNumber(2e6)).toBe('2e6')
    expect(formatNumber(1.23456e-5)).toBe('1.235e-5')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})
