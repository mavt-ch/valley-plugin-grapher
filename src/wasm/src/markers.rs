//! Points of interest on a curve y = f(x) of the Cartesian sheet, found for the visible stretch of x on demand: its zeros
//! (sign changes and touching roots), its local extrema and its intersections with the other visible curves y = g(x).
//!
//! Each function is sampled on an even grid across the view; a bracket counts only when both ends lie on the same
//! continuous piece of the drawn curve (the sampler's paths end at jumps, poles and gaps), so a sign change across a
//! break of `tan x`, `1/x` or a piecewise jump never becomes a zero. Brackets are refined by bisection; extrema by
//! bisection on the exact derivative f′ from `calculus::taylor` (golden-section search on f where f′ is not available),
//! and every root is checked to be one: |f| at the refined point must stay under half a pixel. The work per call is
//! bounded: at most `PARTNERS` other curves, a grid of at most `GRID` points per curve, `STEPS` refinement steps per
//! bracket, `MOST` markers and `BUDGET` evaluations in all (a derivative counts `JET_COST`), whatever the expressions cost.

use crate::calculus;
use crate::eval::{Expr, UserFn, eval};
use crate::sample::{View, pieces};
use crate::sheet::{Plot, Sheet, X};

/// The kinds a marker can be, as bits: a touching root is a zero and an extremum at once.
pub const ZERO: u32 = 1;
pub const MINIMUM: u32 = 2;
pub const MAXIMUM: u32 = 4;
pub const INTERSECTION: u32 = 8;

/// Other visible curves a curve is intersected with.
pub const PARTNERS: usize = 8;
/// Grid points across the view per curve.
pub const GRID: usize = 256;
/// Bisection or golden-section steps per bracket (enough to reach the last bit of a double from a grid cell).
pub const STEPS: usize = 64;
/// Markers returned per call.
pub const MOST: usize = 64;
/// Expression evaluations per call.
pub const BUDGET: usize = 12_000;
/// What one evaluation of a first or second derivative costs against the budget.
const JET_COST: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Marker {
    pub x: f64,
    pub y: f64,
    pub kind: u32,
    /// The other curve of an intersection.
    pub other: Option<usize>,
}

struct Finder<'a> {
    env: &'a mut [f64],
    functions: &'a [UserFn],
    budget: usize,
}

