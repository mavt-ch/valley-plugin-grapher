import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm } from '@valley/plugin-testkit'
import { decodeOutcomes, encodeRows, loadPlotEngine, SPACE, STRIDE, type PlotEngine } from '../src/engine'
import { createRow, type Row } from '../src/model'

let engine: PlotEngine
let module: Awaited<ReturnType<typeof loadPackageWasm>>

beforeAll(async () => {
  module = await loadPackageWasm(process.cwd(), 'plot')
  engine = await loadPlotEngine(createMockValleyApi({ manifest: { id: 'grapher' }, wasm: { modules: [module] } }).api)
})

function sheet(...entries: (string | Partial<Row>)[]): Row[] {
  const rows: Row[] = []
  for (const entry of entries) rows.push({ ...createRow(rows), ...(typeof entry === 'string' ? { text: entry } : entry) })
  return rows
}

describe('the plot kernel through api.wasm', () => {
  it('classifies every kind of row', () => {
    const analyses = engine.analyze('cartesian', sheet('y = a x + b', 'a = 2', 'b = a + 1', 'k x', '2 + 3', '(1, 2)', 'x^2 + y^2 = 4', 'x = y^2', 'f(u) = u^2', ''))
    expect(analyses.map((analysis) => analysis.kind)).toEqual(['function', 'param', 'param', 'error', 'value', 'point', 'implicit', 'function', 'definition', 'empty'])
    expect(analyses[0].axis).toBe('x')
    expect(analyses[1]).toMatchObject({ name: 'a', value: 2, slider: true })
    expect(analyses[2]).toMatchObject({ name: 'b', value: 3, slider: false })
    expect(analyses[3].error).toEqual({ key: 'error.unknown', param: 'k', missing: ['k'] })
    expect(analyses[4].value).toBe(5)
    expect(analyses[5]).toMatchObject({ x: 1, y: 2 })
    expect(analyses[7].axis).toBe('y')
    expect(analyses[8].name).toBe('f')
  })

  it('samples a function in screen and world coordinates and traces it exactly', () => {
    const rows = sheet('y = x^2')
    const paths = engine.sample('cartesian', rows, 400, 300, { cx: 0, cy: 0, scale: 20 })
    expect(paths).toHaveLength(1)
    const { points } = paths[0]
    expect(points.length % STRIDE).toBe(0)
    for (let i = 0; i < points.length; i += STRIDE) {
      expect(points[i + 3]).toBeCloseTo(points[i + 2] ** 2, 9)
      expect(points[i]).toBeCloseTo((points[i + 2] * 20) + 200, 9)
    }
    expect(engine.evaluate('cartesian', rows, 0, 3)).toBe(9)
  })

  it('reads polar and parametric ranges', () => {
    const polar = engine.analyze('polar', sheet({ text: 'r = θ', from: '0', to: '4π' }, 'r = 1 + cos(t)', { text: 'r = 2', to: 'q' }))
    expect(polar[0]).toMatchObject({ kind: 'polar', from: 0 })
    expect(polar[0].to).toBeCloseTo(4 * Math.PI, 12)
    expect(polar[1].kind).toBe('polar')
    expect(polar[2].error).toMatchObject({ key: 'error.unknown', missing: ['q'] })
    const curves = engine.analyze('parametric', sheet('(cos t, sin t)', 'cos t'))
    expect(curves[0]).toMatchObject({ kind: 'curve', from: 0 })
    expect(curves[1].error?.key).toBe('error.pair')
  })

  it('analyses hidden rows but draws only visible ones', () => {
    const rows = sheet({ text: 'y = c', hidden: true }, 'c = 1', 'y = -c')
    expect(engine.analyze('cartesian', rows)[0].kind).toBe('function')
    const paths = engine.sample('cartesian', rows, 200, 100, { cx: 0, cy: 0, scale: 10 })
    expect(paths.map((path) => path.row)).toEqual([2])
  })

  it('keeps row text from breaking the separators', () => {
    expect(encodeRows(sheet('a\u001eb\u001fc')).split('\u001e')).toHaveLength(1)
    expect(decodeOutcomes('', 0)).toEqual([])
    expect(engine.analyze('cartesian', sheet('y = x\u001e2')).map((analysis) => analysis.kind)).toEqual(['function'])
  })

  it('retries the module after a failed first attempt', async () => {
    // A frame learns its declared modules from the host's first snapshot; an early request must not stick.
    const { api } = createMockValleyApi({ manifest: { id: 'grapher' }, wasm: { modules: [module] } })
    const instantiate = vi.fn(api.wasm.instantiate).mockRejectedValueOnce(new Error('WebAssembly module "plot" is not declared in config.runtime.wasm'))
    const flaky = { runtime: api.runtime, wasm: { ...api.wasm, instantiate } }
    await expect(loadPlotEngine(flaky)).rejects.toThrow('not declared')
    const retried = await loadPlotEngine(flaky)
    expect(retried.analyze('cartesian', sheet('x'))[0].kind).toBe('function')
    expect(await loadPlotEngine(flaky)).toBe(retried)
    expect(instantiate).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['sin(x°)', 30, 0.5],
    ['sin(x', Math.PI / 2, 1],
    ['y = (x+1)(x-1', 3, 8],
    ['y = |x - 2', 0, 2],
    ['x^2)', 3, 9],
    ['log_2 x', 8, 3],
    ['sqrt x', 9, 3],
    ['ln x', Math.E, 1],
    ['∛x', -8, -2],
    ['root(x, 3)', 27, 3],
    ['0,5x', 4, 2],
    ['x2 + 1', 3, 10],
    ['e^x', 0, 1],
    ['x⁻¹', 4, 0.25],
    ['Sin(x) + PI', 0, Math.PI],
    ['2^x^2', 2, 16],
    ['x/inf', 5, 0],
    ['f(x) := x^2', 3, 9]
  ] as const)('plots forgiving input %s', (text, x, expected) => {
    const rows = sheet(text)
    expect(engine.analyze('cartesian', rows)[0]).toMatchObject({ kind: 'function', axis: 'x' })
    expect(engine.evaluate('cartesian', rows, 0, x)).toBeCloseTo(expected, 9)
  })

  it('reads Greek letter names and loose pairs on every sheet', () => {
    expect(engine.analyze('polar', sheet('r = theta / 2', 'r = 1 + Cos(Theta'))).toMatchObject([{ kind: 'polar' }, { kind: 'polar' }])
    expect(engine.analyze('parametric', sheet('(cos t, sin t'))[0].kind).toBe('curve')
    expect(engine.analyze('cartesian', sheet('y = phi x'))[0].error).toMatchObject({ key: 'error.unknown', missing: ['φ'] })
  })

  it('analyses and renders 3D sheets', () => {
    const rows = sheet('y^2 + x^2 + y^2', { text: '(5cos t, 5sin t, t/2)', to: '4π' }, '(1, 2, 3)', 'x = y z', '(1, 2)')
    expect(engine.analyze('space', rows).map((row) => row.kind)).toEqual(['surface', 'curve3', 'point3', 'surface', 'error'])
    expect(engine.analyze('space', rows)[3].axis).toBe('x')
    const records = engine.space(rows, 600, 400, { yaw: -0.6, pitch: 0.45, range: 10 })
    const kinds = new Map<number, number>()
    for (const record of records) kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1)
    expect(kinds.get(SPACE.box)).toBe(12)
    expect(kinds.get(SPACE.axisName)).toBe(3)
    expect(kinds.get(SPACE.polygon)).toBeGreaterThan(1000)
    expect(kinds.get(SPACE.segment)).toBeGreaterThan(300)
    expect(kinds.get(SPACE.point)).toBe(1)
    const firstItem = records.findIndex((record) => record.kind < SPACE.box)
    expect(records.slice(firstItem).every((record) => record.kind < SPACE.box)).toBe(true)
    for (const record of records) for (let i = 0; i < record.points.length; i += 2) {
      expect(record.points[i]).toBeGreaterThanOrEqual(0)
      expect(record.points[i]).toBeLessThanOrEqual(600)
    }
  })
})

