//! Screen-space sampling of a sheet's plots for one viewport. Functions start at one sample per CSS pixel and
//! curves at 720 per turn; an interval is bisected while its midpoint strays from the chord or the chord is
//! long, so curvature, domain edges and asymptotes get detail and straight stretches stay cheap. A chord that is
//! still long at the deepest level spans a jump and is left out instead of drawn as a vertical line.
//!
//! Output is one flat `f64` stream of paths: `[row, kind, count]`, then `count` points of
//! `[screen x, screen y, world x, world y, parameter]`.

use std::f64::consts::TAU;

use crate::eval::{Expr, UserFn, eval};
use crate::sheet::{Plot, Sheet, T, THETA, X, Y};

pub const LINE: f64 = 0.0;
pub const POINT: f64 = 1.0;
/// Pairs of points, each pair one segment (implicit curves).
pub const SEGMENTS: f64 = 2.0;
pub const STRIDE: usize = 5;

const FUNCTION_DEPTH: u32 = 12;
const CURVE_DEPTH: u32 = 10;
const ROW_BUDGET: usize = 150_000;
/// Pixels a midpoint may stray from its chord before the interval is split.
const DETAIL: f64 = 0.35;
/// Longest chord, in pixels, drawn without splitting.
const STRETCH: f64 = 8.0;
/// Off-screen margin beyond which detail is not needed.
const MARGIN: f64 = 64.0;

#[derive(Clone, Copy, Debug)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub cx: f64,
    pub cy: f64,
    /// Pixels per unit, the same on both axes.
    pub scale: f64,
}

