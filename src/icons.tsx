import { React } from './runtime'
import type { ReactElement, ReactNode } from 'react'

/** Inline stroke icons drawn with the host's React; monochrome through currentColor. */
type IconProps = { className?: string }

const Svg = ({ className, children }: IconProps & { children: ReactNode }): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

/** Axes with a parabola. */
export const Cartesian = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 3v17h17" /><path d="M7.5 5c1.5 6 3.3 9 5.2 9s3.7-3 5.3-9" /></Svg>
)

/** One period of a sine over its axis. */
export const Trig = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2 12h20" opacity={0.45} /><path d="M2 12c1.5-5 3.5-7 5-7s3.5 2 5 7s3.5 7 5 7s3.5-2 5-7" /></Svg>
)

/** Concentric circles and a ray. */
export const Polar = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6.4-6.4" /></Svg>
)

/** A closed plane curve. */
export const Parametric = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M9.828 9.172a4 4 0 1 0 0 5.656a10 10 0 0 0 2.172 -2.828a10 10 0 0 1 2.172 -2.828a4 4 0 1 1 0 5.656a10 10 0 0 1 -2.172 -2.828a10 10 0 0 0 -2.172 -2.828" /></Svg>
)

/** A cube in perspective. */
export const Space = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Svg>
)

/** The Gaussian plane: axes and a complex number as an arrow. */
export const Complex = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 20V3M4 20h17" opacity={0.45} /><path d="M4 20L15.5 8.5" /><path d="M11 8h5v5" /></Svg>
)

export const X = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>
)

export const Plus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)

export const Minus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 12h14" /></Svg>
)

/** Frame corners around the origin: back to the default view. */
export const Fit = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="1.5" /></Svg>
)

export const Eye = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>
)

export const EyeOff = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.3 6.3A17.3 17.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></Svg>
)

export const Trash = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>
)

export const Slider = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 12h16" /><circle cx="9" cy="12" r="2.5" /></Svg>
)