impl Finder<'_> {
    fn spend(&mut self, cost: usize) -> bool {
        if self.budget < cost {
            self.budget = 0;
            return false;
        }
        self.budget -= cost;
        true
    }

    fn at(&mut self, expr: &Expr, x: f64) -> f64 {
        if !self.spend(1) {
            return f64::NAN;
        }
        self.env[X] = x;
        eval(expr, self.env, self.functions)
    }

    /// f(x) − g(x) for an intersection, f(x) for a zero.
    fn gap(&mut self, f: &Expr, g: Option<&Expr>, x: f64) -> f64 {
        let value = self.at(f, x);
        match g {
            Some(g) => value - self.at(g, x),
            None => value,
        }
    }

    /// The slope of f − g (or of f) at x, exactly.
    fn slope(&mut self, f: &Expr, g: Option<&Expr>, x: f64) -> f64 {
        let cost = if g.is_some() { 2 * JET_COST } else { JET_COST };
        if !self.spend(cost) {
            return f64::NAN;
        }
        let d = calculus::taylor(f, X, x, 1, self.env, self.functions).derivative(1);
        match g {
            Some(g) => d - calculus::taylor(g, X, x, 1, self.env, self.functions).derivative(1),
            None => d,
        }
    }

    /// A root of `h` in [a, b], where h(a) and h(b) have opposite signs.
    fn bisect(&mut self, f: &Expr, g: Option<&Expr>, (mut a, mut b): (f64, f64), mut ha: f64) -> Option<f64> {
        for _ in 0..STEPS {
            let m = 0.5 * (a + b);
            if m <= a || m >= b {
                break;
            }
            let hm = self.gap(f, g, m);
            if !hm.is_finite() {
                return None;
            }
            if hm == 0.0 {
                return Some(m);
            }
            if (hm < 0.0) == (ha < 0.0) {
                (a, ha) = (m, hm);
            } else {
                b = m;
            }
        }
        Some(0.5 * (a + b))
    }

    /// The extremum of `h` in [a, b] around a grid point that is higher (`maximum`) or lower than both neighbours: where
    /// the exact slope changes sign, else by golden-section search.
    fn extremum(&mut self, f: &Expr, g: Option<&Expr>, (mut a, mut b): (f64, f64), maximum: bool) -> Option<f64> {
        let (sa, sb) = (self.slope(f, g, a), self.slope(f, g, b));
        if sa.is_finite() && sb.is_finite() && (sa > 0.0) == maximum && (sb < 0.0) == maximum && sa != 0.0 && sb != 0.0 {
            for _ in 0..STEPS {
                let m = 0.5 * (a + b);
                if m <= a || m >= b {
                    break;
                }
                let sm = self.slope(f, g, m);
                if !sm.is_finite() {
                    break;
                }
                if sm == 0.0 {
                    return Some(m);
                }
                if (sm > 0.0) == maximum { a = m } else { b = m }
            }
            return Some(0.5 * (a + b));
        }
        let ratio = 0.5 * (5f64.sqrt() - 1.0);
        let sign = if maximum { -1.0 } else { 1.0 };
        let (mut c, mut d) = (b - ratio * (b - a), a + ratio * (b - a));
        let (mut hc, mut hd) = (sign * self.gap(f, g, c), sign * self.gap(f, g, d));
        for _ in 0..STEPS {
            if !(hc.is_finite() && hd.is_finite()) || d <= c {
                break;
            }
            if hc < hd {
                (b, d, hd) = (d, c, hc);
                c = b - ratio * (b - a);
                hc = sign * self.gap(f, g, c);
            } else {
                (a, c, hc) = (c, d, hd);
                d = a + ratio * (b - a);
                hd = sign * self.gap(f, g, d);
            }
        }
        (hc.is_finite() && hd.is_finite()).then_some(0.5 * (a + b))
    }
}

/// The index of the continuous piece that contains x, if any.
fn piece(pieces: &[(f64, f64)], x: f64) -> Option<usize> {
    pieces.iter().position(|&(from, to)| x >= from && x <= to)
}

/// The other curve of an intersection search: its function, row, values on the grid and continuous pieces.
#[derive(Clone, Copy)]
struct Partner<'a> {
    expr: &'a Expr,
    row: usize,
    values: &'a [f64],
    pieces: &'a [(f64, f64)],
}

