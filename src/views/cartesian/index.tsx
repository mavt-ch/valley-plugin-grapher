import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { planeGrid } from '../../draw'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'
import { derivative, field, integral, levels, piecewise, prod, sum, table, tangent } from '../inserts'

/** Axes with a parabola. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 3v17h17" /><path d="M7.5 5c1.5 6 3.3 9 5.2 9s3.7-3 5.3-9" /></Svg>
)

/**
 * y = f(x), x = g(y), derivatives, integrals and tangents, equations and inequalities in x and y, points, vector fields and
 * level curves; the x-axis in decimals or multiples of π. The empty row suggests an integral (a shaded area with its value),
 * the fresh sheet keeps its two lines and sliders.
 */
export const cartesian: PlaneView = {
  id: 'cartesian',
  kernel: 0,
  canvas: 'plane',
  icon: Icon,
  placeholder: 'int(sin(x), 0, π)',
  examples: ['y = x^2 - 2', 'y = a x + b', 'a = 1', 'b = 0'],
  inserts: [sum('sum(n, 1, 5, x^n / n)', 'x^n / n'), prod('prod(n, 1, 3, x - n)', 'x - n'), integral, derivative, tangent, piecewise('{x < 0: -x, x^2}', 'x < 0'), field, levels, table],
  homeSpan: 20,
  grid: planeGrid(),
  units: 'decimal'
}
