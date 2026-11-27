//! Screen-space sampling of a sheet's plots for one viewport. Functions start at one sample per CSS pixel and
//! curves at 720 per turn; an interval is bisected while its midpoint strays from the chord or the chord is
//! long, so curvature, domain edges and asymptotes get detail and straight stretches stay cheap. A chord that is
//! still long at the deepest level spans a jump and is left out instead of drawn as a vertical line.
//!
//! Relations over the plane (`x^2 + y^2 = 1`, `y > x^2`, `|z + 2| < 3`) are sampled on a grid of cells: marching
//! squares traces where the field crosses zero (joined into polylines), and regions are filled from whole cells plus the clipped parts of
//! the cells their boundary passes through.
//!
//! A vector field is drawn as one arrow per point of a square lattice in world coordinates whose spacing is a 1, 2 or
//! 5 × 10ⁿ step nearest to a twentieth of the view's width, so about 13 to 32 arrows cross it at any zoom and they keep
//! their places while panning. Each arrow is centred on its lattice point; its length is the cell's width times the
//! magnitude relative to the 90th percentile of the magnitudes in view, capped at nine tenths of the cell, so no arrow
//! reaches into a neighbour's cell.
//!
//! The level curves of `f(x, y) = …` are traced by the same marching squares, once per level: at most the row's count of
//! levels on round multiples of a 1, 2 or 5 × 10ⁿ step across the values in view (from the 2nd to the 98th percentile,
//! so a pole does not swallow the range), or every multiple of the row's own step; each path carries its level.
//!
//! Output is one flat `f64` stream of paths: `[row, kind, count]`, then `count` points of
//! `[screen x, screen y, world x, world y, parameter]`. An arrow is two points, tail then head; the tail's parameter
//! is the magnitude |F| and the head's the magnitude relative to the view's reference, in [0, 1].

use std::f64::consts::TAU;

use crate::complex::{self, C64, CUserFn};
use crate::eval::{Expr, UserFn, eval};
use crate::parser::Relation;
use crate::sheet::{Field, Levels, Plot, Sheet, T, THETA, X, Y, Z};

pub const LINE: f64 = 0.0;
pub const POINT: f64 = 1.0;
/// One level curve; every point's parameter is its level.
pub const CONTOUR: f64 = 2.0;
/// One filled polygon of a region.
pub const REGION: f64 = 3.0;
/// One arrow of a vector field.
pub const ARROW: f64 = 4.0;
pub const STRIDE: usize = 5;

/// Lattice steps across the view's width that a vector field aims for (see the module notes).
const ARROWS_ACROSS: f64 = 20.0;
/// The most arrows one field draws; a taller view coarsens its lattice.
const ARROW_BUDGET: usize = 2500;
/// The share of a lattice cell the longest arrow spans.
const ARROW_REACH: f64 = 0.9;
/// The most level curves one row draws in view; a finer step is coarsened to stay below it.
const LEVEL_BUDGET: usize = 200;

const FUNCTION_DEPTH: u32 = 12;
const CURVE_DEPTH: u32 = 10;
const ROW_BUDGET: usize = 150_000;
/// Pixels a midpoint may stray from its chord before the interval is split.
const DETAIL: f64 = 0.35;
/// Longest chord, in pixels, drawn without splitting.
const STRETCH: f64 = 8.0;
/// The rise in px across a fully refined step that counts as a jump.
const JUMP: f64 = 1.5;
/// Off-screen margin beyond which detail is not needed.
const MARGIN: f64 = 64.0;

/// How many pixels a decade of a logarithmic axis spans, in pixels per unit of a linear one: at the same zoom a decade is
/// as long as four units, so a fresh view shows about five decades across.
pub const DECADE: f64 = 4.0;

#[derive(Clone, Copy, Debug)]
pub struct View {
    pub width: f64,
    pub height: f64,
    /// The centre in axis coordinates: the value on a linear axis, its base-10 logarithm on a logarithmic one.
    pub cx: f64,
    pub cy: f64,
    /// Pixels per unit, the same on both axes; a logarithmic axis spans `scale · DECADE` pixels per decade.
    pub scale: f64,
    pub log_x: bool,
    pub log_y: bool,
}

/// A value's axis coordinate: itself, or its base-10 logarithm on a logarithmic axis (NaN at or below zero there).
fn axis(log: bool, value: f64) -> f64 {
    if !log {
        value
    } else if value > 0.0 {
        value.log10()
    } else {
        f64::NAN
    }
}

fn unaxis(log: bool, coordinate: f64) -> f64 {
    if log { 10_f64.powf(coordinate) } else { coordinate }
}

impl View {
    /// A view with linear axes.
    #[cfg(test)]
    pub const fn linear(width: f64, height: f64, cx: f64, cy: f64, scale: f64) -> View {
        View { width, height, cx, cy, scale, log_x: false, log_y: false }
    }
    /// Pixels per axis unit along x and along y.
    pub fn kx(&self) -> f64 {
        if self.log_x { self.scale * DECADE } else { self.scale }
    }
    pub fn ky(&self) -> f64 {
        if self.log_y { self.scale * DECADE } else { self.scale }
    }
    pub fn sx(&self, x: f64) -> f64 {
        (axis(self.log_x, x) - self.cx) * self.kx() + self.width / 2.0
    }
    pub fn sy(&self, y: f64) -> f64 {
        self.height / 2.0 - (axis(self.log_y, y) - self.cy) * self.ky()
    }
    pub fn wx(&self, sx: f64) -> f64 {
        unaxis(self.log_x, (sx - self.width / 2.0) / self.kx() + self.cx)
    }
    pub fn wy(&self, sy: f64) -> f64 {
        unaxis(self.log_y, self.cy - (sy - self.height / 2.0) / self.ky())
    }
    /// The point halfway between two values on the screen: their mean, or their geometric mean on a logarithmic axis.
    pub fn mid_x(&self, a: f64, b: f64) -> f64 {
        if self.log_x { (a * b).sqrt() } else { 0.5 * (a + b) }
    }
    pub fn mid_y(&self, a: f64, b: f64) -> f64 {
        if self.log_y { (a * b).sqrt() } else { 0.5 * (a + b) }
    }
    fn valid(&self) -> bool {
        self.width > 0.0 && self.height > 0.0 && self.scale > 0.0 && [self.width, self.height, self.cx, self.cy, self.scale].iter().all(|v| v.is_finite())
    }
    fn outside(&self, points: &[(f64, f64)]) -> bool {
        let all = |test: &dyn Fn(&(f64, f64)) -> bool| points.iter().all(test);
        all(&|p| p.0 < -MARGIN) || all(&|p| p.0 > self.width + MARGIN) || all(&|p| p.1 < -MARGIN) || all(&|p| p.1 > self.height + MARGIN)
    }
}

#[derive(Default)]
struct Writer {
    data: Vec<f64>,
    row: f64,
    open: Option<(usize, f64)>,
}

impl Writer {
    fn begin(&mut self, kind: f64) {
        self.end();
        self.open = Some((self.data.len(), kind));
        self.data.extend([self.row, kind, 0.0]);
    }
    fn push(&mut self, sx: f64, sy: f64, wx: f64, wy: f64, parameter: f64) {
        if self.open.is_none() {
            self.begin(LINE);
        }
        self.data.extend([sx, sy, wx, wy, parameter]);
    }
    fn end(&mut self) {
        let Some((header, kind)) = self.open.take() else { return };
        let count = (self.data.len() - header - 3) / STRIDE;
        if count == 0 || (kind == LINE && count < 2) || (kind == REGION && count < 3) {
            self.data.truncate(header);
        } else {
            self.data[header + 2] = count as f64;
        }
    }
}

#[derive(Clone, Copy)]
enum Curve<'a> {
    Polar(&'a Expr),
    Pair(&'a Expr, &'a Expr),
}

