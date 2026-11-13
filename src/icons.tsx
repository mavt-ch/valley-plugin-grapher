import { React } from './runtime'
import type { ReactElement, ReactNode } from 'react'

/** Inline stroke icons drawn with the host's React; monochrome through currentColor. */
export type IconProps = { className?: string }

export const Svg = ({ className, children }: IconProps & { children: ReactNode }): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
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

/** Six dots: the handle that drags a row to a new place. */
export const Grip = (p: IconProps): ReactElement => (
  <svg className={p.className} width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
)

export const Warning = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></Svg>
)

export const ChevronDown = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
)

export const Check = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
)

/** A small grid: a table of points. */
export const TableIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 10h16M12 5v14" /></Svg>
)

/** An arrow down onto a tray: export the graph as a file. */
export const Download = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>
)

export const Play = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></Svg>
)

export const Pause = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M8.5 6v12M15.5 6v12" /></Svg>
)

/** A curve with a line touching it: a tangent. */
export const TangentIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 18c4 0 6-10 10-10s4 4 6 6" /><path d="M5 13l14-8" /></Svg>
)

/** Small arrows turning round: a vector field. */
export const FieldIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 9l4-4M9 5H6M9 5v3M19 15l-4 4M15 19h3M15 19v-3M15 5l4 4M19 9V6M19 9h-3M9 19l-4-4M5 15v3M5 15h3" /></Svg>
)

/** Nested rings: level curves. */
export const LevelsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><ellipse cx="12" cy="12" rx="9" ry="6" /><ellipse cx="12" cy="12" rx="5" ry="3" /></Svg>
)

/** A curved sheet: a parametric surface. */
export const SurfaceIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 9c3-3 6 3 9 0s6-3 9 0M3 9v6c3-3 6 3 9 0s6-3 9 0V9" /></Svg>
)

/** A sphere: a surface F(x, y, z) = 0. */
export const SphereIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="8" ry="3" /></Svg>
)

/** A plane touching a dome: a tangent plane. */
export const PlaneIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 18a7 7 0 0 1 14 0" /><path d="M3 11l6-3h12l-6 3z" /></Svg>
)

export const Search = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>
)
