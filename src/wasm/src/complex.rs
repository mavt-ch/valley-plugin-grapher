//! Complex numbers for the complex sheet: arithmetic, the built-in functions extended to ℂ (principal values),
//! and compiled expressions over the complex environment, where `z` is the point, `x` and `y` its parts, `i` the
//! imaginary unit and every other name a definition of the sheet.

use std::f64::consts::{E, FRAC_PI_2, LN_10};
use std::ops::{Add, Div, Mul, Neg, Sub};

use crate::builtins::Builtin;
use crate::error::MathError;
use crate::eval::{Scope, constant, factorial};
use crate::parser::{BinOp, Callee, Node};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct C64 {
    pub re: f64,
    pub im: f64,
}

impl C64 {
    pub const I: Self = Self { re: 0.0, im: 1.0 };
    pub const NAN: Self = Self { re: f64::NAN, im: f64::NAN };

    pub const fn new(re: f64, im: f64) -> Self {
        Self { re, im }
    }

    pub const fn real(re: f64) -> Self {
        Self { re, im: 0.0 }
    }

    pub fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }

    /// In (-π, π]; a negative real number has argument π even with a negative zero imaginary part.
    pub fn arg(self) -> f64 {
        (self.im + 0.0).atan2(self.re)
    }

    /// Real up to rounding: `sin(π)i` and `e^(iπ)` still count as real numbers.
    pub fn is_real(self) -> bool {
        self.im.abs() <= 1e-9 * self.re.abs().max(1.0)
    }

    pub fn conj(self) -> Self {
        Self::new(self.re, if self.im == 0.0 { 0.0 } else { -self.im })
    }

    pub fn exp(self) -> Self {
        let scale = self.re.exp();
        if self.im == 0.0 { Self::real(scale) } else { Self::new(scale * self.im.cos(), scale * self.im.sin()) }
    }

    pub fn ln(self) -> Self {
        Self::new(self.abs().ln(), self.arg())
    }

    pub fn sqrt(self) -> Self {
        if self.im == 0.0 && self.re >= 0.0 {
            return Self::real(self.re.sqrt());
        }
        let r = self.abs();
        let im = ((r - self.re) / 2.0).sqrt();
        Self::new(((r + self.re) / 2.0).sqrt(), if self.im < 0.0 { -im } else { im })
    }

    /// Principal power; integer exponents multiply exactly, a real base with a real result stays real.
    pub fn powc(self, w: Self) -> Self {
        if w.im == 0.0 {
            if self.im == 0.0 && (self.re >= 0.0 || w.re.fract() == 0.0) {
                return Self::real(self.re.powf(w.re));
            }
            if w.re.fract() == 0.0 && w.re.abs() <= 64.0 {
                let mut result = Self::real(1.0);
                for _ in 0..w.re.abs() as u32 {
                    result = result * self;
                }
                return if w.re < 0.0 { Self::real(1.0) / result } else { result };
            }
        }
        if self.re == 0.0 && self.im == 0.0 {
            return if w.re > 0.0 { Self::real(0.0) } else { Self::NAN };
        }
        if self.re == E && self.im == 0.0 {
            return w.exp();
        }
        (w * self.ln()).exp()
    }

    fn sin(self) -> Self {
        Self::new(self.re.sin() * self.im.cosh(), self.re.cos() * self.im.sinh())
    }

    fn cos(self) -> Self {
        Self::new(self.re.cos() * self.im.cosh(), -self.re.sin() * self.im.sinh())
    }

    fn sinh(self) -> Self {
        Self::new(self.re.sinh() * self.im.cos(), self.re.cosh() * self.im.sin())
    }

    fn cosh(self) -> Self {
        Self::new(self.re.cosh() * self.im.cos(), self.re.sinh() * self.im.sin())
    }

    fn asin(self) -> Self {
        -Self::I * (Self::I * self + (Self::real(1.0) - self * self).sqrt()).ln()
    }

    fn atan(self) -> Self {
        Self::new(0.0, 0.5) * ((Self::I + self) / (Self::I - self)).ln()
    }
}

impl Add for C64 {
    type Output = Self;
    fn add(self, b: Self) -> Self {
        Self::new(self.re + b.re, self.im + b.im)
    }
}

impl Sub for C64 {
    type Output = Self;
    fn sub(self, b: Self) -> Self {
        Self::new(self.re - b.re, self.im - b.im)
    }
}

impl Mul for C64 {
    type Output = Self;
    fn mul(self, b: Self) -> Self {
        if self.im == 0.0 && b.im == 0.0 {
            return Self::real(self.re * b.re);
        }
        Self::new(self.re * b.re - self.im * b.im, self.re * b.im + self.im * b.re)
    }
}

