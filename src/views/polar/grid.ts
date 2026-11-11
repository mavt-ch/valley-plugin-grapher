import { axes, haloText, labels, toScreenX, toScreenY, toWorldX, type GridPainter, type Size } from '../../draw'
import { decimalAxis, decimalStep, formatNumber, formatPi } from '../../ticks'

/** Where a ray from the origin leaves the view (inset for its label), or null when it misses it. */
function rayExit(ox: number, oy: number, dx: number, dy: number, size: Size): [number, number] | null {
  const box = [[22, size.width - 22], [12, size.height - 12]] as const
  let enter = 0
  let exit = Infinity
  for (const [origin, direction, [min, max]] of [[ox, dx, box[0]], [oy, dy, box[1]]] as const) {
    if (Math.abs(direction) < 1e-12) {
      if (origin < min || origin > max) return null
      continue
    }
    const a = (min - origin) / direction
    const b = (max - origin) / direction
    enter = Math.max(enter, Math.min(a, b))
    exit = Math.min(exit, Math.max(a, b))
  }
  return exit > enter && Number.isFinite(exit) ? [ox + dx * exit, oy + dy * exit] : null
}

/** Circles at the decimal steps, rays every π/12 labelled every π/6. */
export const polarGrid: GridPainter = (ctx, view, size, theme) => {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, size.width, size.height)
  const ox = toScreenX(view, size, 0)
  const oy = toScreenY(view, size, 0)
  const corners = [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - ox, y - oy)))
  const inside = ox >= 0 && ox <= size.width && oy >= 0 && oy <= size.height
  const nearX = Math.max(0, Math.min(size.width, ox))
  const nearY = Math.max(0, Math.min(size.height, oy))
  const near = inside ? 0 : Math.hypot(nearX - ox, nearY - oy)
  const { major, divisions } = decimalStep(view.scale)
  const minor = major / divisions
  const first = Math.max(1, Math.floor(near / view.scale / minor))
  const last = Math.ceil(far / view.scale / minor)
  ctx.lineWidth = 1
  if (last - first < 600) {
    for (const wantMajor of [false, true]) {
      ctx.strokeStyle = wantMajor ? theme.major : theme.minor
      ctx.beginPath()
      for (let k = first; k <= last; k++) {
        if ((k % divisions === 0) !== wantMajor) continue
        const radius = k * minor * view.scale
        ctx.moveTo(ox + radius, oy)
        ctx.arc(ox, oy, radius, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
  }
  // Rays every π/12, stronger every π/6; the 0 and π/2 rays are the axes.
  for (let k = 0; k < 12; k++) {
    if (k % 6 === 0) continue
    const angle = (k * Math.PI) / 12
    ctx.strokeStyle = k % 2 === 0 ? theme.major : theme.minor
    ctx.beginPath()
    ctx.moveTo(ox - Math.cos(angle) * far, oy + Math.sin(angle) * far)
    ctx.lineTo(ox + Math.cos(angle) * far, oy - Math.sin(angle) * far)
    ctx.stroke()
  }
  axes(ctx, view, size, theme)
  const lo = toWorldX(view, size, 0)
  const hi = toWorldX(view, size, size.width)
  const radii = decimalAxis(lo, hi, view.scale)
  // Radii read as distances; the outermost ones would sit under the 0 and π angle labels.
  const clear = (label: { value: number }): boolean => { const sx = toScreenX(view, size, label.value); return sx > 44 && sx < size.width - 44 }
  labels(ctx, { ...radii, labels: radii.labels.filter(clear).map((label) => ({ ...label, text: formatNumber(Math.abs(label.value), 6) })) }, null, view, size, theme)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let k = 0; k < 12; k++) {
    const angle = (k * Math.PI) / 6
    const at = rayExit(ox, oy, Math.cos(angle), -Math.sin(angle), size)
    // The 0 and π labels sit just above the horizontal axis, not on its line.
    if (at) haloText(ctx, theme, formatPi(k, 6), at[0], k % 6 === 0 ? at[1] - 9 : at[1])
  }
}
