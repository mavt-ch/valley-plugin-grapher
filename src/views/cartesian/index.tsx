import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { planeGrid } from '../../draw'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'

/** Axes with a parabola. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 3v17h17" /><path d="M7.5 5c1.5 6 3.3 9 5.2 9s3.7-3 5.3-9" /></Svg>
)

/** y = f(x), x = g(y), equations and inequalities in x and y, points, on a decimal grid. */
export const cartesian: PlaneView = {
  id: 'cartesian',
  kernel: 0,
  canvas: 'plane',
  icon: Icon,
  placeholder: 'y = x^2',
  examples: ['y = x^2 - 2', 'y = a x + b', 'a = 1', 'b = 0'],
  homeSpan: 20,
  grid: planeGrid()
}
