//! Tokens of one expression row, read forgivingly. A run of letters splits into known words (function names,
//! Greek letter names, `inf`, `deg`; any case from two letters up) and single-letter identifiers, so `2xsin x`
//! reads as `2 · x · sin x`; `a_1` and `log_2` keep their subscript. Outside parentheses `0,5` is a decimal
//! comma, `x2` is `x²` for the plot variables, and `°`, `∞`, `∛` and superscripts such as `x⁻¹` are understood.

use crate::builtins::NAMES;
use crate::error::MathError;

#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    Num(f64),
    Ident(String),
    Op(char),
}

const GREEK: [(&str, char); 14] = [
    ("epsilon", 'ε'),
    ("lambda", 'λ'),
    ("alpha", 'α'),
    ("gamma", 'γ'),
    ("delta", 'δ'),
    ("omega", 'ω'),
    ("sigma", 'σ'),
    ("theta", 'θ'),
    ("beta", 'β'),
    ("phi", 'φ'),
    ("rho", 'ρ'),
    ("tau", 'τ'),
    ("mu", 'μ'),
    ("pi", 'π'),
];

/// The plot variables a trailing digit squares or cubes: `x2` is `x²`.
const POWERED: [&str; 4] = ["x", "y", "t", "θ"];

fn is_letter(c: char) -> bool {
    c.is_ascii_alphabetic() || ('\u{391}'..='\u{3c9}').contains(&c)
}

/// Words match regardless of case, so `Sin x`, `PI` and `Theta` work; single letters keep their case.
fn starts_with(letters: &[char], word: &str) -> bool {
    word.chars().count() <= letters.len() && word.chars().zip(letters).all(|(a, b)| a == b.to_ascii_lowercase())
}

fn split_word(letters: &[char], tokens: &mut Vec<Tok>) {
    let mut at = 0;
    while at < letters.len() {
        let rest = &letters[at..];
        let mut best: Option<(usize, Tok)> = None;
        let mut consider = |word: &str, token: Tok| {
            let len = word.chars().count();
            if starts_with(rest, word) && best.as_ref().is_none_or(|(longest, _)| len > *longest) {
                best = Some((len, token));
            }
        };
        for (word, _) in NAMES {
            consider(word, Tok::Ident(word.to_string()));
        }
        for (word, letter) in GREEK {
            consider(word, Tok::Ident(letter.to_string()));
        }
        consider("infinity", Tok::Ident("∞".into()));
        consider("inf", Tok::Ident("∞".into()));
        consider("deg", Tok::Op('°'));
        match best {
            Some((len, token)) => {
                tokens.push(token);
                at += len;
            }
            None => {
                tokens.push(Tok::Ident(rest[0].to_string()));
                at += 1;
            }
        }
    }
}

fn superscript(c: char) -> Option<char> {
    let digits = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    if c == '⁻' {
        return Some('-');
    }
    digits.iter().position(|digit| *digit == c).and_then(|value| char::from_digit(value as u32, 10))
}

