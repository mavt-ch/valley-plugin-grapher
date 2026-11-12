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
    const records = engine.space('space', rows, 600, 400, { yaw: -0.6, pitch: 0.45, range: 10 })
    const complex = sheet('w = z^2 / 4', 'f(z) = 1 / z', 'Im(z^2)', '1 + i', 'z > 1')
    expect(engine.analyze('complexSpace', complex).map((row) => row.kind)).toEqual(['csurface', 'csurface', 'csurface', 'cpoint', 'error'])
    const coloured = engine.space('complexSpace', complex, 600, 400, { yaw: -0.6, pitch: 0.45, range: 10 })
    expect(coloured.filter((record) => record.kind === SPACE.huePolygon).length).toBeGreaterThan(1000)
    expect(coloured.filter((record) => record.kind === SPACE.point).map((record) => record.row)).toEqual([3])
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

  it('reads triples in u and v as parametric surfaces and keeps every other triple as it was', () => {
    const torus = '((2 + cos v) cos u, (2 + cos v) sin u, sin v)'
    const mobius = { text: '((1 + v/2 cos(u/2)) cos u, (1 + v/2 cos(u/2)) sin u, v/2 sin(u/2))', from2: '-1', to2: '1' }
    const rows = sheet(torus, mobius, { text: '(u cos v, u sin v, v)', from: '-2', to: '2' }, '(u cos v, u sin v, u)', '(cos t, sin t, t)', '(1, 2, 3)', '(u, 1, 2)', { text: torus, to2: 'q' })
    const analyses = engine.analyze('space', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['psurface', 'psurface', 'psurface', 'psurface', 'curve3', 'point3', 'error', 'error'])
    expect(analyses[0]).toMatchObject({ over: ['u', 'v'], from: 0, from2: 0 })
    expect(analyses[0].to2).toBeCloseTo(2 * Math.PI, 12)
    expect(analyses[1]).toMatchObject({ from2: -1, to2: 1 })
    expect(analyses[2]).toMatchObject({ from: -2, to: 2 })
    expect(analyses[6].error).toMatchObject({ key: 'error.unknown', missing: ['u'] })
    expect(analyses[7].error).toMatchObject({ key: 'error.unknown', missing: ['q'] })
    // A sheet that defines u and v keeps the triple a point at their values.
    expect(engine.analyze('space', sheet('(u cos v, u sin v, v)', 'u = 2', 'v = 0'))[0]).toMatchObject({ kind: 'point3', x: 2, y: 0, z: 0 })
    const records = engine.space('space', rows, 600, 400, { yaw: -0.6, pitch: 0.45, range: 4 })
    for (const row of [0, 1, 2, 3]) expect(records.filter((record) => record.kind === SPACE.polygon && record.row === row).length).toBeGreaterThan(1000)
    for (const record of records) for (let i = 0; i < record.points.length; i += 2) {
      expect(record.points[i]).toBeGreaterThanOrEqual(0)
      expect(record.points[i]).toBeLessThanOrEqual(600)
    }
  })

  it('reads other equations in x, y and z as implicit surfaces and keeps explicit ones on the grid', () => {
    const rows = sheet('x^2 + y^2 + z^2 = 4', 'x^2 + y^2 = z^2', 'x^2/4 + y^2 + z^2/9 = 1', 'x^2 + y^2 - z^2 = 1', 'z^2 - x^2 - y^2 = 1', 'z = x y / 4', 'x^2 + y^2 + z^2 < 4', 'x^2 + y^2 = k')
    const analyses = engine.analyze('space', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['implicit3', 'implicit3', 'implicit3', 'implicit3', 'implicit3', 'surface', 'error', 'error'])
    expect(analyses[7].error).toMatchObject({ key: 'error.unknown', missing: ['k'] })
    const camera = { yaw: -0.6, pitch: 0.45, range: 4 }
    const records = engine.space('space', rows, 600, 400, camera)
    for (const row of [0, 1, 2, 3, 4]) expect(records.filter((record) => record.kind === SPACE.polygon && record.row === row).length).toBeGreaterThan(300)
    expect(records.filter((record) => record.kind === SPACE.polygon && record.row === 5).length).toBe(64 * 64)
    for (const record of records) for (let i = 0; i < record.points.length; i += 2) {
      expect(record.points[i]).toBeGreaterThanOrEqual(0)
      expect(record.points[i]).toBeLessThanOrEqual(600)
    }
    // Orbiting projects the same surfaces again; depth order puts the far side first.
    const orbited = engine.space('space', rows, 600, 400, { ...camera, yaw: 0.9 })
    expect(orbited.filter((record) => record.kind === SPACE.polygon).length).toBe(records.filter((record) => record.kind === SPACE.polygon).length)
  })

  it('reads cylindrical rows with two ranges and draws them inside the cube', () => {
    const rows = sheet('r = 2', 'z = r^2', { text: 'r = 1 + cos(phi)', from: '0', to: 'π', from2: '-1', to2: '2' }, 'z = φ / 2', 'rho = theta', '(1, 0, 2)', 'a = 3', 'x = 1', { text: 'r = 2', from2: 'q' })
    const analyses = engine.analyze('cylindrical', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['coords', 'coords', 'coords', 'coords', 'coords', 'point3', 'param', 'error', 'error'])
    expect(analyses[0]).toMatchObject({ given: 'r', over: ['φ', 'z'], from: 0, from2: -Infinity, to2: Infinity })
    expect(analyses[0].to).toBeCloseTo(2 * Math.PI, 12)
    expect(analyses[1]).toMatchObject({ given: 'z', over: ['φ', 'r'], from2: 0, to2: Infinity })
    expect(analyses[2]).toMatchObject({ given: 'r', from: 0, from2: -1, to2: 2 })
    expect(analyses[2].to).toBeCloseTo(Math.PI, 12)
    expect(analyses[4]).toMatchObject({ given: 'r', over: ['φ', 'z'] })
    expect(analyses[5]).toMatchObject({ x: 1, y: 0, z: 2 })
    expect(analyses[8].error).toMatchObject({ key: 'error.unknown', missing: ['q'] })
    const records = engine.space('cylindrical', rows, 600, 400, { yaw: -0.6, pitch: 0.45, range: 5 })
    for (const row of [0, 1, 2, 3, 4]) expect(records.filter((record) => record.kind === SPACE.polygon && record.row === row).length).toBeGreaterThan(500)
    expect(records.filter((record) => record.kind === SPACE.point).map((record) => record.row)).toEqual([5])
    for (const record of records) for (let i = 0; i < record.points.length; i += 2) {
      expect(record.points[i]).toBeGreaterThanOrEqual(0)
      expect(record.points[i]).toBeLessThanOrEqual(600)
    }
  })

  it('reads spherical rows in the mathematics convention and draws them inside the cube', () => {
    const rows = sheet('ρ = 2', 'rho = 1 + cos(theta)', { text: 'φ = π/4', from2: '0', to2: '2' }, 'θ = π/3', 'r = 1', '(1, 0, 0)', 'z = 1', { text: 'ρ = 2', to2: '4' })
    const analyses = engine.analyze('spherical', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['coords', 'coords', 'coords', 'coords', 'coords', 'point3', 'error', 'coords'])
    expect(analyses[0]).toMatchObject({ given: 'ρ', over: ['θ', 'φ'], from: 0, from2: 0 })
    expect(analyses[0].to2).toBeCloseTo(Math.PI, 12)
    expect(analyses[2]).toMatchObject({ given: 'φ', over: ['θ', 'ρ'], from2: 0, to2: 2 })
    expect(analyses[3]).toMatchObject({ given: 'θ', over: ['φ', 'ρ'], to2: Infinity })
    expect(analyses[4].given).toBe('ρ')
    expect(analyses[5]).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(analyses[7]).toMatchObject({ from2: 0, to2: 4 })
    const records = engine.space('spherical', rows, 600, 400, { yaw: -0.6, pitch: 0.45, range: 3 })
    for (const row of [0, 1, 2, 3, 4]) expect(records.filter((record) => record.kind === SPACE.polygon && record.row === row).length).toBeGreaterThan(500)
    expect(records.filter((record) => record.kind === SPACE.point).map((record) => record.row)).toEqual([5])
  })

  it('reads complex numbers in every notation and draws relations as regions', () => {
    const rows = sheet('w = 2e^(iπ/3)', 'cos(φ) + i sin(φ)', 'φ = 0.8', '3 - 2i', '|z + 2| < 3', '|z - w| = 1', 'Re(z) ≥ 1', 'z^2')
    const analyses = engine.analyze('complex', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['cpoint', 'cpoint', 'param', 'cpoint', 'region', 'implicit', 'region', 'error'])
    expect(analyses[0].name).toBe('w')
    expect(analyses[0].x).toBeCloseTo(1, 12)
    expect(analyses[0].y).toBeCloseTo(Math.sqrt(3), 12)
    expect(analyses[3]).toMatchObject({ x: 3, y: -2 })
    expect(analyses[4].strict).toBe(true)
    expect(analyses[6].strict).toBe(false)
    expect(analyses[7].error?.key).toBe('error.relation')
    const paths = engine.sample('complex', rows, 400, 300, { cx: 0, cy: 0, scale: 20 })
    const disk = paths.filter((path) => path.row === 4)
    expect(disk.some((path) => path.kind === 'region')).toBe(true)
    expect(disk.filter((path) => path.kind === 'line')).toHaveLength(1)
    for (const path of disk.filter((path) => path.kind === 'region')) {
      for (let i = 0; i < path.points.length; i += STRIDE) expect(Math.hypot(path.points[i + 2] + 2, path.points[i + 3])).toBeLessThan(3.3)
    }
  })

  it('draws vector fields as centred arrows in the plane and in space', () => {
    const rows = sheet('F(x, y) = (-y, x)', '(y, -x)', '(1, 2)', '(x, t)', 'G(x) = (x, 1)', 'f(x, y) = x y', 'f(2, 3)')
    expect(engine.analyze('cartesian', rows).map((row) => row.kind)).toEqual(['field', 'field', 'point', 'error', 'error', 'contour', 'value'])
    expect(engine.analyze('cartesian', rows)[4].error?.key).toBe('error.field')
    expect(engine.analyze('cartesian', rows)[6].value).toBe(6)
    const paths = engine.sample('cartesian', rows, 400, 300, { cx: 0, cy: 0, scale: 20 }).filter((path) => path.row === 0)
    expect(paths.length).toBeGreaterThan(250)
    for (const path of paths) {
      expect(path.kind).toBe('arrow')
      expect(path.points.length).toBe(2 * STRIDE)
      const [tx, ty, hx, hy] = [path.points[0], path.points[1], path.points[STRIDE], path.points[STRIDE + 1]]
      expect(Math.hypot(hx - tx, hy - ty)).toBeLessThanOrEqual(0.9 * 20 + 1e-9)
      expect(path.points[STRIDE + 4]).toBeGreaterThan(0)
      expect(path.points[STRIDE + 4]).toBeLessThanOrEqual(1)
    }
    const space = sheet('F(x, y, z) = (-y, x, z / 4)', '(0, 0, 1 + 0z)', 'F(x, y) = (1, 2)')
    expect(engine.analyze('space', space).map((row) => row.kind)).toEqual(['field3', 'field3', 'error'])
    const records = engine.space('space', space, 600, 400, { yaw: -0.6, pitch: 0.45, range: 10 })
    expect(records.filter((record) => record.kind === SPACE.arrow && record.row === 0)).toHaveLength(342)
    expect(records.filter((record) => record.kind === SPACE.arrow && record.row === 1).every((record) => record.value === 1 && record.points.length === 4)).toBe(true)
  })

  it('draws the level curves of f(x, y) with their levels and on the floor under a surface', () => {
    const rows = sheet('f(x, y) = x^2 + y^2', { text: 'g(x, y) = x', step: '2.5' }, { text: 'h(x, y) = y', step: '-1' }, { text: 'k(x, y) = x y', levels: 4 })
    const analyses = engine.analyze('cartesian', rows)
    expect(analyses.map((row) => row.kind)).toEqual(['contour', 'contour', 'error', 'contour'])
    expect(analyses[0].name).toBe('f')
    expect(analyses[2].error?.key).toBe('error.step')
    const paths = engine.sample('cartesian', rows, 400, 300, { cx: 0, cy: 0, scale: 20 })
    const circles = paths.filter((path) => path.row === 0)
    expect(circles.length).toBeGreaterThan(3)
    for (const path of circles) {
      expect(path.kind).toBe('contour')
      const level = path.points[4]
      expect(level % 20).toBe(0)
      for (let i = 0; i < path.points.length; i += STRIDE) expect(Math.abs(path.points[i + 2] ** 2 + path.points[i + 3] ** 2 - level)).toBeLessThan(0.5)
    }
    expect([...new Set(paths.filter((path) => path.row === 1).map((path) => path.points[4]))]).toEqual([-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10])
    expect(new Set(paths.filter((path) => path.row === 3).map((path) => path.points[4])).size).toBeLessThanOrEqual(4)
    const space = sheet({ text: 'z = (x^2 + y^2) / 5 - 6', floor: true }, 'z = x y / 10', { text: 'f(x, y) = x - y', floor: true, levels: 3 })
    expect(engine.analyze('space', space).map((row) => row.kind)).toEqual(['surface', 'surface', 'surface'])
    const records = engine.space('space', space, 600, 400, { yaw: -0.6, pitch: 0.45, range: 10 })
    expect(records.filter((record) => record.kind === SPACE.contour && record.row === 0).length).toBeGreaterThan(200)
    expect(records.filter((record) => record.kind === SPACE.contour && record.row === 1)).toHaveLength(0)
    expect(new Set(records.filter((record) => record.kind === SPACE.contour && record.row === 2).map((record) => record.value)).size).toBeLessThanOrEqual(3)
  })

  it('shades inequalities on Cartesian sheets', () => {
    const rows = sheet('y > x^2', 'x^2 + y^2 ≤ 4')
    expect(engine.analyze('cartesian', rows)).toMatchObject([{ kind: 'region', strict: true }, { kind: 'region', strict: false }])
    expect(engine.sample('cartesian', rows, 400, 300, { cx: 0, cy: 0, scale: 20 }).filter((path) => path.kind === 'region').length).toBeGreaterThan(20)
  })
})
