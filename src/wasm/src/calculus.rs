//! Derivatives and integrals of compiled expressions.
//!
//! Derivatives are exact, not difference quotients: an expression is evaluated on truncated Taylor series ("jets",
//! automatic differentiation in Taylor mode), so `f'(x)` and `f''(x)` carry only rounding error at any x and any zoom,
//! and the curves are as smooth as `f` itself. Every operation and built-in function has its Taylor recurrence (products
//! and quotients by convolution, `exp`, `ln`, `sin`/`cos`, `sinh`/`cosh`, `sqrt` and powers by their differential
//! equations, the inverse functions by integrating their derivative); `floor`, `round`, `sign` and `mod` are piecewise
//! constant, `|u|` has no derivative where u = 0 and `x!` none at all. A derivative inside a derivative (`g(x) = f'(x)`,
//! then `g'(x)`) composes, up to `MAX_ORDER` in all.
//!
//! Integrals use adaptive Gauss–Kronrod quadrature (7 Gauss and 15 Kronrod points): while the differences between the two
//! estimates of the pieces add up to more than the tolerance (10⁻¹² absolute or 10⁻¹⁰ relative), the piece with the largest
//! difference is halved, at most 60 times deep and into 2000 pieces in all. An infinite bound is mapped onto a finite
//! interval first (x = a + t / (1 − t) and its mirror images), whose Gauss nodes never reach the singular end. A value that is not finite anywhere the rule looks
//! makes the integral NaN.

use crate::builtins::Builtin;
use crate::eval::{Condition, Expr, UserFn, branch, eval, factorial, index_range, real_pow};
use crate::parser::BinOp;

/// The highest derivative a jet carries.
pub const MAX_ORDER: usize = 8;
const LEN: usize = MAX_ORDER + 1;

/// A truncated Taylor series in one variable: `c[k]` is the k-th derivative divided by k!, for k up to `n`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Jet {
    pub c: [f64; LEN],
    pub n: usize,
}

fn factorial_of(k: usize) -> f64 {
    (2..=k).fold(1.0, |product, i| product * i as f64)
}

impl Jet {
    pub fn constant(value: f64, n: usize) -> Self {
        let mut c = [0.0; LEN];
        c[0] = value;
        Self { c, n }
    }

    /// The variable itself at `value`.
    pub fn variable(value: f64, n: usize) -> Self {
        let mut jet = Self::constant(value, n);
        if n >= 1 {
            jet.c[1] = 1.0;
        }
        jet
    }

    /// `value` with no known derivatives.
    fn value_only(value: f64, n: usize) -> Self {
        let mut jet = Self::constant(value, n);
        for k in 1..=n {
            jet.c[k] = f64::NAN;
        }
        jet
    }

    fn zero(n: usize) -> Self {
        Self::constant(0.0, n)
    }

    pub fn value(&self) -> f64 {
        self.c[0]
    }

    /// The k-th derivative.
    pub fn derivative(&self, k: usize) -> f64 {
        if k > self.n { f64::NAN } else { self.c[k] * factorial_of(k) }
    }

    fn is_constant(&self) -> bool {
        self.c[1..=self.n].iter().all(|value| *value == 0.0)
    }

    fn truncate(mut self, n: usize) -> Self {
        let n = n.min(self.n);
        for k in n + 1..=self.n {
            self.c[k] = 0.0;
        }
        self.n = n;
        self
    }

    /// d/dt of the series, one order shorter.
    fn derive(&self) -> Self {
        let n = self.n.saturating_sub(1);
        let mut out = Self::zero(n);
        for k in 0..=n {
            out.c[k] = if k < self.n { (k + 1) as f64 * self.c[k + 1] } else { 0.0 };
        }
        out
    }

    fn zip(&self, other: &Self, op: impl Fn(f64, f64) -> f64) -> Self {
        let n = self.n.min(other.n);
        let mut out = Self::zero(n);
        for k in 0..=n {
            out.c[k] = op(self.c[k], other.c[k]);
        }
        out
    }

    fn add(&self, other: &Self) -> Self {
        self.zip(other, |a, b| a + b)
    }

    fn sub(&self, other: &Self) -> Self {
        self.zip(other, |a, b| a - b)
    }

    fn scale(&self, factor: f64) -> Self {
        let mut out = *self;
        for k in 0..=self.n {
            out.c[k] *= factor;
        }
        out
    }

