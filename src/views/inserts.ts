import { FieldIcon, LevelsIcon, PlaneIcon, SphereIcon, SurfaceIcon, TableIcon, TangentIcon } from '../icons'
import type { Insert } from './types'

/** Insert-bar entries shared by the views; each view lists the ones its kernel mode accepts (`tests/inserts.test.tsx`). */
export const sum = (text: string, select: string): Insert => ({ id: 'sum', glyph: 'Σ', text, select })
export const prod = (text: string, select: string): Insert => ({ id: 'prod', glyph: '∏', text, select })
export const piecewise = (text: string, select: string): Insert => ({ id: 'piecewise', glyph: '{ }', text, select })
export const table: Insert = { id: 'table', glyph: TableIcon, text: 'table' }

export const integral: Insert = { id: 'int', glyph: '∫', text: 'int(sin(x), 0, π)', select: 'sin(x)' }
export const derivative: Insert = { id: 'derivative', glyph: 'f′', text: "f'(x)", needs: 'f(x) = x^3' }
export const tangent: Insert = { id: 'tangent', glyph: TangentIcon, text: 'tangent(x^2, 1)', select: 'x^2' }
export const field: Insert = { id: 'field', glyph: FieldIcon, text: 'F(x, y) = (-y, x)', select: '(-y, x)' }
export const levels: Insert = { id: 'levels', glyph: LevelsIcon, text: 'g(x, y) = x^2 - y^2', select: 'x^2 - y^2' }

export const psurface: Insert = { id: 'psurface', glyph: SurfaceIcon, text: '(u cos v, u sin v, v)', select: 'u cos v, u sin v, v' }
export const implicit3: Insert = { id: 'implicit3', glyph: SphereIcon, text: 'x^2 + y^2 + z^2 = 4', select: 'x^2 + y^2 + z^2' }
export const field3: Insert = { id: 'field3', glyph: FieldIcon, text: 'F(x, y, z) = (-y, x, 0)', select: '(-y, x, 0)' }
export const volume: Insert = { id: 'volume', glyph: '∬', text: 'int(6 - (x^2 + y^2) / 4, -3, 3, -3, 3)', select: '6 - (x^2 + y^2) / 4' }
export const volumeCylindrical: Insert = { id: 'volume3', glyph: '∭', text: 'int(1, 0, 2, 0, 2π, r, 2)', select: '1' }
export const volumeSpherical: Insert = { id: 'volume3', glyph: '∭', text: 'int(1, 0, 2, 0, 2π, 0, π/4)', select: '1' }
export const tplane: Insert = { id: 'tplane', glyph: PlaneIcon, text: 'tangent((x^2 + y^2) / 5 - 6, 3, 2)', select: '(x^2 + y^2) / 5 - 6' }
