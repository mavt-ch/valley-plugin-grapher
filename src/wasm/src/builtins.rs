//! The built-in functions an expression may call, with their spellings, arities and inverses.

use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Builtin {
    Sin,
    Cos,
    Tan,
    Cot,
    Sec,
    Csc,
    Asin,
    Acos,
    Atan,
    Acot,
    Sinh,
    Cosh,
    Tanh,
    Coth,
    Asinh,
    Acosh,
    Atanh,
    Sqrt,
    Cbrt,
    Abs,
    Sign,
    Ln,
    Log,
    Exp,
    Floor,
    Ceil,
    Round,
    Min,
    Max,
    Mod,
    Root,
}

/// Every accepted spelling. The lexer splits letter runs on these words, longest first.
pub const NAMES: [(&str, Builtin); 44] = [
    ("sin", Builtin::Sin),
    ("cos", Builtin::Cos),
    ("tan", Builtin::Tan),
    ("cot", Builtin::Cot),
    ("sec", Builtin::Sec),
    ("csc", Builtin::Csc),
    ("arcsin", Builtin::Asin),
    ("asin", Builtin::Asin),
    ("arccos", Builtin::Acos),
    ("acos", Builtin::Acos),
    ("arctan", Builtin::Atan),
    ("atan", Builtin::Atan),
    ("arccot", Builtin::Acot),
    ("acot", Builtin::Acot),
    ("sinh", Builtin::Sinh),
    ("cosh", Builtin::Cosh),
    ("tanh", Builtin::Tanh),
    ("coth", Builtin::Coth),
    ("arsinh", Builtin::Asinh),
    ("arcsinh", Builtin::Asinh),
    ("asinh", Builtin::Asinh),
    ("arcosh", Builtin::Acosh),
    ("arccosh", Builtin::Acosh),
    ("acosh", Builtin::Acosh),
    ("artanh", Builtin::Atanh),
    ("arctanh", Builtin::Atanh),
    ("atanh", Builtin::Atanh),
    ("sqrt", Builtin::Sqrt),
    ("cbrt", Builtin::Cbrt),
    ("abs", Builtin::Abs),
    ("sign", Builtin::Sign),
    ("sgn", Builtin::Sign),
    ("ln", Builtin::Ln),
    ("log", Builtin::Log),
    ("lg", Builtin::Log),
    ("exp", Builtin::Exp),
    ("floor", Builtin::Floor),
    ("ceil", Builtin::Ceil),
    ("round", Builtin::Round),
    ("min", Builtin::Min),
    ("max", Builtin::Max),
    ("mod", Builtin::Mod),
    ("root", Builtin::Root),
    ("nthroot", Builtin::Root),
];

impl Builtin {
    pub fn lookup(name: &str) -> Option<Self> {
        NAMES.iter().find(|(spelling, _)| *spelling == name).map(|(_, builtin)| *builtin)
    }

    /// Inclusive bounds on the argument count.
    pub fn arity(self) -> (usize, usize) {
        match self {
            Self::Atan => (1, 2),
            Self::Min | Self::Max => (1, 64),
            Self::Mod | Self::Root => (2, 2),
            _ => (1, 1),
        }
    }

    /// `sin^-1` reads as `arcsin`.
    pub fn inverse(self) -> Option<Self> {
        match self {
            Self::Sin => Some(Self::Asin),
            Self::Cos => Some(Self::Acos),
            Self::Tan => Some(Self::Atan),
            Self::Cot => Some(Self::Acot),
            Self::Sinh => Some(Self::Asinh),
            Self::Cosh => Some(Self::Acosh),
            Self::Tanh => Some(Self::Atanh),
            _ => None,
        }
    }

    pub fn apply1(self, x: f64) -> f64 {
        match self {
            Self::Sin => x.sin(),
            Self::Cos => x.cos(),
            Self::Tan => x.tan(),
            Self::Cot => 1.0 / x.tan(),
            Self::Sec => 1.0 / x.cos(),
            Self::Csc => 1.0 / x.sin(),
            Self::Asin => x.asin(),
            Self::Acos => x.acos(),
            Self::Atan => x.atan(),
            Self::Acot => PI / 2.0 - x.atan(),
            Self::Sinh => x.sinh(),
            Self::Cosh => x.cosh(),
            Self::Tanh => x.tanh(),
            Self::Coth => 1.0 / x.tanh(),
            Self::Asinh => x.asinh(),
            Self::Acosh => x.acosh(),
            Self::Atanh => x.atanh(),
            Self::Sqrt => x.sqrt(),
            Self::Cbrt => x.cbrt(),
            Self::Abs => x.abs(),
            Self::Sign => sign(x),
            Self::Ln => x.ln(),
            Self::Log => x.log10(),
            Self::Exp => x.exp(),
            Self::Floor => x.floor(),
            Self::Ceil => x.ceil(),
            Self::Round => x.round(),
            Self::Min | Self::Max => x,
            Self::Mod | Self::Root => f64::NAN,
        }
    }

    pub fn apply(self, args: &[f64]) -> f64 {
        match (self, args) {
            (_, [x]) => self.apply1(*x),
            (Self::Atan, [y, x]) => y.atan2(*x),
            (Self::Mod, [a, b]) => a.rem_euclid(*b),
            (Self::Root, [x, n]) => crate::eval::real_pow(*x, 1.0 / n),
            (Self::Min, values) => values.iter().copied().fold(f64::INFINITY, f64::min),
            (Self::Max, values) => values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            _ => f64::NAN,
        }
    }
}

fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spellings_resolve_to_one_function() {
        assert_eq!(Builtin::lookup("arcsin"), Some(Builtin::Asin));
        assert_eq!(Builtin::lookup("asin"), Some(Builtin::Asin));
        assert_eq!(Builtin::lookup("lg"), Some(Builtin::Log));
        assert_eq!(Builtin::lookup("f"), None);
    }

    #[test]
    fn multi_argument_functions() {
        assert_eq!(Builtin::Mod.apply(&[-1.0, 3.0]), 2.0);
        assert_eq!(Builtin::Max.apply(&[1.0, 4.0, 2.0]), 4.0);
        assert_eq!(Builtin::Min.apply(&[1.0, 4.0, -2.0]), -2.0);
        assert!((Builtin::Atan.apply(&[1.0, -1.0]) - 3.0 * PI / 4.0).abs() < 1e-12);
        assert_eq!(Builtin::Sign.apply1(-0.5), -1.0);
    }
}