    fn neg(&self) -> Self {
        self.scale(-1.0)
    }

    fn mul(&self, other: &Self) -> Self {
        // A constant factor scales the other one, so 0 · NaN does not spread into derivatives that exist.
        if other.is_constant() {
            return self.scale(other.c[0]).truncate(other.n);
        }
        if self.is_constant() {
            return other.scale(self.c[0]).truncate(self.n);
        }
        let n = self.n.min(other.n);
        let mut out = Self::zero(n);
        for k in 0..=n {
            out.c[k] = (0..=k).map(|j| self.c[j] * other.c[k - j]).sum();
        }
        out
    }

    fn div(&self, other: &Self) -> Self {
        if other.is_constant() {
            return self.scale(1.0 / other.c[0]).truncate(other.n);
        }
        let n = self.n.min(other.n);
        let mut out = Self::zero(n);
        for k in 0..=n {
            let sum: f64 = (1..=k).map(|j| other.c[j] * out.c[k - j]).sum();
            out.c[k] = (self.c[k] - sum) / other.c[0];
        }
        out
    }

    /// The series whose value is `value` and whose derivative is `slope` (one order shorter).
    fn integrate(value: f64, slope: &Self, n: usize) -> Self {
        let n = n.min(slope.n + 1);
        let mut out = Self::zero(n);
        out.c[0] = value;
        for k in 1..=n {
            out.c[k] = slope.c[k - 1] / k as f64;
        }
        out
    }

    /// `g(self)` from g(u₀) and g' as a series in u: the derivative of g(u(t)) is g'(u) · u'.
    fn chain(&self, value: f64, outer: impl Fn(&Self) -> Self) -> Self {
        if self.is_constant() || self.n == 0 {
            return Self::constant(value, self.n);
        }
        let inner = self.truncate(self.n - 1);
        Self::integrate(value, &outer(&inner).mul(&self.derive()), self.n)
    }

    fn exp(&self) -> Self {
        let mut out = Self::zero(self.n);
        out.c[0] = self.c[0].exp();
        for k in 1..=self.n {
            out.c[k] = (1..=k).map(|j| j as f64 * self.c[j] * out.c[k - j]).sum::<f64>() / k as f64;
        }
        out
    }

    fn ln(&self) -> Self {
        let mut out = Self::zero(self.n);
        out.c[0] = self.c[0].ln();
        for k in 1..=self.n {
            let sum: f64 = (1..k).map(|j| j as f64 * out.c[j] * self.c[k - j]).sum();
            out.c[k] = (self.c[k] - sum / k as f64) / self.c[0];
        }
        out
    }

    /// sin and cos, or sinh and cosh when `hyperbolic`.
    fn sin_cos(&self, hyperbolic: bool) -> (Self, Self) {
        let (mut s, mut c) = (Self::zero(self.n), Self::zero(self.n));
        (s.c[0], c.c[0]) = if hyperbolic { (self.c[0].sinh(), self.c[0].cosh()) } else { self.c[0].sin_cos() };
        let sign = if hyperbolic { 1.0 } else { -1.0 };
        for k in 1..=self.n {
            let (mut ds, mut dc) = (0.0, 0.0);
            for j in 1..=k {
                ds += j as f64 * self.c[j] * c.c[k - j];
                dc += j as f64 * self.c[j] * s.c[k - j];
            }
            s.c[k] = ds / k as f64;
            c.c[k] = sign * dc / k as f64;
        }
        (s, c)
    }

    fn sqrt(&self) -> Self {
        let mut out = Self::zero(self.n);
        out.c[0] = self.c[0].sqrt();
        for k in 1..=self.n {
            let sum: f64 = (1..k).map(|j| out.c[j] * out.c[k - j]).sum();
            out.c[k] = (self.c[k] - sum) / (2.0 * out.c[0]);
        }
        out
    }