/// Zeros and extrema of f (with a partner g, of f − g: the intersections) across the grid `xs` with f's values `fs`.
#[allow(clippy::too_many_arguments)]
fn scan(finder: &mut Finder, f: &Expr, g: Option<Partner>, xs: &[f64], fs: &[f64], own: &[(f64, f64)], view: View, found: &mut Vec<Marker>) {
    let hs: Vec<f64> = match g {
        Some(partner) => fs.iter().zip(partner.values).map(|(f, g)| f - g).collect(),
        None => fs.to_vec(),
    };
    let other = g.map(|partner| partner.row);
    let partner = g.map(|partner| partner.expr);
    let together = |a: f64, b: f64| -> bool {
        let same = |pieces: &[(f64, f64)]| piece(pieces, a).is_some_and(|p| piece(pieces, b) == Some(p));
        same(own) && g.is_none_or(|partner| same(partner.pieces))
    };
    // Half a pixel in world units: a refined root must come this close to zero, or it was a jump.
    let tolerance = 0.5 / view.scale;
    let flat = view.height / view.scale * 1e-10;
    let push = |found: &mut Vec<Marker>, finder: &mut Finder, x: f64, kind: u32| {
        let y = finder.at(f, x);
        if y.is_finite() && found.len() < MOST {
            found.push(Marker { x, y, kind, other });
        }
    };
    let root_kind = if g.is_some() { INTERSECTION } else { ZERO };
    for i in 0..xs.len().saturating_sub(1) {
        if finder.budget == 0 || found.len() >= MOST {
            return;
        }
        let (a, b, ha, hb) = (xs[i], xs[i + 1], hs[i], hs[i + 1]);
        if !(ha.is_finite() && hb.is_finite()) || !together(a, b) {
            continue;
        }
        // A grid point exactly on zero counts once, unless the curve lies on zero there (y = 0, or two equal curves), and only
        // where the curve runs on through it (sign(x) is 0 at 0 only, between its jumps).
        if ha == 0.0 && hb != 0.0 && (i == 0 || (hs[i - 1] != 0.0 && together(xs[i - 1], b))) {
            push(found, finder, a, root_kind);
        } else if (ha < 0.0) != (hb < 0.0) && ha != 0.0 && hb != 0.0
            && let Some(x) = finder.bisect(f, partner, (a, b), ha)
            && finder.gap(f, partner, x).abs() <= tolerance
        {
            push(found, finder, x, root_kind);
        }
    }
    for i in 1..xs.len().saturating_sub(1) {
        if finder.budget == 0 || found.len() >= MOST {
            return;
        }
        let (h0, h1, h2) = (hs[i - 1], hs[i], hs[i + 1]);
        if !(h0.is_finite() && h1.is_finite() && h2.is_finite()) || !together(xs[i - 1], xs[i + 1]) {
            continue;
        }
        let maximum = h1 > h0 && h1 >= h2;
        let minimum = h1 < h0 && h1 <= h2;
        if !(maximum || minimum) {
            continue;
        }
        let Some(x) = finder.extremum(f, partner, (xs[i - 1], xs[i + 1]), maximum) else { continue };
        let h = finder.gap(f, partner, x);
        if g.is_none() {
            push(found, finder, x, if maximum { MAXIMUM } else { MINIMUM } | if h.abs() <= flat { ZERO } else { 0 });
        } else if h.abs() <= flat {
            // Curves that touch without crossing: an intersection where f − g has an extremum at zero.
            push(found, finder, x, INTERSECTION);
        }
    }
}

/// Merges markers of the same curve pair closer than a pixel, keeping every kind they carry.
fn merge(found: Vec<Marker>, view: View) -> Vec<Marker> {
    let mut kept: Vec<Marker> = Vec::with_capacity(found.len());
    for marker in found {
        let near = |other: &Marker| other.other == marker.other && ((other.x - marker.x) * view.scale).abs() < 1.0 && ((other.y - marker.y) * view.scale).abs() < 1.0;
        match kept.iter_mut().find(|other| near(other)) {
            Some(other) => other.kind |= marker.kind,
            None => kept.push(marker),
        }
    }
    kept.sort_by(|a, b| a.x.total_cmp(&b.x));
    kept
}

/// The markers of row `row` (a visible y = f(x)) for the view, as records `x, y, kind, other` (other is −1 without a
/// second curve); empty for any other row.
pub fn markers(sheet: &mut Sheet, view: View, row: usize) -> Vec<Marker> {
    search(sheet, view, row, BUDGET)
}

