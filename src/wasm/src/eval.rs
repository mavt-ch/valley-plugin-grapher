//! Compiled expressions: variables resolve to slots of one environment array, user functions to indices.
//! A user-function call writes its argument into the parameter's slot, evaluates the body and restores the
//! slot, so `f(x + 1)` inside a plot of `x` sees the outer `x` again afterwards.

use std::collections::HashMap;
use std::f64::consts::{E, PI, TAU};

use crate::builtins::Builtin;
use crate::error::MathError;
use crate::parser::{BinOp, Callee, Node};

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Slot(usize),
    Neg(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
    Builtin(Builtin, Vec<Expr>),
    User(usize, Box<Expr>),
    Fact(Box<Expr>),
}

#[derive(Clone, Debug)]
pub struct UserFn {
    pub slot: usize,
    pub body: Expr,
}

pub fn constant(name: &str) -> Option<f64> {
    match name {
        "π" => Some(PI),
        "τ" => Some(TAU),
        "e" => Some(E),
        "∞" => Some(f64::INFINITY),
        _ => None,
    }
}

/// What a compiled expression may name: `slots` for variables it is allowed to read, `functions` for calls.
pub struct Scope<'a> {
    pub slots: &'a HashMap<String, usize>,
    pub functions: &'a HashMap<String, usize>,
    pub allow: &'a dyn Fn(&str) -> bool,
}

