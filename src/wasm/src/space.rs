//! 3D sheets for an orbiting camera. The visible world is the cube [-range, range]³; surfaces are sampled on a
//! grid over their two free axes and clipped to the cube, space curves are clipped segment by segment, and
//! everything is projected orthographically, shaded by its normal and returned back to front so the canvas only
//! has to fill in order. The frame (box, floor grid, axes, tick labels) comes first in the same stream.
//!
//! Records: `[kind, row or axis, shade or value, count]`, then `count` screen points `[x, y]`.

use std::f64::consts::TAU;

use crate::eval::{Expr, UserFn, eval};
use crate::sheet::{Axis3, Plot, Sheet, T, X, Y, Z};

pub const POLYGON: f64 = 0.0;
pub const SEGMENT: f64 = 1.0;
pub const POINT: f64 = 2.0;
pub const BOX: f64 = 10.0;
pub const GRID: f64 = 11.0;
pub const GRID_MAJOR: f64 = 12.0;
pub const AXIS: f64 = 13.0;
pub const TICK: f64 = 14.0;
pub const AXIS_NAME: f64 = 15.0;

/// Grid cells per surface axis.
const CELLS: usize = 64;
/// Light direction in camera space (right, up, toward the viewer), normalized at use.
const LIGHT: [f64; 3] = [-0.35, 0.55, 1.0];

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub width: f64,
    pub height: f64,
    /// Rotation about the z-axis.
    pub yaw: f64,
    /// Elevation above the xy-plane.
    pub pitch: f64,
    /// Half the edge of the visible cube.
    pub range: f64,
}

impl Camera {
    fn valid(&self) -> bool {
        self.width > 0.0 && self.height > 0.0 && self.range > 0.0 && [self.width, self.height, self.yaw, self.pitch, self.range].iter().all(|v| v.is_finite())
    }
}

type Vec3 = [f64; 3];

fn lerp(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn normalize(a: Vec3) -> Option<Vec3> {
    let length = dot(a, a).sqrt();
    (length > 0.0 && length.is_finite()).then(|| [a[0] / length, a[1] / length, a[2] / length])
}

/// A 1, 2 or 5 × 10ⁿ step at least `raw`.
fn nice(raw: f64) -> f64 {
    let base = 10_f64.powf(raw.log10().floor());
    let ratio = raw / base;
    base * if ratio <= 1.0 { 1.0 } else if ratio <= 2.0 { 2.0 } else if ratio <= 5.0 { 5.0 } else { 10.0 }
}

struct Projector {
    cx: f64,
    cy: f64,
    scale: f64,
    cos_yaw: f64,
    sin_yaw: f64,
    cos_pitch: f64,
    sin_pitch: f64,
}

impl Projector {
    fn new(camera: &Camera) -> Self {
        Self {
            cx: camera.width / 2.0,
            cy: camera.height / 2.0,
            // The cube's projected extent stays below √3 · range; keep a margin for the axis names.
            scale: camera.width.min(camera.height) * 0.29 / camera.range,
            cos_yaw: camera.yaw.cos(),
            sin_yaw: camera.yaw.sin(),
            cos_pitch: camera.pitch.cos(),
            sin_pitch: camera.pitch.sin(),
        }
    }

    /// Camera-space coordinates: right, up and toward the viewer.
    fn view(&self, p: Vec3) -> Vec3 {
        let x = p[0] * self.cos_yaw - p[1] * self.sin_yaw;
        let y = p[0] * self.sin_yaw + p[1] * self.cos_yaw;
        [x, y * self.sin_pitch + p[2] * self.cos_pitch, -y * self.cos_pitch + p[2] * self.sin_pitch]
    }

    /// Screen x, screen y and depth (larger is nearer).
    fn screen(&self, p: Vec3) -> (f64, f64, f64) {
        let v = self.view(p);
        (self.cx + self.scale * v[0], self.cy - self.scale * v[1], v[2])
    }
}

struct Item {
    kind: f64,
    row: f64,
    shade: f64,
    depth: f64,
    points: Vec<(f64, f64)>,
}

#[derive(Default)]
struct Records(Vec<f64>);

impl Records {
    fn push(&mut self, kind: f64, row: f64, value: f64, points: &[(f64, f64)]) {
        self.0.extend([kind, row, value, points.len() as f64]);
        for (x, y) in points {
            self.0.extend([*x, *y]);
        }
    }
}

/// Keeps the part of a polygon on one side of `p[axis] = limit` (Sutherland–Hodgman for one plane).
fn clip(polygon: &[Vec3], axis: usize, limit: f64, upper: bool) -> Vec<Vec3> {
    let inside = |p: &Vec3| if upper { p[axis] <= limit } else { p[axis] >= limit };
    let mut out = Vec::with_capacity(polygon.len() + 2);
    for (i, a) in polygon.iter().enumerate() {
        let b = polygon[(i + 1) % polygon.len()];
        if inside(a) {
            out.push(*a);
        }
        if inside(a) != inside(&b) {
            out.push(lerp(*a, b, (limit - a[axis]) / (b[axis] - a[axis])));
        }
    }
    out
}

/// The part of a segment inside the cube (Liang–Barsky).
fn clip_segment(a: Vec3, b: Vec3, range: f64) -> Option<(Vec3, Vec3)> {
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    for k in 0..3 {
        let d = b[k] - a[k];
        for (p, q) in [(-d, a[k] + range), (d, range - a[k])] {
            if p == 0.0 {
                if q < 0.0 {
                    return None;
                }
                continue;
            }
            let t = q / p;
            if p < 0.0 {
                if t > t1 {
                    return None;
                }
                t0 = t0.max(t);
            } else {
                if t < t0 {
                    return None;
                }
                t1 = t1.min(t);
            }
        }
    }
    Some((lerp(a, b, t0), lerp(a, b, t1)))
}

struct Scene<'a> {
    camera: Camera,
    projector: Projector,
    env: &'a mut [f64],
    functions: &'a [UserFn],
    items: Vec<Item>,
}