struct Graph<'a> {
    view: View,
    env: &'a mut [f64],
    functions: &'a [UserFn],
    cenv: &'a mut [C64],
    cfunctions: &'a [CUserFn],
    out: &'a mut Writer,
    budget: usize,
}

impl Graph<'_> {
    fn at(&mut self, expr: &Expr, slot: usize, value: f64) -> f64 {
        self.env[slot] = value;
        eval(expr, self.env, self.functions)
    }

    fn spend(&mut self) -> bool {
        if self.budget == 0 {
            return false;
        }
        self.budget -= 1;
        true
    }

    // ---- y = f(x) and x = g(y) ----

    fn value_px(&self, along_x: bool, value: f64) -> f64 {
        if along_x { self.view.sy(value) } else { self.view.sx(value) }
    }

    /// Whether a value of a function lands on the screen's scale (finite, and above zero on a logarithmic axis).
    fn drawable(&self, along_x: bool, value: f64) -> bool {
        self.value_px(along_x, value).is_finite()
    }

    fn function_point(&mut self, along_x: bool, p: f64, v: f64) {
        if !self.drawable(along_x, v) {
            self.out.end();
            return;
        }
        let (wx, wy) = if along_x { (p, v) } else { (v, p) };
        self.out.push(self.view.sx(wx), self.view.sy(wy), wx, wy, p);
    }

    fn function(&mut self, expr: &Expr, along_x: bool) {
        let view = self.view;
        let span = if along_x { view.width } else { view.height };
        let n = (span.ceil() as usize + 4).min(20_000);
        // Evenly spaced on the screen, so a logarithmic axis is sampled evenly in its decades.
        let at_px = |i: usize| {
            let px = -2.0 + (span + 4.0) * i as f64 / n as f64;
            if along_x { view.wx(px) } else { view.wy(span - px) }
        };
        let slot = if along_x { X } else { Y };
        let mut p0 = at_px(0);
        let mut v0 = self.at(expr, slot, p0);
        self.function_point(along_x, p0, v0);
        for i in 1..=n {
            let p1 = at_px(i);
            let v1 = self.at(expr, slot, p1);
            self.refine_function(expr, along_x, slot, (p0, v0), (p1, v1), 0);
            (p0, v0) = (p1, v1);
        }
        self.out.end();
    }

    fn refine_function(&mut self, expr: &Expr, along_x: bool, slot: usize, a: (f64, f64), b: (f64, f64), depth: u32) {
        let (finite_a, finite_b) = (self.drawable(along_x, a.1), self.drawable(along_x, b.1));
        if !finite_a && !finite_b {
            self.out.end();
            return;
        }
        if depth >= FUNCTION_DEPTH || !self.spend() {
            if !finite_b {
                self.out.end();
                return;
            }
            // At full depth the step is 1/4096 px, so even a small rise is a jump (a piecewise break, `floor`): the
            // path ends there instead of drawing a vertical connector. A row out of budget keeps the looser test.
            let limit = if depth >= FUNCTION_DEPTH { JUMP } else { STRETCH };
            if finite_a && (self.value_px(along_x, b.1) - self.value_px(along_x, a.1)).abs() > limit {
                self.out.end();
            }
            self.function_point(along_x, b.0, b.1);
            return;
        }
        let pm = if along_x { self.view.mid_x(a.0, b.0) } else { self.view.mid_y(a.0, b.0) };
        let vm = self.at(expr, slot, pm);
        if finite_a && finite_b && self.drawable(along_x, vm) {
            let (s0, s1, sm) = (self.value_px(along_x, a.1), self.value_px(along_x, b.1), self.value_px(along_x, vm));
            let limit = if along_x { self.view.height } else { self.view.width };
            let off = (s0 < -MARGIN && s1 < -MARGIN && sm < -MARGIN) || (s0 > limit + MARGIN && s1 > limit + MARGIN && sm > limit + MARGIN);
            if off || ((sm - 0.5 * (s0 + s1)).abs() <= DETAIL && (s1 - s0).abs() <= STRETCH) {
                self.function_point(along_x, b.0, b.1);
                return;
            }
        }
        self.refine_function(expr, along_x, slot, a, (pm, vm), depth + 1);
        self.refine_function(expr, along_x, slot, (pm, vm), b, depth + 1);
    }

    // ---- polar r(θ) and parametric (x(t), y(t)) ----

    fn curve_at(&mut self, curve: Curve, p: f64) -> (f64, f64) {
        match curve {
            Curve::Polar(r) => {
                let radius = self.at(r, THETA, p);
                (radius * p.cos(), radius * p.sin())
            }
            Curve::Pair(x, y) => {
                let wx = self.at(x, T, p);
                (wx, eval(y, self.env, self.functions))
            }
        }
    }

    fn screen(&self, q: (f64, f64)) -> (f64, f64) {
        (self.view.sx(q.0), self.view.sy(q.1))
    }

    fn curve_point(&mut self, p: f64, q: (f64, f64)) {
        let (sx, sy) = self.screen(q);
        if !(q.0.is_finite() && q.1.is_finite() && sx.is_finite() && sy.is_finite()) {
            self.out.end();
            return;
        }
        self.out.push(sx, sy, q.0, q.1, p);
    }

    fn curve(&mut self, curve: Curve, from: f64, to: f64) {
        let span = to - from;
        if !span.is_finite() || span == 0.0 {
            return;
        }
        let n = ((span.abs() / TAU) * 720.0).ceil().clamp(64.0, 20_000.0) as usize;
        let mut p0 = from;
        let mut q0 = self.curve_at(curve, p0);
        self.curve_point(p0, q0);
        for i in 1..=n {
            let p1 = from + span * (i as f64 / n as f64);
            let q1 = self.curve_at(curve, p1);
            self.refine_curve(curve, (p0, q0), (p1, q1), 0);
            (p0, q0) = (p1, q1);
        }
        self.out.end();
    }

    fn refine_curve(&mut self, curve: Curve, a: (f64, (f64, f64)), b: (f64, (f64, f64)), depth: u32) {
        let view = self.view;
        let finite = |q: (f64, f64)| q.0.is_finite() && q.1.is_finite() && view.sx(q.0).is_finite() && view.sy(q.1).is_finite();
        let (finite_a, finite_b) = (finite(a.1), finite(b.1));
        if !finite_a && !finite_b {
            self.out.end();
            return;
        }
        let distance = |u: (f64, f64), v: (f64, f64)| (u.0 - v.0).hypot(u.1 - v.1);
        if depth >= CURVE_DEPTH || !self.spend() {
            if !finite_b {
                self.out.end();
                return;
            }
            if finite_a && distance(self.screen(a.1), self.screen(b.1)) > STRETCH {
                self.out.end();
            }
            self.curve_point(b.0, b.1);
            return;
        }
        let pm = 0.5 * (a.0 + b.0);
        let qm = self.curve_at(curve, pm);
        if finite_a && finite_b && finite(qm) {
            let (sa, sb, sm) = (self.screen(a.1), self.screen(b.1), self.screen(qm));
            let chord = distance(sa, sb);
            let stray = distance(sm, (0.5 * (sa.0 + sb.0), 0.5 * (sa.1 + sb.1)));
            if self.view.outside(&[sa, sb, sm]) || (stray <= DETAIL && chord <= STRETCH) {
                self.curve_point(b.0, b.1);
                return;
            }
        }
        self.refine_curve(curve, a, (pm, qm), depth + 1);
        self.refine_curve(curve, (pm, qm), b, depth + 1);
    }

    // ---- the area under int(g, a, b) and the line of tangent(g, a) ----

    fn world_point(&mut self, x: f64, y: f64) {
        self.out.push(self.view.sx(x), self.view.sy(y), x, y, x);
    }

    /// The region between g(x) and the x-axis over [a, b] within the view, one sample per pixel: a polygon per stretch
    /// where g is finite, closed along the axis.
    /// On a logarithmic y-axis, where the x-axis cannot be shown, the region closes along the bottom of the view.
    fn area(&mut self, expr: &Expr, from: f64, to: f64) {
        let view = self.view;
        let (lo, hi) = (from.min(to).max(view.wx(-MARGIN)), from.max(to).min(view.wx(view.width + MARGIN)));
        if hi.partial_cmp(&lo) != Some(std::cmp::Ordering::Greater) {
            return;
        }
        let base = if view.log_y { view.wy(view.height + MARGIN) } else { 0.0 };
        let (start, end) = (view.sx(lo), view.sx(hi));
        let n = (end - start).ceil().clamp(1.0, 20_000.0) as usize;
        let mut last: Option<f64> = None;
        for i in 0..=n {
            let x = if i == n { hi } else { view.wx(start + (end - start) * i as f64 / n as f64) };
            let y = self.at(expr, X, x);
            if view.sy(y).is_finite() {
                if last.is_none() {
                    self.out.begin(REGION);
                    self.world_point(x, base);
                }
                self.world_point(x, y);
                last = Some(x);
            } else if let Some(end) = last.take() {
                self.world_point(end, base);
                self.out.end();
            }
        }
        if let Some(end) = last {
            self.world_point(end, base);
            self.out.end();
        }
    }

    /// The tangent line across the view (cut to the view's height, so a steep line keeps its slope) and its point of contact.
    fn tangent(&mut self, slope: f64, intercept: f64, (x, y): (f64, f64)) {
        let view = self.view;
        if view.log_x || view.log_y {
            // The line bends on a logarithmic axis: sampled every two pixels, broken where it leaves the scale.
            let n = ((view.width + 2.0 * MARGIN) / 2.0).ceil() as usize;
            for i in 0..=n {
                let wx = view.wx(-MARGIN + 2.0 * i as f64);
                let wy = slope * wx + intercept;
                let sy = view.sy(wy);
                if sy.is_finite() && sy.abs() < 1e6 {
                    self.out.push(view.sx(wx), sy, wx, wy, wx);
                } else {
                    self.out.end();
                }
            }
            self.out.end();
            if view.sx(x).is_finite() && view.sy(y).is_finite() {
                self.out.begin(POINT);
                self.world_point(x, y);
                self.out.end();
            }
            return;
        }
        let (mut lo, mut hi) = (view.wx(-MARGIN), view.wx(view.width + MARGIN));
        if slope != 0.0 {
            let (a, b) = ((view.wy(view.height + MARGIN) - intercept) / slope, (view.wy(-MARGIN) - intercept) / slope);
            (lo, hi) = (lo.max(a.min(b)), hi.min(a.max(b)));
        }
        if hi > lo {
            self.out.begin(LINE);
            self.world_point(lo, slope * lo + intercept);
            self.world_point(hi, slope * hi + intercept);
            self.out.end();
        }
        self.out.begin(POINT);
        self.world_point(x, y);
        self.out.end();
    }

    // ---- tables and lists of points ----

    /// The points in view (each a POINT path whose parameter is its 1-based table row) and, when `connect`, one line per
    /// run of consecutive points in the order given; a row without a point breaks the line.
    fn table(&mut self, points: &[[f64; 2]], connect: bool) {
        let view = self.view;
        let given = |point: &[f64; 2]| point[0].is_finite() && point[1].is_finite() && view.sx(point[0]).is_finite() && view.sy(point[1]).is_finite();
        if connect {
            for (index, point) in points.iter().enumerate() {
                if given(point) {
                    self.out.push(view.sx(point[0]), view.sy(point[1]), point[0], point[1], (index + 1) as f64);
                } else {
                    self.out.end();
                }
            }
            self.out.end();
        }
        for (index, point) in points.iter().enumerate() {
            let (sx, sy) = (view.sx(point[0]), view.sy(point[1]));
            if given(point) && !view.outside(&[(sx, sy)]) {
                self.out.begin(POINT);
                self.out.push(sx, sy, point[0], point[1], (index + 1) as f64);
                self.out.end();
            }
        }
    }

    // ---- vector fields F(x, y) = (P, Q) ----

    /// With `flow` (the sheet's time and the row), every arrow drifts from its lattice point along the field for one
    /// cycle and starts again, each at its own point of the cycle (see `flow_phase`).
    fn field(&mut self, p: &Expr, q: &Expr, flow: Option<(f64, usize)>) {
        let view = self.view;
        let (kx, ky) = (view.kx(), view.ky());
        // The lattice is laid in axis coordinates (decades on a logarithmic axis), so it keeps its places while panning.
        let (mut step_x, mut step_y) = (nice_near(view.width / (ARROWS_ACROSS * kx)), nice_near(view.width / (ARROWS_ACROSS * ky)));
        let span = |lo: f64, hi: f64, step: f64| ((lo / step).ceil() as i64, (hi / step).floor() as i64);
        let (ax0, ax1) = (view.cx - view.width / (2.0 * kx), view.cx + view.width / (2.0 * kx));
        let (ay0, ay1) = (view.cy - view.height / (2.0 * ky), view.cy + view.height / (2.0 * ky));
        let (mut columns, mut rows) = (span(ax0, ax1, step_x), span(ay0, ay1, step_y));
        while ((columns.1 - columns.0 + 1).max(0) * (rows.1 - rows.0 + 1).max(0)) as usize > ARROW_BUDGET {
            step_x *= 2.0;
            step_y *= 2.0;
            columns = span(ax0, ax1, step_x);
            rows = span(ay0, ay1, step_y);
        }
        let mut arrows = Vec::new();
        for j in rows.0..=rows.1 {
            for i in columns.0..=columns.1 {
                let (wx, wy) = (unaxis(view.log_x, i as f64 * step_x), unaxis(view.log_y, j as f64 * step_y));
                self.env[X] = wx;
                self.env[Y] = wy;
                let (fx, fy) = (eval(p, self.env, self.functions), eval(q, self.env, self.functions));
                let magnitude = fx.hypot(fy);
                if magnitude.is_finite() && magnitude > 0.0 {
                    arrows.push((i, j, wx, wy, fx / magnitude, fy / magnitude, magnitude));
                }
            }
        }
        let mut magnitudes: Vec<f64> = arrows.iter().map(|arrow| arrow.6).collect();
        let Some(reference) = percentile(&mut magnitudes, 0.9) else { return };
        let cell = (step_x * kx).min(step_y * ky);
        for (i, j, wx, wy, ux, uy, magnitude) in arrows {
            let mut grown = 1.0;
            let (mut wx, mut wy, mut ux, mut uy, mut magnitude) = (wx, wy, ux, uy, magnitude);
            if let Some((time, row)) = flow {
                let phase = flow_phase(time, &[row as i64, i, j]);
                grown = flow_size(phase);
                // A lattice cell in world units at the arrow's point: the step itself on linear axes.
                let step = (view.wx(view.sx(wx) + cell) - wx).abs().min((view.wy(view.sy(wy) - cell) - wy).abs());
                // The reference magnitude crosses FLOW_REACH cells per cycle; stronger arrows are no faster, so none
                // overtakes the lattice.
                let velocity = |graph: &mut Self, x: f64, y: f64| -> Option<[f64; 2]> {
                    graph.env[X] = x;
                    graph.env[Y] = y;
                    let (fx, fy) = (eval(p, graph.env, graph.functions), eval(q, graph.env, graph.functions));
                    let size = fx.hypot(fy);
                    (size.is_finite() && size > 0.0).then(|| {
                        let pace = FLOW_REACH * step * (size / reference).min(1.0) / size;
                        [fx * pace, fy * pace]
                    })
                };
                let Some(at) = drift([wx, wy], phase, |point| velocity(self, point[0], point[1])) else { continue };
                (wx, wy) = (at[0], at[1]);
                self.env[X] = wx;
                self.env[Y] = wy;
                let (fx, fy) = (eval(p, self.env, self.functions), eval(q, self.env, self.functions));
                magnitude = fx.hypot(fy);
                if !(magnitude.is_finite() && magnitude > 0.0) {
                    continue;
                }
                (ux, uy) = (fx / magnitude, fy / magnitude);
            }
            let relative = (magnitude / reference).min(1.0);
            let half = 0.5 * ARROW_REACH * cell * relative * grown;
            let (sx, sy) = (view.sx(wx), view.sy(wy));
            if half < 1.0 || !(sx.is_finite() && sy.is_finite()) {
                continue;
            }
            let (dx, dy) = (ux * half, -uy * half);
            self.out.begin(ARROW);
            self.out.push(sx - dx, sy - dy, view.wx(sx - dx), view.wy(sy - dy), magnitude);
            self.out.push(sx + dx, sy + dy, view.wx(sx + dx), view.wy(sy + dy), relative);
            self.out.end();
        }
    }

    // ---- F(x, y) = 0 by marching squares, and the regions where F < 0 or F > 0 ----

    /// The field at a screen point. A complex field counts only where its value is real.
    fn field_at(&mut self, field: &Field, sx: f64, sy: f64) -> f64 {
        let (wx, wy) = (self.view.wx(sx), self.view.wy(sy));
        match field {
            Field::Real(expr) => {
                self.env[X] = wx;
                self.env[Y] = wy;
                eval(expr, self.env, self.functions)
            }
            Field::Complex(expr) => {
                self.cenv[Z] = C64::new(wx, wy);
                self.cenv[X] = C64::real(wx);
                self.cenv[Y] = C64::real(wy);
                let value = complex::eval(expr, self.cenv, self.cfunctions);
                if value.is_real() { value.re } else { f64::NAN }
            }
        }
    }

    /// The field at the corners of a grid of cells over the view: cell size in pixels, columns, rows, values.
    fn grid(&mut self, field: &Field) -> (f64, usize, usize, Vec<f64>) {
        let view = self.view;
        let cell = (view.width * view.height / 250_000.0).sqrt().max(4.0);
        let cols = (view.width / cell).ceil() as usize + 1;
        let rows = (view.height / cell).ceil() as usize + 1;
        let stride = cols + 1;
        let mut grid = vec![0.0; stride * (rows + 1)];
        for j in 0..=rows {
            for i in 0..=cols {
                grid[j * stride + i] = self.field_at(field, i as f64 * cell, j as f64 * cell);
            }
        }
        (cell, cols, rows, grid)
    }

    /// A cell's corners clockwise from top-left as (screen x, screen y, value).
    fn corners(cell: f64, cols: usize, grid: &[f64], i: usize, j: usize) -> [(f64, f64, f64); 4] {
        let stride = cols + 1;
        let (x0, y0, x1, y1) = (i as f64 * cell, j as f64 * cell, (i + 1) as f64 * cell, (j + 1) as f64 * cell);
        [(x0, y0, grid[j * stride + i]), (x1, y0, grid[j * stride + i + 1]), (x1, y1, grid[(j + 1) * stride + i + 1]), (x0, y1, grid[(j + 1) * stride + i])]
    }

    /// Where F changes sign along an edge, by linear interpolation; `None` at a pole, where |F| grows there.
    fn crossing(&mut self, field: &Field, a: (f64, f64, f64), b: (f64, f64, f64), level: f64) -> Option<(f64, f64)> {
        let t = a.2 / (a.2 - b.2);
        let point = (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        let value = self.field_at(field, point.0, point.1) - level;
        (value.abs() <= a.2.abs() + b.2.abs()).then_some(point)
    }

    /// The segment between the crossings on two edges; edge `e` runs from corner `e` to corner `e + 1`.
    fn segment(&mut self, field: &Field, corners: [(f64, f64, f64); 4], from: usize, to: usize, level: f64) -> Option<Segment> {
        let a = self.crossing(field, corners[from], corners[(from + 1) % 4], level)?;
        let b = self.crossing(field, corners[to], corners[(to + 1) % 4], level)?;
        Some((a, b))
    }

    fn implicit(&mut self, field: &Field) {
        let (cell, cols, rows, grid) = self.grid(field);
        self.contour(field, cell, cols, rows, &grid, 0.0, LINE);
    }

    /// The level curves of `f(x, y)`, each a set of polylines whose points carry the level.
    fn contours(&mut self, field: &Field, levels: Levels) {
        let (cell, cols, rows, grid) = self.grid(field);
        let mut values: Vec<f64> = grid.iter().copied().filter(|value| value.is_finite()).collect();
        for level in level_values(&mut values, levels) {
            self.contour(field, cell, cols, rows, &grid, level, CONTOUR);
        }
    }

    /// Where the field equals `level`, joined from cell segments into polylines so dashes and joins run continuously;
    /// written as paths of `kind` whose points carry the level.
    #[allow(clippy::too_many_arguments)]
    fn contour(&mut self, field: &Field, cell: f64, cols: usize, rows: usize, grid: &[f64], level: f64, kind: f64) {
        let mut segments = Vec::new();
        for j in 0..rows {
            for i in 0..cols {
                let corners = Self::corners(cell, cols, grid, i, j).map(|(x, y, value)| (x, y, value - level));
                if corners.iter().any(|corner| !corner.2.is_finite()) {
                    continue;
                }
                let case = corners.iter().fold(0, |bits, corner| (bits << 1) | usize::from(corner.2 > 0.0));
                // Edges: 0 top, 1 right, 2 bottom, 3 left; corners clockwise from top-left (bit 8).
                let pairs: &[(usize, usize)] = match case {
                    0 | 15 => &[],
                    1 | 14 => &[(3, 2)],
                    2 | 13 => &[(2, 1)],
                    3 | 12 => &[(3, 1)],
                    4 | 11 => &[(0, 1)],
                    6 | 9 => &[(0, 2)],
                    7 | 8 => &[(0, 3)],
                    5 | 10 => {
                        let center = self.field_at(field, corners[0].0 + 0.5 * cell, corners[0].1 + 0.5 * cell) - level > 0.0;
                        // 5: top-right and bottom-left positive; 10: top-left and bottom-right positive.
                        if (case == 5) == center { &[(0, 3), (2, 1)] } else { &[(0, 1), (3, 2)] }
                    }
                    _ => &[],
                };
                for &(from, to) in pairs {
                    segments.extend(self.segment(field, corners, from, to, level));
                }
            }
        }
        for line in chain(&segments) {
            self.out.begin(kind);
            for (sx, sy) in line {
                self.out.push(sx, sy, self.view.wx(sx), self.view.wy(sy), level);
            }
            self.out.end();
        }
    }

    fn polygon(&mut self, points: &[(f64, f64)]) {
        self.out.begin(REGION);
        for &(sx, sy) in points {
            self.out.push(sx, sy, self.view.wx(sx), self.view.wy(sy), 0.0);
        }
        self.out.end();
    }

    /// Where `F < 0` (`<`, `≤`) or `F > 0` (`>`, `≥`): runs of whole cells as rectangles, boundary cells clipped
    /// along the interpolated zero line, then the boundary itself.
    fn region(&mut self, field: &Field, relation: Relation) {
        let sign = if matches!(relation, Relation::Lt | Relation::Le) { -1.0 } else { 1.0 };
        let inside = |value: f64| sign * value > 0.0;
        let (cell, cols, rows, grid) = self.grid(field);
        for j in 0..rows {
            let (top, bottom) = (j as f64 * cell, (j + 1) as f64 * cell);
            let mut run: Option<usize> = None;
            for i in 0..=cols {
                let corners = (i < cols).then(|| Self::corners(cell, cols, &grid, i, j));
                let full = corners.is_some_and(|corners| corners.iter().all(|corner| corner.2.is_finite() && inside(corner.2)));
                if full {
                    run.get_or_insert(i);
                    continue;
                }
                if let Some(start) = run.take() {
                    let (left, right) = (start as f64 * cell, i as f64 * cell);
                    self.polygon(&[(left, top), (right, top), (right, bottom), (left, bottom)]);
                }
                let Some(corners) = corners else { continue };
                if corners.iter().any(|corner| !corner.2.is_finite()) || !corners.iter().any(|corner| inside(corner.2)) {
                    continue;
                }
                let mut clipped = Vec::with_capacity(6);
                for (k, a) in corners.iter().enumerate() {
                    let b = corners[(k + 1) % 4];
                    if inside(a.2) {
                        clipped.push((a.0, a.1));
                    }
                    if inside(a.2) != inside(b.2) {
                        let t = a.2 / (a.2 - b.2);
                        clipped.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
                    }
                }
                self.polygon(&clipped);
            }
        }
        self.contour(field, cell, cols, rows, &grid, 0.0, LINE);
    }
}