pub fn compile(node: &Node, scope: &Scope) -> Result<Expr, MathError> {
    Ok(match node {
        Node::Num(value) => Expr::Num(*value),
        Node::Var(name) => match (constant(name), scope.slots.get(name)) {
            (Some(value), _) => Expr::Num(value),
            (None, Some(slot)) if (scope.allow)(name) => Expr::Slot(*slot),
            _ => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Neg(arg) => Expr::Neg(Box::new(compile(arg, scope)?)),
        Node::Bin(op, left, right) => Expr::Bin(*op, Box::new(compile(left, scope)?), Box::new(compile(right, scope)?)),
        Node::Call(Callee::Builtin(builtin), args) => {
            Expr::Builtin(*builtin, args.iter().map(|arg| compile(arg, scope)).collect::<Result<_, _>>()?)
        }
        Node::Call(Callee::User(name), args) => match (scope.functions.get(name), args.as_slice()) {
            (Some(index), [arg]) => Expr::User(*index, Box::new(compile(arg, scope)?)),
            (Some(_), _) => return Err(MathError::new("error.arity", name.clone())),
            (None, _) => return Err(MathError::new("error.unknown", name.clone())),
        },
        Node::Fact(arg) => Expr::Fact(Box::new(compile(arg, scope)?)),
        Node::Tuple(_) => return Err(MathError::new("error.tuple", "")),
    })
}

pub fn eval(expr: &Expr, env: &mut [f64], functions: &[UserFn]) -> f64 {
    match expr {
        Expr::Num(value) => *value,
        Expr::Slot(slot) => env[*slot],
        Expr::Neg(arg) => -eval(arg, env, functions),
        Expr::Bin(op, left, right) => {
            let a = eval(left, env, functions);
            let b = eval(right, env, functions);
            match op {
                BinOp::Add => a + b,
                BinOp::Sub => a - b,
                BinOp::Mul => a * b,
                BinOp::Div => a / b,
                BinOp::Pow => real_pow(a, b),
            }
        }
        Expr::Builtin(builtin, args) => match args.as_slice() {
            [arg] => builtin.apply1(eval(arg, env, functions)),
            _ => {
                let values: Vec<f64> = args.iter().map(|arg| eval(arg, env, functions)).collect();
                builtin.apply(&values)
            }
        },
        Expr::User(index, arg) => {
            let value = eval(arg, env, functions);
            let function = &functions[*index];
            let saved = std::mem::replace(&mut env[function.slot], value);
            let result = eval(&function.body, env, functions);
            env[function.slot] = saved;
            result
        }
        Expr::Fact(arg) => factorial(eval(arg, env, functions)),
    }
}

/// `powf`, except that a negative base with a rational exponent of odd denominator keeps its real root:
/// `(-8)^(1/3)` is `-2` and `x^(2/3)` is defined left of zero.
pub fn real_pow(base: f64, exponent: f64) -> f64 {
    if base >= 0.0 || base.is_nan() || !exponent.is_finite() || exponent.fract() == 0.0 {
        return base.powf(exponent);
    }
    for denominator in (1..=15).step_by(2) {
        let numerator = exponent * f64::from(denominator);
        let rounded = numerator.round();
        if (numerator - rounded).abs() < 1e-9 {
            let magnitude = (-base).powf(exponent);
            return if rounded.rem_euclid(2.0) == 0.0 { magnitude } else { -magnitude };
        }
    }
    f64::NAN
}

pub fn factorial(n: f64) -> f64 {
    if n.fract() == 0.0 {
        if n < 0.0 {
            return f64::NAN;
        }
        if n <= 170.0 {
            return (2..=n as u32).fold(1.0, |product, k| product * f64::from(k));
        }
        return f64::INFINITY;
    }
    gamma(n + 1.0)
}

/// Lanczos approximation (g = 7, nine coefficients), reflected below one half.
fn gamma(x: f64) -> f64 {
    const COEFFICIENTS: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        return PI / ((PI * x).sin() * gamma(1.0 - x));
    }
    let x = x - 1.0;
    let t = x + 7.5;
    let sum = COEFFICIENTS.iter().enumerate().skip(1).fold(COEFFICIENTS[0], |sum, (i, c)| sum + c / (x + i as f64));
    (2.0 * PI).sqrt() * t.powf(x + 0.5) * (-t).exp() * sum
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;
    use crate::parser::parse;
    use std::collections::HashSet;

    fn value(source: &str, x: f64) -> f64 {
        let statement = parse(&tokenize(source).unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("x".to_string(), 0)].into();
        let functions = HashMap::new();
        let scope = Scope { slots: &slots, functions: &functions, allow: &|_| true };
        let expr = compile(&statement.right, &scope).unwrap();
        eval(&expr, &mut [x], &[])
    }

    #[test]
    fn arithmetic_and_constants() {
        assert_eq!(value("2x^2 + 1", 3.0), 19.0);
        assert!((value("sin(π/2)", 0.0) - 1.0).abs() < 1e-12);
        assert!((value("2πx", 1.0) - TAU).abs() < 1e-12);
        assert_eq!(value("|x - 5|", 2.0), 3.0);
        assert_eq!(value("1/x", 0.0), f64::INFINITY);
        assert!(value("sqrt(x)", -1.0).is_nan());
    }

    #[test]
    fn real_roots_of_negative_numbers() {
        assert!((real_pow(-8.0, 1.0 / 3.0) + 2.0).abs() < 1e-12);
        assert!((real_pow(-8.0, 2.0 / 3.0) - 4.0).abs() < 1e-12);
        assert!(real_pow(-2.0, 0.5).is_nan());
        assert_eq!(real_pow(-2.0, 3.0), -8.0);
    }

    #[test]
    fn factorials_extend_through_gamma() {
        assert_eq!(factorial(5.0), 120.0);
        assert_eq!(factorial(0.0), 1.0);
        assert!((factorial(0.5) - PI.sqrt() / 2.0).abs() < 1e-10);
        assert!(factorial(-1.0).is_nan());
        assert_eq!(value("3!", 0.0), 6.0);
    }

    #[test]
    fn unknown_names_and_tuples_are_refused() {
        let statement = parse(&tokenize("a x").unwrap(), &HashSet::new()).unwrap();
        let slots: HashMap<String, usize> = [("x".to_string(), 0)].into();
        let functions = HashMap::new();
        let scope = Scope { slots: &slots, functions: &functions, allow: &|_| true };
        assert_eq!(compile(&statement.right, &scope).unwrap_err().key, "error.unknown");
        let tuple = parse(&tokenize("2(1, 2)").unwrap(), &HashSet::new()).unwrap();
        assert_eq!(compile(&tuple.right, &scope).unwrap_err().key, "error.tuple");
    }

    #[test]
    fn forgiving_input_still_evaluates() {
        let close = |source: &str, x: f64, expected: f64| {
            let got = value(source, x);
            assert!((got - expected).abs() < 1e-9, "{source} at {x}: {got} != {expected}");
        };
        close("sin(30°)", 0.0, 0.5);
        close("sin(x", PI / 2.0, 1.0);
        close("(x+1)(x-1", 3.0, 8.0);
        close("|x - 2", 0.0, 2.0);
        close("x^2)", 3.0, 9.0);
        close("x^2))", 3.0, 9.0);
        close("log_2 8", 0.0, 3.0);
        close("log_10(1000)", 0.0, 3.0);
        close("log_e e", 0.0, 1.0);
        close("sqrt x", 9.0, 3.0);
        close("ln x", E, 1.0);
        close("∛x", -8.0, -2.0);
        close("root(x, 3)", 27.0, 3.0);
        close("0,5x", 4.0, 2.0);
        close("x2 + 1", 3.0, 10.0);
        close("e^x", 0.0, 1.0);
        close("x⁻¹", 4.0, 0.25);
        close("2pi", 0.0, TAU);
        close("Sin(x) + PI", 0.0, PI);
        close("2^3^2", 0.0, 512.0);
        close("1/inf", 0.0, 0.0);
        close("cos(180deg)", 0.0, -1.0);
    }
}