impl Div for C64 {
    type Output = Self;
    fn div(self, b: Self) -> Self {
        if self.im == 0.0 && b.im == 0.0 {
            return Self::real(self.re / b.re);
        }
        let denominator = b.re * b.re + b.im * b.im;
        Self::new((self.re * b.re + self.im * b.im) / denominator, (self.im * b.re - self.re * b.im) / denominator)
    }
}

impl Neg for C64 {
    type Output = Self;
    fn neg(self) -> Self {
        Self::new(-self.re, if self.im == 0.0 { 0.0 } else { -self.im })
    }
}

fn apply1(builtin: Builtin, z: C64) -> C64 {
    // A real argument keeps the exact real function wherever that is defined.
    if z.im == 0.0 && !matches!(builtin, Builtin::Imag | Builtin::Conj) {
        let real = builtin.apply1(z.re);
        if !real.is_nan() || z.re.is_nan() {
            return C64::real(real);
        }
    }
    let one = C64::real(1.0);
    match builtin {
        Builtin::Sin => z.sin(),
        Builtin::Cos => z.cos(),
        Builtin::Tan => z.sin() / z.cos(),
        Builtin::Cot => z.cos() / z.sin(),
        Builtin::Sec => one / z.cos(),
        Builtin::Csc => one / z.sin(),
        Builtin::Asin => z.asin(),
        Builtin::Acos => C64::real(FRAC_PI_2) - z.asin(),
        Builtin::Atan => z.atan(),
        Builtin::Acot => (one / z).atan(),
        Builtin::Sinh => z.sinh(),
        Builtin::Cosh => z.cosh(),
        Builtin::Tanh => z.sinh() / z.cosh(),
        Builtin::Coth => z.cosh() / z.sinh(),
        Builtin::Asinh => (z + (z * z + one).sqrt()).ln(),
        Builtin::Acosh => (z + (z + one).sqrt() * (z - one).sqrt()).ln(),
        Builtin::Atanh => C64::real(0.5) * ((one + z) / (one - z)).ln(),
        Builtin::Sqrt => z.sqrt(),
        Builtin::Cbrt => z.powc(C64::real(1.0 / 3.0)),
        Builtin::Abs => C64::real(z.abs()),
        Builtin::Sign => {
            let r = z.abs();
            if r == 0.0 { z } else { z / C64::real(r) }
        }
        Builtin::Ln => z.ln(),
        Builtin::Log => z.ln() / C64::real(LN_10),
        Builtin::Exp => z.exp(),
        Builtin::Floor => C64::new(z.re.floor(), z.im.floor()),
        Builtin::Ceil => C64::new(z.re.ceil(), z.im.ceil()),
        Builtin::Round => C64::new(z.re.round(), z.im.round()),
        Builtin::Real => C64::real(z.re),
        Builtin::Imag => C64::real(z.im),
        Builtin::Conj => z.conj(),
        Builtin::Arg => C64::real(z.arg()),
        Builtin::Min | Builtin::Max => z,
        Builtin::Mod | Builtin::Root => C64::NAN,
    }
}