/// A piece of a contour line between two screen points.
type Segment = ((f64, f64), (f64, f64));

/// A 1, 2 or 5 × 10ⁿ step at least `raw`.
pub fn nice(raw: f64) -> f64 {
    let base = 10_f64.powf(raw.log10().floor());
    let ratio = raw / base;
    base * if ratio <= 1.0 { 1.0 } else if ratio <= 2.0 { 2.0 } else if ratio <= 5.0 { 5.0 } else { 10.0 }
}

/// The levels to trace among `values` (finite; reordered): with an explicit step every multiple of it between the least
/// and the greatest value, else at most `count` multiples of a round step across the 2nd to 98th percentile. Never
/// more than `LEVEL_BUDGET`; a constant field has none.
pub fn level_values(values: &mut [f64], levels: Levels) -> Vec<f64> {
    let (lo, hi) = match levels.step {
        Some(_) => (values.iter().copied().fold(f64::INFINITY, f64::min), values.iter().copied().fold(f64::NEG_INFINITY, f64::max)),
        None => match (percentile(values, 0.02), percentile(values, 0.98)) {
            (Some(lo), Some(hi)) => (lo, hi),
            _ => return Vec::new(),
        },
    };
    if !(lo.is_finite() && hi.is_finite() && hi > lo) {
        return Vec::new();
    }
    let mut step = levels.step.unwrap_or_else(|| nice((hi - lo) / levels.count.max(1) as f64));
    let span = |step: f64| ((lo / step).ceil() as i64, (hi / step).floor() as i64);
    let (mut first, mut last) = span(step);
    if last - first + 1 > LEVEL_BUDGET as i64 {
        step *= ((last - first + 1) as f64 / LEVEL_BUDGET as f64).ceil();
        (first, last) = span(step);
    }
    (first..=last).map(|k| k as f64 * step).collect()
}