    /// `self^r` for a constant r, with the real roots of negative numbers `real_pow` takes.
    fn powr(&self, r: f64) -> Self {
        if r.fract() == 0.0 && r.abs() <= 64.0 {
            let mut power = Self::constant(1.0, self.n);
            let mut base = *self;
            let mut exponent = r.abs() as u32;
            while exponent > 0 {
                if exponent & 1 == 1 {
                    power = power.mul(&base);
                }
                base = base.mul(&base);
                exponent >>= 1;
            }
            return if r < 0.0 { Self::constant(1.0, self.n).div(&power) } else { power };
        }
        let mut out = Self::zero(self.n);
        out.c[0] = real_pow(self.c[0], r);
        if self.is_constant() {
            return out;
        }
        // u · w' = r · w · u', so k u₀ w_k = Σ ((r + 1) j − k) u_j w_{k−j}.
        for k in 1..=self.n {
            let sum: f64 = (1..=k).map(|j| ((r + 1.0) * j as f64 - k as f64) * self.c[j] * out.c[k - j]).sum();
            out.c[k] = sum / (k as f64 * self.c[0]);
        }
        out
    }

    fn pow(&self, exponent: &Self) -> Self {
        if exponent.is_constant() {
            return self.powr(exponent.c[0]).truncate(exponent.n);
        }
        let value = real_pow(self.c[0], exponent.c[0]);
        let mut out = exponent.mul(&self.ln()).exp();
        out.c[0] = value;
        out
    }

    fn reciprocal(&self) -> Self {
        Self::constant(1.0, self.n).div(self)
    }

    fn builtin(builtin: Builtin, args: &[Self]) -> Self {
        let Some(u) = args.first() else { return Self::value_only(f64::NAN, 0) };
        let n = u.n;
        let value = builtin.apply(&args.iter().map(Self::value).collect::<Vec<_>>());
        let one = Self::constant(1.0, n);
        match (builtin, args) {
            (Builtin::Sin, _) => u.sin_cos(false).0,
            (Builtin::Cos, _) => u.sin_cos(false).1,
            (Builtin::Tan, _) => {
                let (s, c) = u.sin_cos(false);
                s.div(&c)
            }
            (Builtin::Cot, _) => {
                let (s, c) = u.sin_cos(false);
                c.div(&s)
            }
            (Builtin::Sec, _) => u.sin_cos(false).1.reciprocal(),
            (Builtin::Csc, _) => u.sin_cos(false).0.reciprocal(),
            (Builtin::Sinh, _) => u.sin_cos(true).0,
            (Builtin::Cosh, _) => u.sin_cos(true).1,
            (Builtin::Tanh, _) => {
                let (s, c) = u.sin_cos(true);
                s.div(&c)
            }
            (Builtin::Coth, _) => {
                let (s, c) = u.sin_cos(true);
                c.div(&s)
            }
            (Builtin::Asin, _) => u.chain(value, |v| one.truncate(v.n).sub(&v.mul(v)).sqrt().reciprocal()),
            (Builtin::Acos, _) => u.chain(value, |v| one.truncate(v.n).sub(&v.mul(v)).sqrt().reciprocal().neg()),
            (Builtin::Atan, [y, x]) => {
                let order = y.n.min(x.n);
                if order == 0 || (y.is_constant() && x.is_constant()) {
                    return Self::constant(value, order);
                }
                let (y0, x0) = (y.truncate(order - 1), x.truncate(order - 1));
                let slope = x0.mul(&y.derive()).sub(&y0.mul(&x.derive())).div(&x0.mul(&x0).add(&y0.mul(&y0)));
                Self::integrate(value, &slope, order)
            }
            (Builtin::Atan, _) => u.chain(value, |v| one.truncate(v.n).add(&v.mul(v)).reciprocal()),
            (Builtin::Acot, _) => u.chain(value, |v| one.truncate(v.n).add(&v.mul(v)).reciprocal().neg()),
            (Builtin::Asinh, _) => u.chain(value, |v| v.mul(v).add(&one.truncate(v.n)).sqrt().reciprocal()),
            (Builtin::Acosh, _) => u.chain(value, |v| v.mul(v).sub(&one.truncate(v.n)).sqrt().reciprocal()),
            (Builtin::Atanh, _) => u.chain(value, |v| one.truncate(v.n).sub(&v.mul(v)).reciprocal()),
            (Builtin::Sqrt, _) => u.sqrt(),
            (Builtin::Cbrt, _) => {
                let mut out = u.powr(1.0 / 3.0);
                out.c[0] = value;
                out
            }
            (Builtin::Abs, _) if u.c[0] > 0.0 => *u,
            (Builtin::Abs, _) if u.c[0] < 0.0 => u.neg(),
            (Builtin::Abs, _) => Self::value_only(value, n),
            (Builtin::Ln, _) => u.ln(),
            (Builtin::Log, _) => u.ln().scale(1.0 / std::f64::consts::LN_10),
            (Builtin::Exp, _) => u.exp(),
            (Builtin::Sign | Builtin::Floor | Builtin::Ceil | Builtin::Round | Builtin::Imag | Builtin::Arg, _) => Self::constant(value, n),
            (Builtin::Real | Builtin::Conj, _) => *u,
            (Builtin::Min | Builtin::Max, _) => {
                let pick = args.iter().find(|arg| arg.c[0] == value).copied();
                pick.unwrap_or_else(|| Self::value_only(value, n))
            }
            // a mod b = a − b · k for the whole number k = (a − r) / b of the remainder r.
            (Builtin::Mod, [a, b]) => {
                let k = ((a.c[0] - value) / b.c[0]).round();
                let mut out = a.sub(&b.scale(k));
                out.c[0] = value;
                out
            }
            (Builtin::Root, [x, degree]) => {
                let mut out = x.pow(&degree.reciprocal());
                out.c[0] = value;
                out
            }
            (Builtin::Mod | Builtin::Root, _) => Self::value_only(f64::NAN, n),
        }
    }
}

