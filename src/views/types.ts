import type { ReactElement } from 'react'
import type { AxisUnits, GridPainter } from '../draw'

export type { AxisUnits }

/**
 * Every view of Grapher, one folder each under `src/views/<id>/`. A new view adds its id here, its folder with a
 * `ViewDefinition`, an entry in `src/views/index.ts`, a kernel mode in `src/wasm/src/sheet.rs` and its locale keys
 * (`mode.<id>`, `mode.<id>.hint`, `hint.<id>`).
 */
export type Mode = 'cartesian' | 'polar' | 'parametric' | 'space' | 'cylindrical' | 'complex' | 'complexSpace'

/** An example row of a fresh sheet: its text, or its text with a parameter range (and a second one for a surface). */
export type Example = string | readonly [text: string, from: string, to: string] | readonly [text: string, from: string, to: string, from2: string, to2: string]

interface CommonView {
  id: Mode
  /** The kernel's mode number (`plot_analyze`). */
  kernel: number
  icon: (props: { className?: string }) => ReactElement
  /** Shown in the empty last row. */
  placeholder: string
  examples: readonly Example[]
}

/** A flat view: pan and zoom over a grid. */
export interface PlaneView extends CommonView {
  canvas: 'plane'
  /** Units across the width of a fresh view. */
  homeSpan: number
  grid: GridPainter
  /** The axis labels a fresh sheet uses; the header switch flips between decimal numbers and multiples of π. */
  units: AxisUnits
  /** Complex numbers as arrows from 0 and readouts as `a + bi`. */
  complex?: boolean
}

/** An orbiting 3D view inside a cube. */
export interface SpaceView extends CommonView {
  canvas: 'space'
  axisNames: readonly [string, string, string]
  /** Half the edge of the cube a fresh or reset view shows; 10 when not given. */
  homeRange?: number
  /** Surfaces in curvilinear coordinates: the placeholders of each coordinate's empty range fields. */
  ranges?: Readonly<Record<string, readonly [from: string, to: string]>>
}

export type ViewDefinition = PlaneView | SpaceView
