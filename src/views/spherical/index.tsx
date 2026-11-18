import { React } from '../../runtime'
import type { ReactElement } from 'react'
import { Svg, type IconProps } from '../../icons'
import type { SpaceView } from '../types'
import { piecewise, prod, sum, volumeSpherical } from '../inserts'

/** A sphere with its equator and a meridian. */
const Icon = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="9" ry="3.2" opacity={0.45} /><ellipse cx="12" cy="12" rx="3.2" ry="9" /></Svg>
)

/**
 * Spherical coordinates (ρ, θ, φ) in the mathematics convention: ρ is the distance from the origin, θ the azimuth in
 * the xy-plane from +x and φ the polar angle from +z. A row gives one coordinate as a function of the other two,
 * which run over the row's two ranges; the examples make an ice-cream cone.
 */
export const spherical: SpaceView = {
  id: 'spherical',
  kernel: 8,
  canvas: 'space',
  icon: Icon,
  placeholder: 'ρ = 1 + cos(θ)',
  examples: [['ρ = 2', '', '', '0', 'π/4'], ['φ = π/4', '', '', '0', '2']],
  inserts: [sum('ρ = 2 + sum(n, 1, 3, cos(n θ) / n)', 'cos(n θ) / n'), prod('ρ = prod(n, 1, 2, 1 + φ / n)', '1 + φ / n'), piecewise('ρ = {θ < π: 1, 2}', 'θ < π'), volumeSpherical],
  axisNames: ['x', 'y', 'z'],
  homeRange: 3,
  ranges: { θ: ['0', '2π'], φ: ['0', 'π'], ρ: ['0', '∞'] }
}
