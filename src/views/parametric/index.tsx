import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { planeGrid } from '../../draw'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'

/** A closed plane curve. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M9.828 9.172a4 4 0 1 0 0 5.656a10 10 0 0 0 2.172 -2.828a10 10 0 0 1 2.172 -2.828a4 4 0 1 1 0 5.656a10 10 0 0 1 -2.172 -2.828a10 10 0 0 0 -2.172 -2.828" /></Svg>
)

/** Plane curves (x(t), y(t)) over a t range. */
export const parametric: PlaneView = {
  id: 'parametric',
  kernel: 3,
  canvas: 'plane',
  icon: Icon,
  placeholder: '(cos t, sin(2t))',
  examples: ['(cos(3t), sin(2t))', ['(0.2t cos t, 0.2t sin t)', '0', '6π']],
  homeSpan: 10,
  grid: planeGrid(),
  units: 'decimal'
}