/// The 1, 2 or 5 × 10ⁿ step nearest to `raw` on a logarithmic scale.
pub fn nice_near(raw: f64) -> f64 {
    let base = 10_f64.powf(raw.log10().floor());
    [1.0, 2.0, 5.0, 10.0].map(|factor| factor * base).into_iter().min_by(|a, b| (a / raw).ln().abs().total_cmp(&(b / raw).ln().abs())).unwrap_or(raw)
}

/// The value below which `share` of the finite `values` lie; `None` when there are none. Reorders `values`.
/// Lattice cells an arrow of the reference magnitude drifts in one cycle of a flowing field.
pub const FLOW_REACH: f64 = 1.5;
/// Midpoint steps of one drift.
const FLOW_STEPS: usize = 6;

/// Where in its cycle (0–1) the arrow with these lattice indices is at `time` cycles: each arrow starts at its own
/// moment, fixed by its indices, so the lattice never jumps back as a whole.
pub fn flow_phase(time: f64, key: &[i64]) -> f64 {
    let mut hash: u64 = 0x9e37_79b9_7f4a_7c15;
    for value in key {
        hash = (hash ^ *value as u64).wrapping_mul(0xff51_afd7_ed55_8ccd);
        hash ^= hash >> 33;
    }
    (time + (hash >> 11) as f64 / (1_u64 << 53) as f64).rem_euclid(1.0)
}

