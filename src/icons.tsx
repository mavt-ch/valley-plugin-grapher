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
