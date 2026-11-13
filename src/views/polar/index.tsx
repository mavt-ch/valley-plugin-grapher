import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'
import { piecewise, prod, sum, table } from '../inserts'
import { polarGrid } from './grid'

/** Concentric circles and a ray. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6.4-6.4" /></Svg>
)

/** r = f(θ) over a θ range, on circles and rays labelled in radians (multiples of π or decimals). */
export const polar: PlaneView = {
  id: 'polar',
  kernel: 2,
  canvas: 'plane',
  icon: Icon,
  placeholder: 'r = 2cos(3θ)',
  examples: ['r = 1 + cos(θ)', 'r = 2 sin(3θ)'],
  inserts: [sum('r = sum(n, 1, 5, cos(n θ) / n)', 'cos(n θ) / n'), prod('r = prod(n, 1, 2, θ / n)', 'θ / n'), piecewise('r = {θ < π: 1, 2}', 'θ < π'), table],
  homeSpan: 8,
  grid: polarGrid,
  units: 'pi'
}
