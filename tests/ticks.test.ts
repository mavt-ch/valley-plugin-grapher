import { describe, expect, it } from 'vitest'
import { decimalAxis, decimalStep, degreeAxis, degreeTicks, formatComplex, formatDegrees, formatImaginary, formatLinear, formatNumber, formatPi, formatPolar, formatScientific, logAxis, piAxis, piTicks, scientificAxis } from '../src/ticks'

describe('axis ticks', () => {
  it('writes the equations of tangents with signs and without unit coefficients', () => {
    expect(formatLinear([[2, 'x']], -1)).toBe('2x − 1')
    expect(formatLinear([[-1, 'x']], 3.14159265)).toBe('−x + 3.1416')
    expect(formatLinear([[0, 'x']], 4)).toBe('4')
    expect(formatLinear([[1, 'x']], 0)).toBe('x')
    expect(formatLinear([[0, 'x']], 0)).toBe('0')
    expect(formatLinear([[0.5, 'x'], [-1.5, 'y']], -2)).toBe('0.5x − 1.5y − 2')
    expect(formatLinear([[0, 'x'], [-1, 'y']], 0)).toBe('−y')
  })

  it('labels a 3D axis in multiples of π near the decimal spacing', () => {
    expect(piTicks(10, 5).map((label) => label.text)).toEqual(['−3π', '−2π', '−π', 'π', '2π', '3π'])
    expect(piTicks(1, 0.5).map((label) => label.text)).toEqual(['−π/6', 'π/6'])
  })

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

  it('labels an axis of radians in degrees', () => {
    expect(degreeAxis(-7, 7, 60).labels.map((label) => label.text)).toEqual(['−360°', '−270°', '−180°', '−90°', '90°', '180°', '270°', '360°'])
    expect(degreeAxis(-0.5, 0.5, 400).labels.map((label) => label.text)).toEqual(['−15°', '15°'])
    expect(degreeAxis(-1, 1, 400).labels[0].value).toBeCloseTo(-45 * Math.PI / 180)
    expect(degreeTicks(4, 2).map((label) => label.text)).toEqual(['−180°', '−90°', '90°', '180°'])
    expect([formatDegrees(0), formatDegrees(-90), formatDegrees(1080)]).toEqual(['0°', '−90°', '1080°'])
  })

  it('labels axes in scientific notation', () => {
    expect([formatScientific(0.5), formatScientific(1000), formatScientific(-25000), formatScientific(1.5), formatScientific(0)]).toEqual(['5·10⁻¹', '10³', '−2.5·10⁴', '1.5', '0'])
    expect(formatScientific(9.9996)).toBe('10¹')
    expect(scientificAxis(-10.5, 10.5, 20).labels.map((label) => label.text)).toEqual(['−10¹', '−5', '5', '10¹'])
  })

  it('labels logarithmic axes at their decades', () => {
    // 80 px a decade from 0.01 to 1000: every decade labelled, with the 2 to 9 multiples as minor lines.
    const wide = logAxis(-2, 3, 80)
    expect(wide.labels.map((label) => label.text)).toEqual(['10⁻²', '10⁻¹', '1', '10¹', '10²', '10³'])
    expect(wide.lines.filter((line) => line.major).map((line) => line.value)).toEqual([0.01, 0.1, 1, 10, 100, 1000])
    expect(wide.lines.filter((line) => !line.major)).toHaveLength(5 * 8)
    // Far out, every fifth decade is labelled and the others are minor lines; far in, the 2 and 5 multiples get labels.
    const far = logAxis(-20, 20, 15)
    expect(far.labels.map((label) => label.value)).toEqual([1e-20, 1e-15, 1e-10, 1e-5, 1, 1e5, 1e10, 1e15, 1e20])
    expect(far.lines.every((line) => Number.isInteger(Math.log10(line.value)))).toBe(true)
    expect(logAxis(0, 1, 200).labels.map((label) => label.text)).toEqual(['1', '2', '5', '10¹'])
    expect(logAxis(1, 0, 80).lines).toEqual([])
  })

  it('formats π fractions and numbers', () => {
    expect([formatPi(0, 6), formatPi(3, 6), formatPi(-4, 6), formatPi(11, 6), formatPi(12, 6)]).toEqual(['0', 'π/2', '−2π/3', '11π/6', '2π'])
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(-2)).toBe('−2')
    expect(formatNumber(2e6)).toBe('2e6')
    expect(formatNumber(1.23456e-5)).toBe('1.235e-5')
    expect(formatNumber(Number.NaN)).toBe('—')
  })

  it('writes complex numbers in rectangular and Euler form', () => {
    expect([formatComplex(3, 2), formatComplex(3, -2), formatComplex(0, 1), formatComplex(0, -1), formatComplex(-1.5, 0), formatComplex(1, 1e-17)]).toEqual(['3 + 2i', '3 − 2i', 'i', '−i', '−1.5', '1'])
    expect(formatPolar(1, Math.sqrt(3))).toBe('2·e^(iπ/3)')
    expect(formatPolar(0, -1)).toBe('e^(−iπ/2)')
    expect(formatPolar(-2, 0)).toBe('2·e^(iπ)')
    expect(formatPolar(3, 4)).toBe('5·e^(0.9273i)')
    expect(formatPolar(4, 0)).toBe('4')
    expect([formatImaginary('1'), formatImaginary('−1'), formatImaginary('2')]).toEqual(['i', '−i', '2i'])
  })
})