/// An arrow's size along its cycle: it grows over the first fifth and shrinks over the last, so its jump back to the
/// lattice point happens at size zero.
pub fn flow_size(phase: f64) -> f64 {
    let edge = (phase.min(1.0 - phase) / 0.2).clamp(0.0, 1.0);
    edge * edge * (3.0 - 2.0 * edge)
}

/// The point reached from `start` after `phase` of a cycle along `velocity` (displacement per cycle), by the midpoint
/// rule; `None` where the field has no direction on the way.
pub fn drift<const N: usize>(start: [f64; N], phase: f64, mut velocity: impl FnMut([f64; N]) -> Option<[f64; N]>) -> Option<[f64; N]> {
    let h = phase / FLOW_STEPS as f64;
    let mut at = start;
    for _ in 0..FLOW_STEPS {
        let first = velocity(at)?;
        let middle: [f64; N] = std::array::from_fn(|k| at[k] + 0.5 * h * first[k]);
        let second = velocity(middle)?;
        at = std::array::from_fn(|k| at[k] + h * second[k]);
    }
    Some(at)
}

pub fn percentile(values: &mut [f64], share: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let at = ((values.len() - 1) as f64 * share).round() as usize;
    Some(*values.select_nth_unstable_by(at, f64::total_cmp).1)
}

/// Joins segments that share endpoints into polylines. Neighbouring cells compute a shared crossing from the same
/// edge, so endpoints agree up to rounding; they are matched on a 1/1024-pixel grid.
fn chain(segments: &[Segment]) -> Vec<Vec<(f64, f64)>> {
    use std::collections::HashMap;
    let key = |p: (f64, f64)| ((p.0 * 1024.0).round() as i64, (p.1 * 1024.0).round() as i64);
    let mut ends: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (index, (a, b)) in segments.iter().enumerate() {
        ends.entry(key(*a)).or_default().push(index);
        ends.entry(key(*b)).or_default().push(index);
    }
    let mut used = vec![false; segments.len()];
    let mut next = |at: (f64, f64), used: &mut Vec<bool>| -> Option<(f64, f64)> {
        let candidates = ends.get_mut(&key(at))?;
        let index = candidates.iter().copied().find(|index| !used[*index])?;
        used[index] = true;
        let (a, b) = segments[index];
        Some(if key(a) == key(at) { b } else { a })
    };
    let mut lines = Vec::new();
    for start in 0..segments.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let (a, b) = segments[start];
        let mut forward = vec![a, b];
        while let Some(point) = next(*forward.last().unwrap_or(&b), &mut used) {
            forward.push(point);
        }
        let mut backward = Vec::new();
        while let Some(point) = next(*backward.last().unwrap_or(&a), &mut used) {
            backward.push(point);
        }
        backward.reverse();
        backward.extend(forward);
        lines.push(backward);
    }
    lines
}

