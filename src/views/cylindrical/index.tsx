import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { SpaceView } from '../types'
import { piecewise, prod, sum, volumeCylindrical } from '../inserts'

/** An upright cylinder. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" /><path d="M12 12l5 -1.5" opacity={0.45} /></Svg>
)

/**
 * Cylindrical coordinates (r, φ, z): r is the distance from the z-axis, φ the azimuth in the xy-plane from +x and z
 * the height. A row gives one coordinate as a function of the other two, which run over the row's two ranges.
 */
export const cylindrical: SpaceView = {
  id: 'cylindrical',
  kernel: 7,
  canvas: 'space',
  icon: Icon,
  placeholder: 'z = r^2',
  examples: [['r = 1 + cos(φ)', '', '', '-4', '0'], ['z = φ / 2', '', '', '0', '3']],
  inserts: [sum('z = sum(n, 1, 3, r^n / 5)', 'r^n / 5'), prod('z = prod(n, 1, 2, r / n)', 'r / n'), piecewise('r = {φ < π: 1, 2}', 'φ < π'), volumeCylindrical],
  axisNames: ['x', 'y', 'z'],
  homeRange: 5,
  ranges: { r: ['0', '∞'], φ: ['0', '2π'], z: ['−∞', '∞'] }
}