/// Evaluates expressions on jets. Slots bound to a jet (the variable of differentiation and the parameters of the user
/// functions being called) shadow the plain environment; every other slot is a constant.
struct Tape<'a> {
    env: &'a mut [f64],
    functions: &'a [UserFn],
    bound: Vec<(usize, Jet)>,
    /// The order new constants are made with.
    n: usize,
}

impl Tape<'_> {
    fn slot(&self, slot: usize) -> Jet {
        self.bound.iter().rev().find(|(bound, _)| *bound == slot).map_or_else(|| Jet::constant(self.env[slot], self.n), |(_, jet)| *jet)
    }

    /// Runs `inner` with the plain environment holding the values of the bound slots, as plain evaluation would see them.
    fn plain<T>(&mut self, inner: impl FnOnce(&mut [f64], &[UserFn]) -> T) -> T {
        let saved: Vec<(usize, f64)> = self.bound.iter().map(|(slot, jet)| (*slot, std::mem::replace(&mut self.env[*slot], jet.c[0]))).collect();
        let result = inner(self.env, self.functions);
        for (slot, value) in saved.into_iter().rev() {
            self.env[slot] = value;
        }
        result
    }

    /// Whether `expr` reads one of `slots`, through the user functions it calls too (inside which their own parameters are local).
    fn reads(&self, expr: &Expr, slots: &[usize], depth: usize) -> bool {
        if slots.is_empty() {
            return false;
        }
        if depth > 16 {
            return true;
        }
        let body = |index: usize| {
            let function = &self.functions[index];
            let local: Vec<usize> = slots.iter().copied().filter(|slot| !function.slots.contains(slot)).collect();
            self.reads(&function.body, &local, depth + 1)
        };
        match expr {
            Expr::Num(_) => false,
            Expr::Slot(slot) => slots.contains(slot),
            Expr::Neg(arg) | Expr::Fact(arg) => self.reads(arg, slots, depth),
            Expr::Bin(_, left, right) => self.reads(left, slots, depth) || self.reads(right, slots, depth),
            Expr::Builtin(_, args) => args.iter().any(|arg| self.reads(arg, slots, depth)),
            Expr::User(index, args) => args.iter().any(|arg| self.reads(arg, slots, depth)) || body(*index),
            Expr::Derivative { index, arg, .. } => self.reads(arg, slots, depth) || body(*index),
            Expr::Integral { body: integrand, slot, from, to } => {
                let local: Vec<usize> = slots.iter().copied().filter(|bound| bound != slot).collect();
                self.reads(from, slots, depth) || self.reads(to, slots, depth) || self.reads(integrand, &local, depth)
            }
            Expr::Series { slot, from, to, body: term, .. } => {
                let local: Vec<usize> = slots.iter().copied().filter(|bound| bound != slot).collect();
                self.reads(from, slots, depth) || self.reads(to, slots, depth) || self.reads(term, &local, depth)
            }
            Expr::Piecewise(branches) => branches.iter().any(|(condition, value)| {
                condition.as_ref().is_some_and(|condition| self.reads_condition(condition, slots, depth)) || self.reads(value, slots, depth)
            }),
        }
    }

    fn reads_condition(&self, condition: &Condition, slots: &[usize], depth: usize) -> bool {
        match condition {
            Condition::Chain(operands, _) => operands.iter().any(|operand| self.reads(operand, slots, depth)),
            Condition::And(a, b) | Condition::Or(a, b) => self.reads_condition(a, slots, depth) || self.reads_condition(b, slots, depth),
        }
    }

    fn jet(&mut self, expr: &Expr) -> Jet {
        let n = self.n;
        match expr {
            Expr::Num(value) => Jet::constant(*value, n),
            Expr::Slot(slot) => self.slot(*slot),
            Expr::Neg(arg) => self.jet(arg).neg(),
            Expr::Bin(op, left, right) => {
                let (a, b) = (self.jet(left), self.jet(right));
                match op {
                    BinOp::Add => a.add(&b),
                    BinOp::Sub => a.sub(&b),
                    BinOp::Mul => a.mul(&b),
                    BinOp::Div => a.div(&b),
                    BinOp::Pow => a.pow(&b),
                }
            }
            Expr::Builtin(builtin, args) => {
                let args: Vec<Jet> = args.iter().map(|arg| self.jet(arg)).collect();
                Jet::builtin(*builtin, &args)
            }
            Expr::Fact(arg) => {
                let u = self.jet(arg);
                if u.is_constant() { Jet::constant(factorial(u.c[0]), u.n) } else { Jet::value_only(factorial(u.c[0]), u.n) }
            }
            Expr::User(index, args) => {
                let values: Vec<Jet> = args.iter().map(|arg| self.jet(arg)).collect();
                let functions = self.functions;
                let function = &functions[*index];
                let depth = self.bound.len();
                self.bound.extend(function.slots.iter().copied().zip(values));
                let result = self.jet(&function.body);
                self.bound.truncate(depth);
                result
            }
            Expr::Derivative { index, order, arg } => {
                let u = self.jet(arg);
                let total = order + u.n;
                let functions = self.functions;
                let function = &functions[*index];
                let ([slot], true) = (function.slots.as_slice(), total <= MAX_ORDER) else { return Jet::value_only(f64::NAN, u.n) };
                // The Taylor series of f about u₀ to the order this derivative needs, then composed with u − u₀.
                let (slot, body, at) = (*slot, &function.body, u.c[0]);
                let taylor = self.plain(|env, functions| Tape { env, functions, bound: vec![(slot, Jet::variable(at, total))], n: total }.jet(body));
                let coefficient = |j: usize| taylor.c[order + j] * factorial_of(order + j) / factorial_of(j);
                let mut delta = u;
                delta.c[0] = 0.0;
                let mut out = Jet::constant(coefficient(u.n), u.n);
                for j in (0..u.n).rev() {
                    out = out.mul(&delta);
                    out.c[0] += coefficient(j);
                }
                out
            }
            Expr::Integral { body, slot, from, to } => {
                let (a, b) = (self.jet(from), self.jet(to));
                let value = self.plain(|env, functions| integrate(body, *slot, a.c[0], b.c[0], env, functions));
                let order = a.n.min(b.n);
                if order == 0 || (a.is_constant() && b.is_constant() && !self.reads(body, &self.bound_slots(*slot), 0)) {
                    return Jet::constant(value, order);
                }
                // Only the bounds may depend on the variable: d/dt ∫ₐᵇ g = g(b) b' − g(a) a'.
                if self.reads(body, &self.bound_slots(*slot), 0) {
                    return Jet::value_only(value, order);
                }
                let mut at = |bound: Jet| -> Jet {
                    let saved = std::mem::replace(&mut self.n, order - 1);
                    self.bound.push((*slot, bound.truncate(order - 1)));
                    let value = self.jet(body);
                    self.bound.pop();
                    self.n = saved;
                    value
                };
                let (upper, lower) = (at(b), at(a));
                let slope = upper.mul(&b.derive()).sub(&lower.mul(&a.derive()));
                Jet::integrate(value, &slope, order)
            }
            // Linear: the series of the terms, each with the index bound to a constant; rounded bounds do not vary.
            Expr::Series { product, slot, from, to, body } => {
                let (a, b) = (self.jet(from), self.jet(to));
                let Some((first, count)) = index_range(a.c[0], b.c[0]) else { return Jet::value_only(f64::NAN, n) };
                let mut total = Jet::constant(if *product { 1.0 } else { 0.0 }, n);
                for k in 0..count {
                    self.bound.push((*slot, Jet::constant(first + k as f64, n)));
                    let term = self.jet(body);
                    self.bound.pop();
                    total = if *product { total.mul(&term) } else { total.add(&term) };
                }
                total
            }
            // The series of the branch that applies at the point: one-sided at a break, as the plain value is.
            Expr::Piecewise(branches) => match self.plain(|env, functions| branch(branches, env, functions)) {
                Some(index) => self.jet(&branches[index].1),
                None => Jet::value_only(f64::NAN, n),
            },
        }
    }

    fn bound_slots(&self, except: usize) -> Vec<usize> {
        self.bound.iter().map(|(slot, _)| *slot).filter(|slot| *slot != except).collect()
    }
}