impl View {
    pub fn sx(&self, x: f64) -> f64 {
        (x - self.cx) * self.scale + self.width / 2.0
    }
    pub fn sy(&self, y: f64) -> f64 {
        self.height / 2.0 - (y - self.cy) * self.scale
    }
    pub fn wx(&self, sx: f64) -> f64 {
        (sx - self.width / 2.0) / self.scale + self.cx
    }
    pub fn wy(&self, sy: f64) -> f64 {
        self.cy - (sy - self.height / 2.0) / self.scale
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
        if count == 0 || (kind == LINE && count < 2) {
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

    fn function_point(&mut self, along_x: bool, p: f64, v: f64) {
        if !v.is_finite() {
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
        let (lo, hi) = if along_x { (view.wx(-2.0), view.wx(span + 2.0)) } else { (view.wy(span + 2.0), view.wy(-2.0)) };
        let slot = if along_x { X } else { Y };
        let step = (hi - lo) / n as f64;
        let mut p0 = lo;
        let mut v0 = self.at(expr, slot, p0);
        self.function_point(along_x, p0, v0);
        for i in 1..=n {
            let p1 = lo + step * i as f64;
            let v1 = self.at(expr, slot, p1);
            self.refine_function(expr, along_x, slot, (p0, v0), (p1, v1), 0);
            (p0, v0) = (p1, v1);
        }
        self.out.end();
    }

    fn refine_function(&mut self, expr: &Expr, along_x: bool, slot: usize, a: (f64, f64), b: (f64, f64), depth: u32) {
        let (finite_a, finite_b) = (a.1.is_finite(), b.1.is_finite());
        if !finite_a && !finite_b {
            self.out.end();
            return;
        }
        if depth >= FUNCTION_DEPTH || !self.spend() {
            if !finite_b {
                self.out.end();
                return;
            }
            if finite_a && (self.value_px(along_x, b.1) - self.value_px(along_x, a.1)).abs() > STRETCH {
                self.out.end();
            }
            self.function_point(along_x, b.0, b.1);
            return;
        }
        let pm = 0.5 * (a.0 + b.0);
        let vm = self.at(expr, slot, pm);
        if finite_a && finite_b && vm.is_finite() {
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
        if !(q.0.is_finite() && q.1.is_finite()) {
            self.out.end();
            return;
        }
        let (sx, sy) = self.screen(q);
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
        let finite = |q: (f64, f64)| q.0.is_finite() && q.1.is_finite();
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

    // ---- F(x, y) = 0 by marching squares ----

    fn implicit_at(&mut self, expr: &Expr, sx: f64, sy: f64) -> f64 {
        self.env[X] = self.view.wx(sx);
        self.env[Y] = self.view.wy(sy);
        eval(expr, self.env, self.functions)
    }

    /// Where F changes sign along an edge, by linear interpolation; `None` at a pole, where |F| grows there.
    fn crossing(&mut self, expr: &Expr, a: (f64, f64, f64), b: (f64, f64, f64)) -> Option<(f64, f64)> {
        let t = a.2 / (a.2 - b.2);
        let point = (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        let value = self.implicit_at(expr, point.0, point.1);
        (value.abs() <= a.2.abs() + b.2.abs()).then_some(point)
    }

    /// The segment between the crossings on two edges; edge `e` runs from corner `e` to corner `e + 1`.
    fn segment(&mut self, expr: &Expr, corners: [(f64, f64, f64); 4], from: usize, to: usize) {
        let a = self.crossing(expr, corners[from], corners[(from + 1) % 4]);
        let b = self.crossing(expr, corners[to], corners[(to + 1) % 4]);
        let (Some(a), Some(b)) = (a, b) else { return };
        for (sx, sy) in [a, b] {
            self.out.push(sx, sy, self.view.wx(sx), self.view.wy(sy), 0.0);
        }
    }

    fn implicit(&mut self, expr: &Expr) {
        let view = self.view;
        let cell = (view.width * view.height / 250_000.0).sqrt().max(4.0);
        let cols = (view.width / cell).ceil() as usize + 1;
        let rows = (view.height / cell).ceil() as usize + 1;
        let stride = cols + 1;
        let mut grid = vec![0.0; stride * (rows + 1)];
        for j in 0..=rows {
            for i in 0..=cols {
                grid[j * stride + i] = self.implicit_at(expr, i as f64 * cell, j as f64 * cell);
            }
        }
        self.out.begin(SEGMENTS);
        for j in 0..rows {
            for i in 0..cols {
                let (x0, y0, x1, y1) = (i as f64 * cell, j as f64 * cell, (i + 1) as f64 * cell, (j + 1) as f64 * cell);
                let corners = [(x0, y0, grid[j * stride + i]), (x1, y0, grid[j * stride + i + 1]), (x1, y1, grid[(j + 1) * stride + i + 1]), (x0, y1, grid[(j + 1) * stride + i])];
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
                        let center = self.implicit_at(expr, 0.5 * (x0 + x1), 0.5 * (y0 + y1)) > 0.0;
                        // 5: top-right and bottom-left positive; 10: top-left and bottom-right positive.
                        if (case == 5) == center { &[(0, 3), (2, 1)] } else { &[(0, 1), (3, 2)] }
                    }
                    _ => &[],
                };
                for &(from, to) in pairs {
                    self.segment(expr, corners, from, to);
                }
            }
        }
        self.out.end();
    }
}

pub fn sample(sheet: &mut Sheet, view: View) -> Vec<f64> {
    let mut out = Writer::default();
    if !view.valid() {
        return out.data;
    }
    let Sheet { env, functions, rows } = sheet;
    for (index, row) in rows.iter().enumerate() {
        let Some(plot) = row.plot().filter(|_| !row.hidden) else { continue };
        out.row = index as f64;
        let mut graph = Graph { view, env: env.as_mut_slice(), functions: functions.as_slice(), out: &mut out, budget: ROW_BUDGET };
        match plot {
            Plot::FunctionX(expr) => graph.function(expr, true),
            Plot::FunctionY(expr) => graph.function(expr, false),
            Plot::Polar { r, from, to } => graph.curve(Curve::Polar(r), *from, *to),
            Plot::Curve { x, y, from, to } => graph.curve(Curve::Pair(x, y), *from, *to),
            Plot::Point { x, y } => {
                graph.out.begin(POINT);
                graph.out.push(view.sx(*x), view.sy(*y), *x, *y, 0.0);
                graph.out.end();
            }
            Plot::Implicit(expr) => graph.implicit(expr),
            Plot::Surface { .. } | Plot::Curve3 { .. } | Plot::Point3 { .. } => {}
        }
    }
    out.data
}

/// `f(value)` of a `y = f(x)` or `x = g(y)` row, for tracing under the pointer; NaN for any other row.
pub fn evaluate(sheet: &mut Sheet, row: usize, value: f64) -> f64 {
    let Sheet { env, functions, rows } = sheet;
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
    use crate::sheet::{Mode, RowInput, analyze};

    const VIEW: View = View { width: 400.0, height: 300.0, cx: 0.0, cy: 0.0, scale: 20.0 };

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
    fn asymptotes_and_jumps_split_paths() {
        // tan has asymptotes at ±π/2, ±3π/2 inside x ∈ [-10, 10]: seven branches.
        assert_eq!(paths(Mode::Trig, &["tan x"], VIEW).len(), 7);
        assert_eq!(paths(Mode::Cartesian, &["sign(x)"], VIEW).len(), 2);
        assert_eq!(paths(Mode::Cartesian, &["1/x"], VIEW).len(), 2);
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
        assert_eq!(implicit[0].kind, SEGMENTS);
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
}