fn apply(builtin: Builtin, args: &[C64]) -> C64 {
    match (builtin, args) {
        (_, [z]) => apply1(builtin, *z),
        (Builtin::Root, [z, n]) => z.powc(C64::real(1.0) / *n),
        (Builtin::Atan | Builtin::Mod | Builtin::Min | Builtin::Max, values) if values.iter().all(|value| value.im == 0.0) => {
            C64::real(builtin.apply(&values.iter().map(|value| value.re).collect::<Vec<_>>()))
        }
        _ => C64::NAN,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum CExpr {
    Num(C64),
    Slot(usize),
    Neg(Box<CExpr>),
    Bin(BinOp, Box<CExpr>, Box<CExpr>),
    Builtin(Builtin, Vec<CExpr>),
    User(usize, Box<CExpr>),
    Fact(Box<CExpr>),
}

#[derive(Clone, Debug)]
pub struct CUserFn {
    pub slot: usize,
    pub body: CExpr,
}

pub fn compile(node: &Node, scope: &Scope) -> Result<CExpr, MathError> {
    Ok(match node {
        Node::Num(value) => CExpr::Num(C64::real(*value)),
        Node::Var(name) if name == "i" => CExpr::Num(C64::I),
        Node::Var(name) => match (constant(name), scope.slots.get(name)) {
            (Some(value), _) => CExpr::Num(C64::real(value)),
            (None, Some(slot)) if (scope.allow)(name) => CExpr::Slot(*slot),
            _ => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Neg(arg) => CExpr::Neg(Box::new(compile(arg, scope)?)),
        Node::Bin(op, left, right) => CExpr::Bin(*op, Box::new(compile(left, scope)?), Box::new(compile(right, scope)?)),
        Node::Call(Callee::Builtin(builtin), args) => {
            CExpr::Builtin(*builtin, args.iter().map(|arg| compile(arg, scope)).collect::<Result<_, _>>()?)
        }
        Node::Call(Callee::User(name), args) => match (scope.functions.get(name), args.as_slice()) {
            (Some(index), [arg]) => CExpr::User(*index, Box::new(compile(arg, scope)?)),
            (Some(_), _) => return Err(MathError::new("error.arity", name.clone())),
            (None, _) => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Fact(arg) => CExpr::Fact(Box::new(compile(arg, scope)?)),
        Node::Tuple(_) => return Err(MathError::new("error.tuple", "")),
    })
}

pub fn eval(expr: &CExpr, env: &mut [C64], functions: &[CUserFn]) -> C64 {
    match expr {
        CExpr::Num(value) => *value,
        CExpr::Slot(slot) => env[*slot],
        CExpr::Neg(arg) => -eval(arg, env, functions),
        CExpr::Bin(op, left, right) => {
            let a = eval(left, env, functions);
            let b = eval(right, env, functions);
            match op {
                BinOp::Add => a + b,
                BinOp::Sub => a - b,
                BinOp::Mul => a * b,
                BinOp::Div => a / b,
                BinOp::Pow => a.powc(b),
            }
        }
        CExpr::Builtin(builtin, args) => match args.as_slice() {
            [arg] => apply1(*builtin, eval(arg, env, functions)),
            _ => {
                let values: Vec<C64> = args.iter().map(|arg| eval(arg, env, functions)).collect();
                apply(*builtin, &values)
            }
        },
        CExpr::User(index, arg) => {
            let value = eval(arg, env, functions);
            let function = &functions[*index];
            let saved = std::mem::replace(&mut env[function.slot], value);
            let result = eval(&function.body, env, functions);
            env[function.slot] = saved;
            result
        }
        CExpr::Fact(arg) => {
            let value = eval(arg, env, functions);
            if value.im == 0.0 { C64::real(factorial(value.re)) } else { C64::NAN }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;
    use crate::parser::parse;
    use std::collections::{HashMap, HashSet};
    use std::f64::consts::PI;

    fn value(source: &str) -> C64 {
        let statement = parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("φ".to_string(), 0)].into();
        let functions = HashMap::new();
        let scope = Scope { slots: &slots, functions: &functions, allow: &|_| true };
        eval(&compile(&statement.right, &scope).unwrap(), &mut [C64::real(PI / 3.0)], &[])
    }

    fn near(source: &str, re: f64, im: f64) {
        let got = value(source);
        assert!((got.re - re).abs() < 1e-9 && (got.im - im).abs() < 1e-9, "{source} = {got:?}, expected {re} + {im}i");
    }

    #[test]
    fn every_way_of_writing_a_complex_number() {
        near("3 + 4i", 3.0, 4.0);
        near("2 - i", 2.0, -1.0);
        near("2e^(iπ/3)", 1.0, 3.0_f64.sqrt());
        near("cos(φ) + i sin(φ)", 0.5, 3.0_f64.sqrt() / 2.0);
        near("2(cos φ + i*sin φ)", 1.0, 3.0_f64.sqrt());
        near("e^(iπ) + 1", 0.0, 0.0);
        near("(1 + i)^2", 0.0, 2.0);
        near("1/(1 + i)", 0.5, -0.5);
        near("i^i", (-PI / 2.0).exp(), 0.0);
    }

    #[test]
    fn functions_take_principal_values() {
        near("sqrt(-4)", 0.0, 2.0);
        near("ln(-1)", 0.0, PI);
        near("|3 + 4i|", 5.0, 0.0);
        near("arg(-1)", PI, 0.0);
        near("arg(i)", PI / 2.0, 0.0);
        near("Re(3 - 2i) + Im(3 - 2i)", 1.0, 0.0);
        near("conj(3 - 2i)", 3.0, 2.0);
        near("(-8)^(1/3)", 1.0, 3.0_f64.sqrt());
        near("sin(i)", 0.0, 1.0_f64.sinh());
        near("sqrt(9)", 3.0, 0.0);
        near("asin(2)", FRAC_PI_2, -(2.0 + 3.0_f64.sqrt()).ln());
    }
}