impl Scene<'_> {
    fn surface(&mut self, row: f64, expr: &Expr, axis: Axis3) {
        let range = self.camera.range;
        // The two grid axes as (env slot, coordinate index), then the coordinate the expression gives.
        let (u, v, w) = match axis {
            Axis3::Z => ((X, 0), (Y, 1), 2),
            Axis3::X => ((Y, 1), (Z, 2), 0),
            Axis3::Y => ((X, 0), (Z, 2), 1),
        };
        let at = |i: usize| -range + 2.0 * range * i as f64 / CELLS as f64;
        let stride = CELLS + 1;
        let mut grid = vec![[0.0; 3]; stride * stride];
        for j in 0..=CELLS {
            for i in 0..=CELLS {
                let mut p = [0.0; 3];
                p[u.1] = at(i);
                p[v.1] = at(j);
                self.env[u.0] = p[u.1];
                self.env[v.0] = p[v.1];
                p[w] = eval(expr, self.env, self.functions);
                grid[j * stride + i] = p;
            }
        }
        let light = normalize(LIGHT).unwrap_or([0.0, 0.0, 1.0]);
        for j in 0..CELLS {
            for i in 0..CELLS {
                let quad = [grid[j * stride + i], grid[j * stride + i + 1], grid[(j + 1) * stride + i + 1], grid[(j + 1) * stride + i]];
                if quad.iter().any(|p| !p[w].is_finite()) {
                    continue;
                }
                // A cell rising through the whole cube straddles an asymptote, not a surface.
                if quad.iter().any(|p| p[w] > range) && quad.iter().any(|p| p[w] < -range) {
                    continue;
                }
                let clipped = clip(&clip(&quad, w, range, true), w, -range, false);
                if clipped.len() < 3 {
                    continue;
                }
                let normal = normalize(cross(sub(quad[2], quad[0]), sub(quad[3], quad[1])));
                let shade = normal.map_or(0.6, |n| 0.3 + 0.7 * dot(normalize(self.projector.view(n)).unwrap_or(n), light).abs());
                self.push(POLYGON, row, shade, &clipped);
            }
        }
    }

    fn curve(&mut self, row: f64, (x, y, z): (&Expr, &Expr, &Expr), from: f64, to: f64) {
        let span = to - from;
        if !span.is_finite() || span == 0.0 {
            return;
        }
        let n = ((span.abs() / TAU) * 360.0).ceil().clamp(64.0, 6000.0) as usize;
        let mut previous: Option<Vec3> = None;
        for k in 0..=n {
            self.env[T] = from + span * (k as f64 / n as f64);
            let p = [eval(x, self.env, self.functions), eval(y, self.env, self.functions), eval(z, self.env, self.functions)];
            let finite = p.iter().all(|v| v.is_finite());
            if let (Some(a), true) = (previous, finite)
                && let Some((a, b)) = clip_segment(a, p, self.camera.range)
            {
                self.push(SEGMENT, row, 1.0, &[a, b]);
            }
            previous = finite.then_some(p);
        }
    }

    fn point(&mut self, row: f64, p: Vec3) {
        if p.iter().all(|v| v.is_finite() && v.abs() <= self.camera.range) {
            self.push(POINT, row, 1.0, &[p]);
        }
    }

    fn push(&mut self, kind: f64, row: f64, shade: f64, points: &[Vec3]) {
        let projected: Vec<(f64, f64, f64)> = points.iter().map(|p| self.projector.screen(*p)).collect();
        let depth = projected.iter().map(|p| p.2).sum::<f64>() / projected.len() as f64;
        self.items.push(Item { kind, row, shade, depth, points: projected.into_iter().map(|p| (p.0, p.1)).collect() });
    }
}

