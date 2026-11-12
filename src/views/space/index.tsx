import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { SpaceView } from '../types'

/** A cube in perspective. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Svg>
)

/**
 * Surfaces z = f(x, y), x = f(y, z), y = f(x, z), parametric surfaces, space curves and points in an orbiting cube. A
 * triple names what it is by its variables: u and v make a surface, t a curve, numbers a point.
 */
export const space: SpaceView = {
  id: 'space',
  kernel: 4,
  canvas: 'space',
  icon: Icon,
  placeholder: '(u cos v, u sin v, v)',
  examples: ['z = (x^2 + y^2) / 5 - 6', ['(6cos t, 6sin t, t / 2)', '0', '6π']],
  axisNames: ['x', 'y', 'z']
}