/// The series of `expr` in the variable at `slot` about `value`, to `order`; the other slots keep their values.
pub fn taylor(expr: &Expr, slot: usize, value: f64, order: usize, env: &mut [f64], functions: &[UserFn]) -> Jet {
    let order = order.min(MAX_ORDER);
    Tape { env, functions, bound: vec![(slot, Jet::variable(value, order))], n: order }.jet(expr)
}

/// The derivative of the given order of a user function of one variable at `at`.
pub fn derivative(function: &UserFn, order: usize, at: f64, env: &mut [f64], functions: &[UserFn]) -> f64 {
    match function.slots.as_slice() {
        [slot] if order <= MAX_ORDER => taylor(&function.body, *slot, at, order, env, functions).derivative(order),
        _ => f64::NAN,
    }
}

// Gauss–Kronrod 7–15 on [−1, 1]: the Kronrod nodes (the odd ones are the Gauss nodes) and weights, and the Gauss weights.
const KRONROD_NODES: [f64; 8] = [
    0.991_455_371_120_812_6,
    0.949_107_912_342_758_5,
    0.864_864_423_359_769_1,
    0.741_531_185_599_394_4,
    0.586_087_235_467_691_1,
    0.405_845_151_377_397_2,
    0.207_784_955_007_898_5,
    0.0,
];
const KRONROD_WEIGHTS: [f64; 8] = [
    0.022_935_322_010_529_225,
    0.063_092_092_629_978_55,
    0.104_790_010_322_250_18,
    0.140_653_259_715_525_92,
    0.169_004_726_639_267_9,
    0.190_350_578_064_785_4,
    0.204_432_940_075_298_9,
    0.209_482_141_084_727_83,
];
const GAUSS_WEIGHTS: [f64; 4] = [0.129_484_966_168_869_7, 0.279_705_391_489_276_7, 0.381_830_050_505_118_9, 0.417_959_183_673_469_4];

