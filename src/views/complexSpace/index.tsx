import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { SpaceView } from '../types'

/** A surface rising over the complex plane. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2.5 17.5l6.5 3.5 12.5-5-6.5-3.5z" opacity={0.45} /><path d="M5.5 17.5C7 9 9.5 4 12 4s4 5.5 4.5 10.5" /><path d="M9 21l3-17" opacity={0.45} /></Svg>
)

/**
 * The complex plane as the floor of a 3D cube: `w = f(z)` rises to |f(z)| and is coloured by arg f(z) around the
 * colour wheel (red is a positive real value); a real-valued row such as `Re(z^2) / 5` rises to its signed
 * value instead. Numbers sit on the floor as points.
 */
export const complexSpace: SpaceView = {
  id: 'complexSpace',
  kernel: 6,
  canvas: 'space',
  icon: Icon,
  placeholder: 'w = (z^2 - 1) / z',
  examples: ['w = (z^2 - 4) / 4', 'Re(z^2) / 5', '1 + 2i'],
  axisNames: ['Re', 'Im', '|w|']
}