fn search(sheet: &mut Sheet, view: View, row: usize, budget: usize) -> Vec<Marker> {
    let function = |sheet: &Sheet, index: usize| match sheet.rows.get(index) {
        Some(found) if !found.hidden => match found.plot() {
            Some(Plot::FunctionX(expr)) => Some(expr.clone()),
            _ => None,
        },
        _ => None,
    };
    let Some(f) = function(sheet, row) else { return Vec::new() };
    if !(view.width > 0.0 && view.scale > 0.0 && view.scale.is_finite()) {
        return Vec::new();
    }
    let partners: Vec<(usize, Expr)> = (0..sheet.rows.len()).filter(|&index| index != row).filter_map(|index| function(sheet, index).map(|expr| (index, expr))).take(PARTNERS).collect();
    let own = pieces(sheet, view, row);
    let theirs: Vec<Vec<(f64, f64)>> = partners.iter().map(|(index, _)| pieces(sheet, view, *index)).collect();
    let n = GRID.min((view.width / 2.0).ceil() as usize).max(16);
    let (lo, hi) = (view.wx(0.0), view.wx(view.width));
    let xs: Vec<f64> = (0..=n).map(|i| lo + (hi - lo) * i as f64 / n as f64).collect();
    let Sheet { env, functions, .. } = sheet;
    let mut finder = Finder { env: env.as_mut_slice(), functions: functions.as_slice(), budget };
    let fs: Vec<f64> = xs.iter().map(|&x| finder.at(&f, x)).collect();
    let mut found = Vec::new();
    scan(&mut finder, &f, None, &xs, &fs, &own, view, &mut found);
    for ((index, g), pieces) in partners.iter().zip(&theirs) {
        if finder.budget == 0 {
            break;
        }
        let gs: Vec<f64> = xs.iter().map(|&x| finder.at(g, x)).collect();
        scan(&mut finder, &f, Some(Partner { expr: g, row: *index, values: &gs, pieces }), &xs, &fs, &own, view, &mut found);
    }
    merge(found, view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{Mode, RowInput, analyze};
    use std::f64::consts::PI;

    const VIEW: View = View { width: 400.0, height: 300.0, cx: 0.0, cy: 0.0, scale: 20.0 };

    fn found(texts: &[&str], row: usize, view: View) -> Vec<Marker> {
        let inputs: Vec<RowInput> = texts.iter().map(|text| RowInput { text: text.to_string(), ..RowInput::default() }).collect();
        markers(&mut analyze(Mode::Cartesian, &inputs), view, row)
    }

    fn of(markers: &[Marker], kind: u32) -> Vec<f64> {
        markers.iter().filter(|marker| marker.kind & kind != 0).map(|marker| marker.x).collect()
    }

    #[test]
    fn zeros_extrema_and_touching_roots() {
        let cubic = found(&["y = x^3 - 4x"], 0, VIEW);
        let zeros = of(&cubic, ZERO);
        assert_eq!(zeros.len(), 3, "{cubic:?}");
        for (zero, expected) in zeros.iter().zip([-2.0, 0.0, 2.0]) {
            assert!((zero - expected).abs() < 1e-12, "{zero}");
        }
        let (max, min) = (of(&cubic, MAXIMUM), of(&cubic, MINIMUM));
        let turning = (4.0f64 / 3.0).sqrt();
        assert!(max.len() == 1 && (max[0] + turning).abs() < 1e-9, "{max:?}");
        assert!(min.len() == 1 && (min[0] - turning).abs() < 1e-9, "{min:?}");
        // A touching root is one marker that is a zero and a minimum.
        let square = found(&["(x - 1)^2"], 0, VIEW);
        assert_eq!(square.len(), 1, "{square:?}");
        assert_eq!(square[0].kind, ZERO | MINIMUM);
        assert!((square[0].x - 1.0).abs() < 1e-9 && square[0].y.abs() < 1e-15);
        // |x| has a corner minimum at 0; a line has a zero and nothing else; y = 0 and a constant have no markers.
        let corner = found(&["|x| - 1"], 0, VIEW);
        assert_eq!(of(&corner, MINIMUM).len(), 1);
        assert_eq!(of(&corner, ZERO).len(), 2);
        let line = found(&["y = 2x + 1"], 0, VIEW);
        assert!(line.len() == 1 && line[0].kind == ZERO && (line[0].x + 0.5).abs() < 1e-12, "{line:?}");
        assert!(found(&["y = 0"], 0, VIEW).is_empty());
        assert!(found(&["y = 3"], 0, VIEW).is_empty());
        // sin x: zeros at kπ and extrema at π/2 + kπ inside x ∈ [−10, 10].
        let sine = found(&["sin x"], 0, VIEW);
        assert_eq!(of(&sine, ZERO).len(), 7);
        assert_eq!(of(&sine, MAXIMUM).len() + of(&sine, MINIMUM).len(), 6);
        assert!(of(&sine, ZERO).iter().all(|x| ((x / PI).round() * PI - x).abs() < 1e-12));
    }

    #[test]
    fn no_zero_across_a_jump_or_a_pole() {
        assert!(of(&found(&["1/x"], 0, VIEW), ZERO).is_empty());
        assert!(of(&found(&["{x < 0: -1, 1}"], 0, VIEW), ZERO).is_empty());
        assert!(of(&found(&["sign(x)"], 0, VIEW), ZERO).is_empty());
        let tangent = of(&found(&["tan x"], 0, VIEW), ZERO);
        assert_eq!(tangent.len(), 7, "{tangent:?}");
        assert!(tangent.iter().all(|x| ((x / PI).round() * PI - x).abs() < 1e-12));
        // A small jump that the drawn curve does not split still fails the half-pixel test.
        // At 60 px per unit the jump of 0.02 is 1.2 px, under the sampler's 1.5 px, so the path runs on; the refined point
        // is 0.6 px off zero and is refused.
        assert!(of(&found(&["{x < 0.3: -0.01, 0.01}"], 0, View { scale: 60.0, ..VIEW }), ZERO).is_empty());
    }

    #[test]
    fn intersections_with_other_visible_curves() {
        let rows = ["y = x^2 - 2", "y = x", "y = -3", "y = 2x - 3"];
        let markers = found(&rows, 0, VIEW);
        let crossing: Vec<(f64, Option<usize>)> = markers.iter().filter(|marker| marker.kind & INTERSECTION != 0).map(|marker| (marker.x, marker.other)).collect();
        // x² − 2 = x at x = −1 and 2; no meeting with y = −3; it touches its tangent y = 2x − 3 at x = 1.
        assert_eq!(crossing.len(), 3, "{crossing:?}");
        assert!(crossing.iter().any(|(x, other)| (x + 1.0).abs() < 1e-12 && *other == Some(1)));
        assert!(crossing.iter().any(|(x, other)| (x - 2.0).abs() < 1e-12 && *other == Some(1)));
        assert!(crossing.iter().any(|(x, other)| (x - 1.0).abs() < 1e-7 && *other == Some(3)));
        let point = markers.iter().find(|marker| marker.other == Some(1) && marker.x > 0.0).unwrap();
        assert!((point.y - 2.0).abs() < 1e-12);
        // Hidden curves and other kinds of rows take no part; only y = f(x) rows have markers.
        let inputs = [RowInput { text: "x^2".into(), ..RowInput::default() }, RowInput { text: "y = 1".into(), hidden: true, ..RowInput::default() }, RowInput { text: "x^2 + y^2 = 4".into(), ..RowInput::default() }];
        let mut sheet = analyze(Mode::Cartesian, &inputs);
        assert!(markers_of(&mut sheet, 0).iter().all(|marker| marker.other.is_none()));
        assert!(markers_of(&mut sheet, 1).is_empty() && markers_of(&mut sheet, 2).is_empty());
        // Intersections across a pole of the other curve are not reported.
        assert!(found(&["y = 0.5", "1/x"], 0, VIEW).iter().filter(|marker| marker.other == Some(1)).all(|marker| (marker.x - 2.0).abs() < 1e-12));
    }

    fn markers_of(sheet: &mut Sheet, row: usize) -> Vec<Marker> {
        markers(sheet, VIEW, row)
    }

    #[test]
    fn the_work_per_call_is_bounded() {
        let inputs = [RowInput { text: "sin x".into(), ..RowInput::default() }];
        // The grid alone takes 201 evaluations: with fewer the search stops and finds nothing rather than running on.
        assert!(search(&mut analyze(Mode::Cartesian, &inputs), VIEW, 0, 150).is_empty());
        assert_eq!(search(&mut analyze(Mode::Cartesian, &inputs), VIEW, 0, BUDGET).len(), 13);
        // A fast oscillation keeps at most MOST markers.
        assert_eq!(found(&["sin(40x)"], 0, VIEW).len(), MOST);
    }
}
