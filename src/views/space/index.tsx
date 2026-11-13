import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { SpaceView } from '../types'
import { field3, implicit3, piecewise, prod, psurface, sum, tplane } from '../inserts'

/** A cube in perspective. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Svg>
)

/**
 * Surfaces z = f(x, y), x = f(y, z), y = f(x, z), parametric surfaces, space curves and points in an orbiting cube. A
 * triple names what it is by its variables: u and v make a surface, t a curve, numbers a point. The fresh paraboloid shows
 * its level curves on the floor of the cube, and the empty row suggests its tangent plane at (3, 2) with the normal.
 */
export const space: SpaceView = {
  id: 'space',
  kernel: 4,
  canvas: 'space',
  icon: Icon,
  placeholder: 'tangent((x^2 + y^2) / 5 - 6, 3, 2)',
  examples: [{ text: 'z = (x^2 + y^2) / 5 - 6', floor: true }, ['(6cos t, 6sin t, t / 2)', '0', '6π']],
  inserts: [sum('sum(n, 1, 3, (x + y)^n / 20)', '(x + y)^n / 20'), prod('prod(n, 1, 2, x - n)', 'x - n'), psurface, implicit3, field3, tplane, piecewise('{x < 0: -x, x^2 / 5}', 'x < 0')],
  axisNames: ['x', 'y', 'z']
}