/// The cube, the floor grid at z = 0, the axes, tick labels every five grid steps and the axis names.
fn frame(out: &mut Records, camera: &Camera, projector: &Projector) {
    let r = camera.range;
    let line = |out: &mut Records, kind: f64, axis: f64, a: Vec3, b: Vec3| {
        let (ax, ay, _) = projector.screen(a);
        let (bx, by, _) = projector.screen(b);
        out.push(kind, axis, 0.0, &[(ax, ay), (bx, by)]);
    };
    for corner in 0..8_u32 {
        let p = |bits: u32| [if bits & 1 == 0 { -r } else { r }, if bits & 2 == 0 { -r } else { r }, if bits & 4 == 0 { -r } else { r }];
        for bit in [1, 2, 4] {
            if corner & bit == 0 {
                line(out, BOX, 0.0, p(corner), p(corner | bit));
            }
        }
    }
    let step = nice(r / 10.0);
    let count = (r / step).floor() as i64;
    if count <= 200 {
        for k in -count..=count {
            if k == 0 {
                continue;
            }
            let value = k as f64 * step;
            let kind = if k % 5 == 0 { GRID_MAJOR } else { GRID };
            line(out, kind, 0.0, [value, -r, 0.0], [value, r, 0.0]);
            line(out, kind, 0.0, [-r, value, 0.0], [r, value, 0.0]);
        }
    }
    let unit = |axis: usize, value: f64| {
        let mut p = [0.0; 3];
        p[axis] = value;
        p
    };
    for axis in 0..3 {
        line(out, AXIS, axis as f64, unit(axis, -r), unit(axis, r));
        let label = step * 5.0;
        let ticks = (r / label).floor() as i64;
        for k in -ticks..=ticks {
            if k != 0 {
                let (x, y, _) = projector.screen(unit(axis, k as f64 * label));
                out.push(TICK, axis as f64, k as f64 * label, &[(x, y)]);
            }
        }
        let (x, y, _) = projector.screen(unit(axis, r * 1.12));
        out.push(AXIS_NAME, axis as f64, 0.0, &[(x, y)]);
    }
}

