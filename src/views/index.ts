import { cartesian } from './cartesian'
import { complex } from './complex'
import { complexSpace } from './complexSpace'
import { parametric } from './parametric'
import { polar } from './polar'
import { space } from './space'
import type { Mode, ViewDefinition } from './types'

export type { AxisUnits, Example, Mode, PlaneView, SpaceView, ViewDefinition } from './types'

/** The views in header order. */
export const VIEWS: readonly ViewDefinition[] = [cartesian, polar, parametric, space, complex, complexSpace]
export const MODES: readonly Mode[] = VIEWS.map((view) => view.id)

const BY_ID = new Map<Mode, ViewDefinition>(VIEWS.map((view) => [view.id, view]))

export function viewOf(mode: Mode): ViewDefinition {
  return BY_ID.get(mode) ?? cartesian
}