pub fn sample(sheet: &mut Sheet, view: View) -> Vec<f64> {
    let mut out = Writer::default();
    if !view.valid() {
        return out.data;
    }
    let Sheet { env, functions, cenv, cfunctions, rows, time, .. } = sheet;
    let time = *time;
    for (index, row) in rows.iter().enumerate() {
        let Some(plot) = row.plot().filter(|_| !row.hidden) else { continue };
        out.row = index as f64;
        let mut graph = Graph {
            view,
            env: env.as_mut_slice(),
            functions: functions.as_slice(),
            cenv: cenv.as_mut_slice(),
            cfunctions: cfunctions.as_slice(),
            out: &mut out,
            budget: ROW_BUDGET,
        };
        match plot {
            Plot::FunctionX(expr) => graph.function(expr, true),
            Plot::FunctionY(expr) => graph.function(expr, false),
            Plot::Polar { r, from, to } => graph.curve(Curve::Polar(r), *from, *to),
            Plot::Curve { x, y, from, to } => graph.curve(Curve::Pair(x, y), *from, *to),
            Plot::Point { x, y } | Plot::ComplexPoint { re: x, im: y, .. } => {
                let (sx, sy) = (view.sx(*x), view.sy(*y));
                if sx.is_finite() && sy.is_finite() {
                    graph.out.begin(POINT);
                    graph.out.push(sx, sy, *x, *y, 0.0);
                    graph.out.end();
                }
            }
            Plot::Implicit(field) => graph.implicit(field),
            Plot::Field { x, y } => graph.field(x, y, row.flow.then_some((time, index))),
            Plot::Contour { field, levels, .. } => graph.contours(field, *levels),
            Plot::Region { field, relation } => graph.region(field, *relation),
            Plot::Integral { body, from, to, .. } => graph.area(body, *from, *to),
            Plot::Tangent { slope, intercept, x, y } => graph.tangent(*slope, *intercept, (*x, *y)),
            Plot::Table { points, connect, .. } => graph.table(points, *connect),
            Plot::Surface { .. } | Plot::Curve3 { .. } | Plot::Point3 { .. } | Plot::ComplexSurface { .. } | Plot::CoordSurface { .. } | Plot::ParamSurface { .. } | Plot::Implicit3(_) | Plot::Field3 { .. } | Plot::TangentPlane { .. } | Plot::Volume { .. } => {}
        }
    }
    out.data
}

/// The stretches of x over which a visible `y = f(x)` row is drawn in the view, one per path: they end where the curve
/// jumps, has a pole or a gap, so a sign change between two of them is no zero (see `markers`).
pub fn pieces(sheet: &mut Sheet, view: View, row: usize) -> Vec<(f64, f64)> {
    let mut out = Writer::default();
    let Sheet { env, functions, cenv, cfunctions, rows, .. } = sheet;
    let Some(Plot::FunctionX(expr)) = rows.get(row).filter(|found| !found.hidden).and_then(|found| found.plot()) else { return Vec::new() };
    if !view.valid() {
        return Vec::new();
    }
    let mut graph = Graph { view, env: env.as_mut_slice(), functions: functions.as_slice(), cenv: cenv.as_mut_slice(), cfunctions: cfunctions.as_slice(), out: &mut out, budget: ROW_BUDGET };
    graph.function(expr, true);
    let mut found = Vec::new();
    let mut at = 0;
    while at + 3 <= out.data.len() {
        let count = out.data[at + 2] as usize;
        if count > 0 {
            found.push((out.data[at + 3 + 2], out.data[at + 3 + (count - 1) * STRIDE + 2]));
        }
        at += 3 + count * STRIDE;
    }
    found
}

