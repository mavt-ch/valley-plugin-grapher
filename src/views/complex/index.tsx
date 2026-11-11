import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { planeGrid } from '../../draw'
import { Svg, type IconProps } from '../../icons'
import type { PlaneView } from '../types'

/** The Gaussian plane: axes and a complex number as an arrow. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 20V3M4 20h17" opacity={0.45} /><path d="M4 20L15.5 8.5" /><path d="M11 8h5v5" /></Svg>
)

/** Complex numbers as arrows from 0, and regions or curves in z. */
export const complex: PlaneView = {
  id: 'complex',
  kernel: 5,
  canvas: 'plane',
  icon: Icon,
  placeholder: '|z - 1| < 2',
  examples: ['w = 2e^(iπ/3)', 'cos(φ) + i sin(φ)', 'φ = 0.8', '|z + 2| < 3'],
  homeSpan: 12,
  grid: planeGrid({ imaginary: true }),
  units: 'decimal',
  complex: true
}