const ABSOLUTE_TOLERANCE: f64 = 1e-12;
const RELATIVE_TOLERANCE: f64 = 1e-10;
const MAX_DEPTH: u32 = 60;
const MAX_INTERVALS: usize = 2000;

/// One Gauss–Kronrod step on [a, b]: the Kronrod estimate and its difference from the Gauss one; NaN where `g` is not finite.
fn kronrod(g: &mut impl FnMut(f64) -> f64, a: f64, b: f64) -> (f64, f64) {
    let (centre, half) = (0.5 * (a + b), 0.5 * (b - a));
    let middle = g(centre);
    let (mut kronrod, mut gauss) = (middle * KRONROD_WEIGHTS[7], middle * GAUSS_WEIGHTS[3]);
    for k in 0..7 {
        let pair = g(centre - half * KRONROD_NODES[k]) + g(centre + half * KRONROD_NODES[k]);
        kronrod += KRONROD_WEIGHTS[k] * pair;
        if k % 2 == 1 {
            gauss += GAUSS_WEIGHTS[k / 2] * pair;
        }
    }
    let value = kronrod * half;
    if value.is_finite() { (value, (value - gauss * half).abs()) } else { (f64::NAN, f64::NAN) }
}

/// A piece of the interval with its estimate and error, ordered by its error.
struct Piece {
    lo: f64,
    hi: f64,
    value: f64,
    error: f64,
    depth: u32,
}