/// `f(value)` of a `y = f(x)` or `x = g(y)` row, for tracing under the pointer; NaN for any other row.
pub fn evaluate(sheet: &mut Sheet, row: usize, value: f64) -> f64 {
    let Sheet { env, functions, rows, .. } = sheet;
    let (expr, slot) = match rows.get(row).and_then(|row| row.plot()) {
        Some(Plot::FunctionX(expr)) => (expr, X),
        Some(Plot::FunctionY(expr)) => (expr, Y),
        _ => return f64::NAN,
    };
    env[slot] = value;
    eval(expr, env, functions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{DEFAULT_LEVELS, Mode, RowInput, analyze};

    const VIEW: View = View::linear(400.0, 300.0, 0.0, 0.0, 20.0);

    struct Path {
        row: usize,
        kind: f64,
        points: Vec<[f64; STRIDE]>,
    }

    fn paths(mode: Mode, texts: &[&str], view: View) -> Vec<Path> {
        let inputs: Vec<RowInput> = texts.iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        let mut sheet = analyze(mode, &inputs);
        let data = sample(&mut sheet, view);
        let mut paths = Vec::new();
        let mut at = 0;
        while at < data.len() {
            let count = data[at + 2] as usize;
            let points = (0..count).map(|i| std::array::from_fn(|k| data[at + 3 + i * STRIDE + k])).collect();
            paths.push(Path { row: data[at] as usize, kind: data[at + 1], points });
            at += 3 + count * STRIDE;
        }
        paths
    }

    #[test]
    fn a_parabola_is_one_path_across_the_view() {
        let found = paths(Mode::Cartesian, &["x^2"], VIEW);
        assert_eq!(found.len(), 1);
        let path = &found[0];
        assert_eq!(path.kind, LINE);
        assert!(path.points.first().unwrap()[0] <= 0.0 && path.points.last().unwrap()[0] >= VIEW.width);
        for point in &path.points {
            assert!((point[3] - point[2] * point[2]).abs() < 1e-9);
            assert!((point[0] - VIEW.sx(point[2])).abs() < 1e-9);
        }
    }

    #[test]
    fn logarithmic_axes_map_decades_evenly_and_sample_evenly_on_the_screen() {
        // Log-log around x = 10, y = 10: 80 px per decade.
        let view = View { log_x: true, log_y: true, cx: 1.0, cy: 1.0, ..VIEW };
        assert!((view.sx(10.0) - 200.0).abs() < 1e-9 && (view.sx(100.0) - 280.0).abs() < 1e-9 && (view.wx(120.0) - 1.0).abs() < 1e-12);
        assert!(view.sx(0.0).is_nan() && view.sy(-1.0).is_nan());
        // A power law is a straight line: y = x² rises two decades per decade.
        let found = paths(Mode::Cartesian, &["x^2"], view);
        assert_eq!(found.len(), 1);
        let points = &found[0].points;
        let gaps: Vec<f64> = points.windows(2).map(|pair| pair[1][0] - pair[0][0]).collect();
        assert!(gaps.iter().all(|gap| *gap > 0.0 && *gap <= 1.0 + 1e-9), "samples stay at most a pixel apart on the screen");
        for point in points {
            let expected = view.sy(point[2] * point[2]);
            assert!((point[1] - expected).abs() < 1e-6);
            assert!((point[1] - (70.0 - 2.0 * (point[0] - 200.0))).abs() < 1e-6);
        }
        // Values at or below zero are off the scale: sin(x) splits into its positive humps on a logarithmic y-axis.
        let semi = View { log_y: true, cy: 0.0, ..VIEW };
        let humps = paths(Mode::Cartesian, &["sin(x)"], semi);
        assert!(humps.len() >= 3, "{}", humps.len());
        assert!(humps.iter().flat_map(|path| &path.points).all(|point| point[3] > 0.0 && point[1].is_finite()));
        // The area under a curve closes along the bottom of the view; a point at x ≤ 0 is not drawn on a logarithmic x-axis.
        let area = paths(Mode::Cartesian, &["int(x, 1, 2)"], semi);
        let region = area.iter().find(|path| path.kind == REGION).expect("a region");
        assert!(region.points.iter().any(|point| (point[1] - (semi.height + MARGIN)).abs() < 1e-6));
        let logx = View { log_x: true, cx: 0.0, ..VIEW };
        assert!(paths(Mode::Cartesian, &["(-1, 2)"], logx).is_empty());
        assert_eq!(paths(Mode::Cartesian, &["(1, 2)"], logx).len(), 1);
        // Implicit curves and tangents still draw: the unit circle's right half lies at x > 0.
        assert!(!paths(Mode::Cartesian, &["x^2 + y^2 = 1"], View { scale: 100.0, ..logx }).is_empty());
        assert!(!paths(Mode::Cartesian, &["tangent(x^2, 1)"], logx).is_empty());
    }

    #[test]
    fn asymptotes_and_jumps_split_paths() {
        // tan has asymptotes at ±π/2, ±3π/2 inside x ∈ [-10, 10]: seven branches.
        assert_eq!(paths(Mode::Trig, &["tan x"], VIEW).len(), 7);
        assert_eq!(paths(Mode::Cartesian, &["sign(x)"], VIEW).len(), 2);
        assert_eq!(paths(Mode::Cartesian, &["1/x"], VIEW).len(), 2);
    }

    #[test]
    fn piecewise_functions_break_cleanly_at_jumps() {
        // Continuous at 0: one path. A jump of 3 (60 px) and one of 0.1 (2 px): two paths each, both ends at the break.
        assert_eq!(paths(Mode::Cartesian, &["{x < 0: -x, x ≥ 0: x^2}"], VIEW).len(), 1);
        for text in ["{x < 1: x, x ≥ 1: x + 3}", "y = {x < 1: x, x + 0.1}"] {
            let found = paths(Mode::Cartesian, &[text], VIEW);
            assert_eq!(found.len(), 2, "{text}");
            let left_end = found[0].points.last().unwrap();
            let right_start = found[1].points[0];
            assert!(left_end[2] < 1.0 && 1.0 - left_end[2] < 1e-3, "{text}: left ends at {}", left_end[2]);
            assert!(right_start[2] >= 1.0 && right_start[2] - 1.0 < 1e-3, "{text}: right starts at {}", right_start[2]);
            assert!((left_end[3] - left_end[2]).abs() < 1e-3);
        }
        // No true branch is a gap; a chained condition bounds the piece on both sides.
        let piece = paths(Mode::Cartesian, &["{0 ≤ x < 2: x^2}"], VIEW);
        assert_eq!(piece.len(), 1);
        let (first, last) = (piece[0].points[0], *piece[0].points.last().unwrap());
        assert!(first[2] >= 0.0 && first[2] < 1e-3 && last[2] < 2.0 && last[2] > 2.0 - 1e-3, "{first:?} {last:?}");
        assert_eq!(paths(Mode::Cartesian, &["floor(x)"], VIEW).len(), 22);
    }

    #[test]
    fn domain_edges_are_found_closely() {
        let found = paths(Mode::Cartesian, &["sqrt(x)"], VIEW);
        assert_eq!(found.len(), 1);
        let first = found[0].points[0];
        assert!(first[2] >= 0.0 && first[2] < 1e-3, "starts at x = {}", first[2]);
    }

    #[test]
    fn circles_three_ways() {
        let polar = paths(Mode::Polar, &["r = 3"], VIEW);
        let pair = paths(Mode::Parametric, &["(3cos t, 3sin t)"], VIEW);
        let implicit = paths(Mode::Cartesian, &["x^2 + y^2 = 9"], VIEW);
        for found in [&polar, &pair, &implicit] {
            assert_eq!(found.len(), 1);
            for point in &found[0].points {
                assert!((point[2].hypot(point[3]) - 3.0).abs() < 0.05, "{point:?}");
            }
        }
        assert_eq!(implicit[0].kind, LINE);
        assert!(implicit[0].points.len() > 40);
    }

    #[test]
    fn points_hidden_rows_and_tracing() {
        let found = paths(Mode::Cartesian, &["(1, 2)", "x"], VIEW);
        assert_eq!(found[0].kind, POINT);
        assert_eq!(found[0].points[0][..4], [VIEW.sx(1.0), VIEW.sy(2.0), 1.0, 2.0]);
        assert_eq!(found[1].row, 1);
        let mut sheet = analyze(Mode::Cartesian, &[RowInput { text: "x^3".into(), hidden: true, ..RowInput::default() }]);
        assert!(sample(&mut sheet, VIEW).is_empty());
        assert_eq!(evaluate(&mut sheet, 0, 2.0), 8.0);
        assert!(evaluate(&mut sheet, 5, 2.0).is_nan());
    }

    #[test]
    fn tables_draw_their_points_and_an_optional_line_broken_at_gaps() {
        let cells = |rows: &[[&str; 2]]| Some(rows.iter().map(|[x, y]| [x.to_string(), y.to_string()]).collect());
        let rows = [["-2", "1"], ["0", "0"], ["", ""], ["1", "3"], ["2", "4"], ["500", "0"]];
        let mut joined = analyze(Mode::Cartesian, &[RowInput { table: cells(&rows), connect: true, ..RowInput::default() }]);
        let data = sample(&mut joined, VIEW);
        let mut found = Vec::new();
        let mut at = 0;
        while at < data.len() {
            let count = data[at + 2] as usize;
            found.push((data[at + 1], (0..count).map(|i| [data[at + 3 + i * STRIDE + 2], data[at + 3 + i * STRIDE + 3], data[at + 3 + i * STRIDE + 4]]).collect::<Vec<_>>()));
            at += 3 + count * STRIDE;
        }
        // Two runs of the line (the blank row breaks it; the far point still joins its run), then the four points in view.
        let lines: Vec<_> = found.iter().filter(|(kind, _)| *kind == LINE).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].1, vec![[-2.0, 1.0, 1.0], [0.0, 0.0, 2.0]]);
        assert_eq!(lines[1].1.len(), 3);
        let points: Vec<_> = found.iter().filter(|(kind, _)| *kind == POINT).map(|(_, points)| points[0]).collect();
        assert_eq!(points, vec![[-2.0, 1.0, 1.0], [0.0, 0.0, 2.0], [1.0, 3.0, 4.0], [2.0, 4.0, 5.0]]);
        let mut loose = analyze(Mode::Cartesian, &[RowInput { table: cells(&rows), ..RowInput::default() }]);
        assert!(paths_of(&sample(&mut loose, VIEW)).iter().all(|kind| *kind == POINT));
        assert_eq!(paths(Mode::Polar, &["[(1, 1), (2, 2)]"], VIEW).len(), 2);
    }

    fn paths_of(data: &[f64]) -> Vec<f64> {
        let mut kinds = Vec::new();
        let mut at = 0;
        while at < data.len() {
            kinds.push(data[at + 1]);
            at += 3 + data[at + 2] as usize * STRIDE;
        }
        kinds
    }

    #[test]
    fn vector_fields_draw_centred_arrows_that_stay_in_their_cells() {
        let found = paths(Mode::Cartesian, &["F(x, y) = (-y, x)"], VIEW);
        assert!(found.iter().all(|path| path.kind == ARROW && path.points.len() == 2));
        // 400 × 300 px at 20 px per unit: a twentieth of the width is one unit, so 21 × 15 lattice points, less the origin
        // (no direction) and its four neighbours, whose arrows would be shorter than two pixels.
        assert_eq!(found.len(), 21 * 15 - 5, "{} arrows", found.len());
        let cell = VIEW.scale;
        for path in &found {
            let [tail, head] = [path.points[0], path.points[1]];
            let (mx, my) = (0.5 * (tail[2] + head[2]), 0.5 * (tail[3] + head[3]));
            assert!((mx - mx.round()).abs() < 1e-9 && (my - my.round()).abs() < 1e-9, "centred on the lattice");
            let length = (head[0] - tail[0]).hypot(head[1] - tail[1]);
            assert!(length <= ARROW_REACH * cell + 1e-9, "{length}");
            // Perpendicular to the position: (−y, x) turns counter-clockwise.
            assert!(((head[2] - tail[2]) * mx + (head[3] - tail[3]) * my).abs() < 1e-9);
            assert!((0.0..=1.0).contains(&head[4]) && (tail[4] - mx.hypot(my)).abs() < 1e-9);
        }
        // A uniform field draws every arrow at full length, and zooming out keeps the count about the same.
        let uniform = paths(Mode::Cartesian, &["(1, 0.5)"], VIEW);
        assert!(uniform.len() == 1 && uniform[0].kind == POINT, "a pair of numbers stays a point");
        let uniform = paths(Mode::Cartesian, &["(1 + 0x, 0)"], VIEW);
        assert!(uniform.iter().all(|path| ((path.points[1][0] - path.points[0][0]) - ARROW_REACH * cell).abs() < 1e-9));
        let wide = paths(Mode::Cartesian, &["(1 + 0x, 0)"], View { scale: 0.2, ..VIEW });
        assert_eq!(wide.len(), uniform.len());
        assert_eq!(nice_near(0.7), 0.5);
        assert_eq!(nice_near(1.5), 2.0);
        assert_eq!(nice_near(3.0), 2.0);
        assert_eq!(nice_near(8.0), 10.0);
    }

    #[test]
    fn level_curves_lie_on_round_levels_of_the_function() {
        let found = paths(Mode::Cartesian, &["f(x, y) = x^2 + y^2"], VIEW);
        assert!(!found.is_empty() && found.iter().all(|path| path.kind == CONTOUR));
        let mut levels: Vec<f64> = found.iter().map(|path| path.points[0][4]).collect();
        levels.dedup();
        // x² + y² runs from 0 to 156 over the 20 × 15 view: at most ten levels on multiples of a round step (here 20).
        assert!(levels.len() <= DEFAULT_LEVELS && levels.len() >= 4, "{levels:?}");
        assert!(levels.iter().all(|level| (level / 20.0).fract() == 0.0), "{levels:?}");
        for path in &found {
            for point in &path.points {
                assert!((point[2] * point[2] + point[3] * point[3] - point[4]).abs() < 0.5, "{point:?}");
            }
        }
        // Each circle inside the view is one closed polyline.
        let circle = found.iter().find(|path| path.points[0][4] == 20.0).unwrap();
        assert_eq!(found.iter().filter(|path| path.points[0][4] == 20.0).count(), 1);
        assert!((circle.points[0][0] - circle.points.last().unwrap()[0]).abs() < 1e-6);
        // An explicit step draws every multiple of it.
        let inputs = [RowInput { text: "g(x, y) = x".into(), step: "2.5".into(), ..RowInput::default() }];
        let mut sheet = analyze(Mode::Cartesian, &inputs);
        let data = sample(&mut sheet, VIEW);
        let mut stepped = Vec::new();
        let mut at = 0;
        while at < data.len() {
            stepped.push(data[at + 3 + 4]);
            at += 3 + data[at + 2] as usize * STRIDE;
        }
        assert_eq!(stepped, [-10.0, -7.5, -5.0, -2.5, 0.0, 2.5, 5.0, 7.5, 10.0]);
        let mut values: Vec<f64> = (0..=100).map(f64::from).collect();
        assert_eq!(level_values(&mut values, Levels { count: 10, step: None }), [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]);
        assert_eq!(level_values(&mut values, Levels { count: 3, step: None }), [50.0]);
        assert!(level_values(&mut [3.0, 3.0, 3.0], Levels { count: 10, step: None }).is_empty());
        assert_eq!(level_values(&mut [0.0, 1.0], Levels { count: 10, step: Some(1e-6) }).len(), 200);
    }

    #[test]
    fn an_integral_shades_between_its_curve_and_the_axis() {
        let found = paths(Mode::Cartesian, &["f(x) = x^2 - 1", "int(f, -2, 3)", "int(1/x, -1, 1)"], VIEW);
        let regions: Vec<&Path> = found.iter().filter(|path| path.row == 1).collect();
        assert_eq!(regions.len(), 1);
        let polygon = &regions[0].points;
        assert_eq!(regions[0].kind, REGION);
        assert!((polygon[0][2] + 2.0).abs() < 1e-12 && polygon[0][3] == 0.0 && (polygon.last().unwrap()[2] - 3.0).abs() < 1e-12);
        for point in &polygon[1..polygon.len() - 1] {
            assert!((-2.0..=3.0).contains(&point[2]) && (point[3] - (point[2] * point[2] - 1.0)).abs() < 1e-9, "{point:?}");
        }
        // The shoelace area of the polygon is the area of the region, |∫| counted per lobe.
        let n = polygon.len();
        let area = (0..n).map(|k| { let (a, b) = (polygon[k], polygon[(k + 1) % n]); a[2] * b[3] - b[2] * a[3] }).sum::<f64>().abs() / 2.0;
        assert!((area - 20.0 / 3.0).abs() < 0.05, "{area}");
        // Where the integrand is not finite the area breaks: 1/x is two polygons either side of 0, or the sample at 0 is skipped.
        assert!(found.iter().filter(|path| path.row == 2).count() >= 1);
    }

    #[test]
    fn a_tangent_is_a_line_through_its_point() {
        let found = paths(Mode::Cartesian, &["f(x) = x^3", "tangent(f, 1)", "tangent(f, a)", "a = 0.5", "tangent(1000 x^2, 1)"], VIEW);
        let line = found.iter().find(|path| path.row == 1 && path.kind == LINE).unwrap();
        for point in &line.points {
            assert!((point[3] - (3.0 * point[2] - 2.0)).abs() < 1e-9);
        }
        // y = 3x − 2 leaves the 400 × 300 view through its bottom and top edges (64 px beyond them).
        assert!((line.points[0][1] - (VIEW.height + MARGIN)).abs() < 1e-9 && (line.points[1][1] + MARGIN).abs() < 1e-9, "{:?}", line.points);
        let point = found.iter().find(|path| path.row == 1 && path.kind == POINT).unwrap();
        assert_eq!(point.points[0][2..4], [1.0, 1.0]);
        let slider = found.iter().find(|path| path.row == 2 && path.kind == POINT).unwrap();
        assert_eq!(slider.points[0][2..4], [0.5, 0.125]);
        // A steep line is cut to the view's height rather than clamped, so it keeps its slope.
        let steep = found.iter().find(|path| path.row == 4 && path.kind == LINE).unwrap();
        let [a, b] = [steep.points[0], steep.points[1]];
        assert!(((b[3] - a[3]) / (b[2] - a[2]) - 2000.0).abs() < 1e-6 && a[1].abs() < 100.0 + VIEW.height);
    }

    #[test]
    fn a_complex_disk_is_filled_inside_its_circle() {
        let found = paths(Mode::Complex, &["|z + 2| < 3"], VIEW);
        let regions: Vec<&Path> = found.iter().filter(|path| path.kind == REGION).collect();
        assert!(regions.len() > 50, "{} region polygons", regions.len());
        for polygon in &regions {
            for point in &polygon.points {
                assert!((point[2] + 2.0).hypot(point[3]) <= 3.0 + 0.3, "{point:?} lies outside the disk");
            }
        }
        let boundary: Vec<&Path> = found.iter().filter(|path| path.kind == LINE).collect();
        assert_eq!(boundary.len(), 1, "the circle is one closed polyline");
        assert!(boundary[0].points.len() > 100);
        for point in &boundary[0].points {
            assert!(((point[2] + 2.0).hypot(point[3]) - 3.0).abs() < 0.05, "{point:?}");
        }
        // Filled area ≈ the disk's area, 9π.
        let area: f64 = regions.iter().map(|polygon| {
            let n = polygon.points.len();
            (0..n).map(|k| { let (a, b) = (polygon.points[k], polygon.points[(k + 1) % n]); a[2] * b[3] - b[2] * a[3] }).sum::<f64>().abs() / 2.0
        }).sum();
        assert!((area - 9.0 * std::f64::consts::PI).abs() < 0.5, "area {area}");
    }

    #[test]
    fn a_cartesian_inequality_and_complex_points() {
        let found = paths(Mode::Cartesian, &["y > x^2"], VIEW);
        for polygon in found.iter().filter(|path| path.kind == REGION) {
            for point in &polygon.points {
                assert!(point[3] >= point[2] * point[2] - 0.3, "{point:?}");
            }
        }
        let points = paths(Mode::Complex, &["3 - 2i", "w = i"], VIEW);
        assert_eq!(points.iter().map(|path| (path.kind, path.points[0][2], path.points[0][3])).collect::<Vec<_>>(), [(POINT, 3.0, -2.0), (POINT, 0.0, 1.0)]);
    }
}