pub fn tokenize(source: &str) -> Result<Vec<Tok>, MathError> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut depth = 0_i32;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(char::is_ascii_digit)) {
            let start = i;
            while chars.get(i).is_some_and(char::is_ascii_digit) {
                i += 1;
            }
            let mut text: String = chars[start..i].iter().collect();
            // A comma only separates arguments and coordinates inside parentheses; outside, `0,5` is one half.
            let decimal = chars.get(i) == Some(&'.') || (chars.get(i) == Some(&',') && depth == 0 && chars.get(i + 1).is_some_and(char::is_ascii_digit));
            if decimal {
                i += 1;
                let fraction = i;
                while chars.get(i).is_some_and(char::is_ascii_digit) {
                    i += 1;
                }
                text.push('.');
                text.extend(&chars[fraction..i]);
            }
            let value = text.parse::<f64>().map_err(|_| MathError::new("error.unexpected", text))?;
            tokens.push(Tok::Num(value));
            continue;
        }
        if is_letter(c) {
            let start = i;
            while chars.get(i).copied().is_some_and(is_letter) {
                i += 1;
            }
            // `Re z` and `Im z`, capitalized as in print; lower-case `re`/`im` stay products such as r·e.
            match chars[start..i] {
                ['R', 'e'] => tokens.push(Tok::Ident("real".into())),
                ['I', 'm'] => tokens.push(Tok::Ident("imag".into())),
                _ => split_word(&chars[start..i], &mut tokens),
            }
            if chars.get(i) == Some(&'_') {
                i += 1;
                let braced = chars.get(i) == Some(&'{');
                if braced {
                    i += 1;
                }
                let start = i;
                while chars.get(i).is_some_and(char::is_ascii_alphanumeric) {
                    i += 1;
                }
                if start == i || (braced && chars.get(i) != Some(&'}')) {
                    return Err(MathError::new("error.unexpected", "_"));
                }
                let subscript: String = chars[start..i].iter().collect();
                if braced {
                    i += 1;
                }
                if let Some(Tok::Ident(name)) = tokens.last_mut() {
                    name.push('_');
                    name.push_str(&subscript);
                }
            } else if matches!(tokens.last(), Some(Tok::Ident(name)) if POWERED.contains(&name.as_str()))
                && chars.get(i).is_some_and(char::is_ascii_digit)
                && !chars.get(i + 1).is_some_and(|next| next.is_ascii_digit() || *next == '.')
            {
                tokens.push(Tok::Op('^'));
            }
            continue;
        }
        if superscript(c).is_some() {
            let start = i;
            while chars.get(i).copied().and_then(superscript).is_some() {
                i += 1;
            }
            let text: String = chars[start..i].iter().filter_map(|c| superscript(*c)).collect();
            let (negative, digits) = text.strip_prefix('-').map_or((false, text.as_str()), |rest| (true, rest));
            let value = digits.parse::<f64>().map_err(|_| MathError::new("error.unexpected", chars[start..i].iter().collect::<String>()))?;
            tokens.push(Tok::Op('^'));
            if negative {
                tokens.push(Tok::Op('-'));
            }
            tokens.push(Tok::Num(value));
            continue;
        }
        i += 1;
        let op = match c {
            '*' if chars.get(i) == Some(&'*') => {
                i += 1;
                '^'
            }
            ':' if chars.get(i) == Some(&'=') => {
                i += 1;
                '='
            }
            '<' | '>' if chars.get(i) == Some(&'=') => {
                i += 1;
                if c == '<' { '≤' } else { '≥' }
            }
            '<' | '>' | '≤' | '≥' => c,
            '⩽' => '≤',
            '⩾' => '≥',
            '+' | '/' | '^' | ',' | '=' | '|' | '!' | '√' | '∛' | '°' | '*' => c,
            '(' | '[' | '{' => {
                depth += 1;
                '('
            }
            ')' | ']' | '}' => {
                depth -= 1;
                ')'
            }
            '-' | '−' | '–' => '-',
            '×' | '·' | '⋅' | '∗' => '*',
            '÷' => '/',
            '∞' => {
                tokens.push(Tok::Ident("∞".into()));
                continue;
            }
            other => return Err(MathError::new("error.unexpected", other.to_string())),
        };
        tokens.push(Tok::Op(op));
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idents(source: &str) -> Vec<String> {
        tokenize(source)
            .unwrap()
            .into_iter()
            .map(|token| match token {
                Tok::Ident(name) => name,
                Tok::Num(value) => value.to_string(),
                Tok::Op(op) => op.to_string(),
            })
            .collect()
    }

    #[test]
    fn letter_runs_split_into_words_and_letters() {
        assert_eq!(idents("2xsin x"), ["2", "x", "sin", "x"]);
        assert_eq!(idents("atan(x)"), ["atan", "(", "x", ")"]);
        assert_eq!(idents("exp"), ["exp"]);
        assert_eq!(idents("ex"), ["e", "x"]);
        assert_eq!(idents("sinh x"), ["sinh", "x"]);
        assert_eq!(idents("cos(theta)"), ["cos", "(", "θ", ")"]);
        assert_eq!(idents("2pi"), ["2", "π"]);
    }

    #[test]
    fn subscripts_and_symbols() {
        assert_eq!(idents("a_1 + b_{12}"), ["a_1", "+", "b_12"]);
        assert_eq!(idents("x² − 3·x"), ["x", "^", "2", "-", "3", "*", "x"]);
        assert_eq!(idents("2**x"), ["2", "^", "x"]);
        assert_eq!(idents(".5"), ["0.5"]);
        assert!(tokenize("x $ 2").is_err());
    }

    #[test]
    fn forgiving_spellings() {
        assert_eq!(idents("0,5x"), ["0.5", "x"]);
        assert_eq!(idents("(0,5)"), ["(", "0", ",", "5", ")"]);
        assert_eq!(idents("x2 + 3x"), ["x", "^", "2", "+", "3", "x"]);
        assert_eq!(idents("x10"), ["x", "10"]);
        assert_eq!(idents("a2"), ["a", "2"]);
        assert_eq!(idents("30°"), ["30", "°"]);
        assert_eq!(idents("30deg"), ["30", "°"]);
        assert_eq!(idents("INF + ∞"), ["∞", "+", "∞"]);
        assert_eq!(idents("x⁻¹²"), ["x", "^", "-", "12"]);
        assert_eq!(idents("Sin X"), ["sin", "X"]);
        assert_eq!(idents("PI Theta phi"), ["π", "θ", "φ"]);
        assert_eq!(idents("f(x) := x"), ["f", "(", "x", ")", "=", "x"]);
        assert_eq!(idents("log_2 x"), ["log_2", "x"]);
        assert_eq!(idents("∛x"), ["∛", "x"]);
    }

    #[test]
    fn relations_and_complex_parts() {
        assert_eq!(idents("|z+2| < 3"), ["|", "z", "+", "2", "|", "<", "3"]);
        assert_eq!(idents("x <= 1 >= ≤ ≥"), ["x", "≤", "1", "≥", "≤", "≥"]);
        assert_eq!(idents("Re(z) + Im z"), ["real", "(", "z", ")", "+", "imag", "z"]);
        assert_eq!(idents("re^(iθ)"), ["r", "e", "^", "(", "i", "θ", ")"]);
        assert_eq!(idents("conj(z) arg z"), ["conj", "(", "z", ")", "arg", "z"]);
    }
}