pub fn render(sheet: &mut Sheet, camera: Camera) -> Vec<f64> {
    let mut out = Records::default();
    if !camera.valid() {
        return out.0;
    }
    let projector = Projector::new(&camera);
    frame(&mut out, &camera, &projector);
    let Sheet { env, functions, rows, .. } = sheet;
    let mut scene = Scene { camera, projector, env: env.as_mut_slice(), functions: functions.as_slice(), items: Vec::new() };
    for (index, row) in rows.iter().enumerate() {
        let Some(plot) = row.plot().filter(|_| !row.hidden) else { continue };
        let index = index as f64;
        match plot {
            Plot::Surface { expr, axis } => scene.surface(index, expr, *axis),
            Plot::Curve3 { x, y, z, from, to } => scene.curve(index, (x, y, z), *from, *to),
            Plot::Point3 { x, y, z } => scene.point(index, [*x, *y, *z]),
            _ => {}
        }
    }
    // Far items first; points and curves win ties so they stay visible on a surface.
    scene.items.sort_by(|a, b| a.depth.total_cmp(&b.depth).then(a.kind.total_cmp(&b.kind)));
    for item in &scene.items {
        out.push(item.kind, item.row, item.shade, &item.points);
    }
    out.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{Mode, RowInput, analyze};

    const CAMERA: Camera = Camera { width: 600.0, height: 400.0, yaw: -0.6, pitch: 0.45, range: 10.0 };

    struct Record {
        kind: f64,
        row: f64,
        value: f64,
        points: Vec<(f64, f64)>,
    }

    fn records(texts: &[&str], camera: Camera) -> Vec<Record> {
        let inputs: Vec<RowInput> = texts.iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        let mut sheet = analyze(Mode::Space, &inputs);
        let data = render(&mut sheet, camera);
        let mut out = Vec::new();
        let mut at = 0;
        while at < data.len() {
            let count = data[at + 3] as usize;
            let points = (0..count).map(|i| (data[at + 4 + 2 * i], data[at + 5 + 2 * i])).collect();
            out.push(Record { kind: data[at], row: data[at + 1], value: data[at + 2], points });
            at += 4 + 2 * count;
        }
        out
    }

    #[test]
    fn the_frame_comes_first_with_box_grid_axes_and_labels() {
        let found = records(&[], CAMERA);
        assert_eq!(found.iter().filter(|r| r.kind == BOX).count(), 12);
        assert_eq!(found.iter().filter(|r| r.kind == AXIS).count(), 3);
        assert_eq!(found.iter().filter(|r| r.kind == AXIS_NAME).count(), 3);
        // Grid step 1 at range 10: 20 lines per direction besides the axis, ticks at ±5 and ±10.
        assert_eq!(found.iter().filter(|r| r.kind == GRID || r.kind == GRID_MAJOR).count(), 40);
        let ticks: Vec<f64> = found.iter().filter(|r| r.kind == TICK && r.row == 0.0).map(|r| r.value).collect();
        assert_eq!(ticks, [-10.0, -5.0, 5.0, 10.0]);
        for record in &found {
            for (x, y) in &record.points {
                assert!((0.0..=CAMERA.width).contains(x) && (0.0..=CAMERA.height).contains(y), "{x}, {y}");
            }
        }
    }

    #[test]
    fn a_paraboloid_is_clipped_to_the_cube_and_sorted_back_to_front() {
        let found = records(&["x^2 + y^2"], CAMERA);
        let polygons: Vec<&Record> = found.iter().filter(|r| r.kind == POLYGON).collect();
        assert!(polygons.len() > 200, "{} polygons", polygons.len());
        assert!(polygons.iter().all(|p| p.row == 0.0 && (0.3..=1.0).contains(&p.value) && p.points.len() >= 3));
        // Everything kept lies inside the projected cube.
        for polygon in &polygons {
            for (x, y) in &polygon.points {
                assert!((0.0..=CAMERA.width).contains(x) && (0.0..=CAMERA.height).contains(y));
            }
        }
        let first_item = found.iter().position(|r| r.kind < BOX).unwrap();
        assert!(found[first_item..].iter().all(|r| r.kind < BOX));
    }

    #[test]
    fn surfaces_along_each_axis_curves_and_points() {
        let found = records(&["z = 2", "x = y z / 10", "y = sin(x) + z / 5", "(5cos t, 5sin t, t / 2)", "(1, 2, 3)", "(1, 2, 30)"], CAMERA);
        for row in 0..3 {
            assert!(found.iter().filter(|r| r.kind == POLYGON && r.row == row as f64).count() > 1000, "row {row}");
        }
        let segments = found.iter().filter(|r| r.kind == SEGMENT && r.row == 3.0).count();
        assert!(segments > 300, "{segments} segments");
        assert_eq!(found.iter().filter(|r| r.kind == POINT).map(|r| r.row).collect::<Vec<_>>(), [4.0]);
    }

    #[test]
    fn asymptotes_and_hidden_rows_draw_nothing_across_the_cube() {
        let found = records(&["1/x"], CAMERA);
        let projector = Projector::new(&CAMERA);
        let (_, top, _) = projector.screen([0.0, 0.0, 10.0]);
        let (_, bottom, _) = projector.screen([0.0, 0.0, -10.0]);
        let tall = (bottom - top).abs() * 0.9;
        for polygon in found.iter().filter(|r| r.kind == POLYGON) {
            let ys = polygon.points.iter().map(|p| p.1);
            let (low, high) = ys.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), y| (lo.min(y), hi.max(y)));
            assert!(high - low < tall, "a wall spans the cube");
        }
        let inputs = [RowInput { text: "x + y".into(), hidden: true, ..RowInput::default() }];
        let mut sheet = analyze(Mode::Space, &inputs);
        let data = render(&mut sheet, CAMERA);
        let mut at = 0;
        while at < data.len() {
            assert!(data[at] >= BOX, "a hidden row was drawn");
            at += 4 + 2 * data[at + 3] as usize;
        }
    }
}
