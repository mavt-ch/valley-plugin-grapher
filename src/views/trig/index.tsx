import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { planeGrid } from '../../draw'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'

/** One period of a sine over its axis. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2 12h20" opacity={0.45} /><path d="M2 12c1.5-5 3.5-7 5-7s3.5 2 5 7s3.5 7 5 7s3.5-2 5-7" /></Svg>
)

/** Cartesian rows with the x-axis in multiples of π. */
export const trig: PlaneView = {
  id: 'trig',
  kernel: 1,
  canvas: 'plane',
  icon: Icon,
  placeholder: 'y = sin(2x)',
  examples: ['sin(x)', 'cos(x)', 'y = A sin(k x)', 'A = 2', 'k = 0.5'],
  homeSpan: 4 * Math.PI + 1,
  grid: planeGrid({ xAxis: 'pi' })
}