impl PartialEq for Piece {
    fn eq(&self, other: &Self) -> bool {
        self.error.total_cmp(&other.error).is_eq()
    }
}

impl Eq for Piece {}

impl PartialOrd for Piece {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Piece {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.error.total_cmp(&other.error)
    }
}

/// ∫ₐᵇ g over a finite interval: the piece with the largest error is halved until the errors add up to the tolerance.
fn adaptive(mut g: impl FnMut(f64) -> f64, a: f64, b: f64) -> f64 {
    let (whole, error) = kronrod(&mut g, a, b);
    if !whole.is_finite() {
        return f64::NAN;
    }
    let mut pieces = std::collections::BinaryHeap::from([Piece { lo: a, hi: b, value: whole, error, depth: 0 }]);
    let (mut estimate, mut total_error, mut settled) = (whole, error, 0.0);
    let mut intervals = 1;
    while total_error > ABSOLUTE_TOLERANCE.max(RELATIVE_TOLERANCE * estimate.abs()) && intervals < MAX_INTERVALS {
        let Some(piece) = pieces.pop() else { break };
        if piece.depth >= MAX_DEPTH {
            settled += piece.value;
            total_error -= piece.error;
            continue;
        }
        let middle = 0.5 * (piece.lo + piece.hi);
        let (left, left_error) = kronrod(&mut g, piece.lo, middle);
        let (right, right_error) = kronrod(&mut g, middle, piece.hi);
        if !left.is_finite() || !right.is_finite() {
            return f64::NAN;
        }
        estimate += left + right - piece.value;
        total_error += left_error + right_error - piece.error;
        intervals += 1;
        pieces.push(Piece { lo: piece.lo, hi: middle, value: left, error: left_error, depth: piece.depth + 1 });
        pieces.push(Piece { lo: middle, hi: piece.hi, value: right, error: right_error, depth: piece.depth + 1 });
    }
    settled + pieces.iter().map(|piece| piece.value).sum::<f64>()
}

/// ∫ₐᵇ `body` d(slot): negative when a > b, 0 when a = b; an infinite bound is mapped onto a finite interval.
pub fn integrate(body: &Expr, slot: usize, a: f64, b: f64, env: &mut [f64], functions: &[UserFn]) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == b {
        return 0.0;
    }
    if a > b {
        return -integrate(body, slot, b, a, env, functions);
    }
    let saved = env[slot];
    let mut g = |x: f64| {
        env[slot] = x;
        eval(body, env, functions)
    };
    let value = match (a.is_finite(), b.is_finite()) {
        (true, true) => adaptive(&mut g, a, b),
        (true, false) => adaptive(|t| g(a + t / (1.0 - t)) / ((1.0 - t) * (1.0 - t)), 0.0, 1.0),
        (false, true) => adaptive(|t| g(b - (1.0 - t) / t) / (t * t), 0.0, 1.0),
        (false, false) => adaptive(|t| g(t / (1.0 - t * t)) * (1.0 + t * t) / ((1.0 - t * t) * (1.0 - t * t)), -1.0, 1.0),
    };
    env[slot] = saved;
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval::{Scope, compile};
    use crate::lexer::tokenize;
    use crate::parser::parse;
    use std::collections::{HashMap, HashSet};
    use std::f64::consts::{E, PI};

    fn expr(source: &str) -> Expr {
        let statement = parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("x".to_string(), 0), ("y".to_string(), 1)].into();
        let functions = HashMap::new();
        compile(&statement.right, &Scope { slots: &slots, functions: &functions, allow: &|_| true }).unwrap()
    }

    fn derivative_of(source: &str, x: f64, order: usize) -> f64 {
        taylor(&expr(source), 0, x, order, &mut [0.0, 0.0], &[]).derivative(order)
    }

    fn close(got: f64, expected: f64, tolerance: f64, what: &str) {
        assert!((got - expected).abs() <= tolerance * expected.abs().max(1.0), "{what}: {got} != {expected}");
    }

    #[test]
    fn derivatives_are_exact_at_any_point() {
        for x in [-7.3, -1.0, -0.2, 0.0, 0.4, 1.0, 2.5, 1e3, 1e6] {
            close(derivative_of("sin x", x, 1), x.cos(), 1e-12, "sin'");
            close(derivative_of("sin x", x, 2), -x.sin(), 1e-12, "sin''");
            close(derivative_of("x^3", x, 1), 3.0 * x * x, 1e-12, "(x^3)'");
            close(derivative_of("x^3", x, 2), 6.0 * x, 1e-12, "(x^3)''");
            close(derivative_of("x^3", x, 3), 6.0, 1e-12, "(x^3)'''");
            close(derivative_of("e^(2x/1000)", x / 1e3, 1), 2e-3 * (2.0 * x / 1e6).exp(), 1e-12, "exp'");
        }
        for x in [0.3, 1.0, 4.0] {
            close(derivative_of("ln x", x, 1), 1.0 / x, 1e-12, "ln'");
            close(derivative_of("ln x", x, 2), -1.0 / (x * x), 1e-12, "ln''");
            close(derivative_of("sqrt x", x, 1), 0.5 / x.sqrt(), 1e-12, "sqrt'");
            close(derivative_of("x^x", x, 1), x.powf(x) * (x.ln() + 1.0), 1e-12, "(x^x)'");
            close(derivative_of("2^x", x, 2), 2_f64.powf(x) * 2_f64.ln().powi(2), 1e-12, "(2^x)''");
            close(derivative_of("tan x", x, 1), 1.0 / x.cos().powi(2), 1e-12, "tan'");
            close(derivative_of("atan x", x / 4.0, 2), -2.0 * (x / 4.0) / (1.0 + (x / 4.0).powi(2)).powi(2), 1e-12, "atan''");
            close(derivative_of("asin(x/5)", x, 1), 1.0 / (25.0 - x * x).sqrt(), 1e-12, "asin'");
            close(derivative_of("1/x", x, 2), 2.0 / x.powi(3), 1e-12, "(1/x)''");
            close(derivative_of("x^(1/3)", -x, 1), (1.0 / 3.0) * (x * x).cbrt().recip(), 1e-12, "cube root at a negative x");
            close(derivative_of("cosh(x) sinh(x)", x, 1), (2.0 * x).cosh(), 1e-12, "(cosh sinh)'");
            close(derivative_of("atan(x, 2)", x, 1), 2.0 / (4.0 + x * x), 1e-12, "atan2'");
        }
        close(derivative_of("x^2", 0.0, 1), 0.0, 1e-15, "x^2 at 0");
        close(derivative_of("|x|", -2.0, 1), -1.0, 0.0, "|x| left");
        assert!(derivative_of("|x|", 0.0, 1).is_nan());
        assert_eq!(derivative_of("floor(x) + 3x", 2.5, 1), 3.0);
        assert!(derivative_of("x!", 2.0, 1).is_nan());
        assert_eq!(derivative_of("x!", 3.0, 0), 6.0);
    }

    #[test]
    fn integrals_are_accurate_and_signed() {
        let mut env = [0.0, 0.0];
        let mut integral = |source: &str, a: f64, b: f64| integrate(&expr(source), 0, a, b, &mut env, &[]);
        close(integral("x^2", 0.0, 1.0), 1.0 / 3.0, 1e-13, "x^2");
        close(integral("sin x", 0.0, PI), 2.0, 1e-13, "sin over [0, π]");
        close(integral("sin x", 0.0, 2.0 * PI), 0.0, 1e-12, "a sign change cancels");
        close(integral("x", -1.0, 3.0), 4.0, 1e-13, "x across zero");
        close(integral("x^2", 1.0, 0.0), -1.0 / 3.0, 1e-13, "a > b");
        assert_eq!(integral("x^2", 2.0, 2.0), 0.0);
        close(integral("1/x", 1.0, E), 1.0, 1e-12, "1/x");
        close(integral("e^(-x^2)", f64::NEG_INFINITY, f64::INFINITY), PI.sqrt(), 1e-10, "Gauss");
        close(integral("1/(1 + x^2)", 0.0, f64::INFINITY), PI / 2.0, 1e-10, "to ∞");
        close(integral("e^x", f64::NEG_INFINITY, 0.0), 1.0, 1e-10, "from −∞");
        close(integral("1/sqrt(x)", 0.0, 1.0), 2.0, 1e-6, "an integrable singularity");
        close(integral("sin(50x)^2", 0.0, PI), PI / 2.0, 1e-10, "oscillating");
        assert!(integral("sqrt(x)", -1.0, 1.0).is_nan());
        assert_eq!(env[0], 0.0, "the variable's slot is restored");
    }
}
