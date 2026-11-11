//! The text the JavaScript side exchanges with the module. Rows are separated by U+001E and fields by U+001F,
//! which an expression never contains (the plugin strips both before encoding).
//!
//! In: `text, from, to, hidden` per row. Out, per row, a kind and its fields:
//! `empty` · `error key param missing,names` · `param name value slider` · `value number` · `function x|y` ·
//! `definition name` · `polar from to` · `curve from to` · `point x y` · `implicit` · `surface x|y|z` ·
//! `curve3 from to` · `point3 x y z` · `region strict|loose` · `cpoint re im name` · `csurface modulus|real`.

use crate::sheet::{Outcome, Plot, RowInput, Sheet};

pub const RECORD: char = '\u{1e}';
pub const FIELD: char = '\u{1f}';

pub fn read_rows(text: &str) -> Vec<RowInput> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split(RECORD)
        .map(|record| {
            let mut fields = record.split(FIELD);
            let mut next = || fields.next().unwrap_or_default().to_string();
            let (text, from, to, hidden) = (next(), next(), next(), next());
            RowInput { text, from, to, hidden: hidden == "1" }
        })
        .collect()
}

fn number(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value.is_infinite() {
        if value > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else {
        format!("{value}")
    }
}

pub fn write_outcomes(sheet: &Sheet) -> String {
    let field = FIELD.to_string();
    sheet
        .rows
        .iter()
        .map(|row| {
            let fields: Vec<String> = match &row.outcome {
                Outcome::Empty => vec!["empty".into()],
                Outcome::Error(error) => vec!["error".into(), error.key.into(), error.param.clone(), error.missing.join(",")],
                Outcome::Parameter { name, value, slider } => vec!["param".into(), name.clone(), number(*value), if *slider { "1" } else { "0" }.into()],
                Outcome::Value(value) => vec!["value".into(), number(*value)],
                Outcome::Definition { name } => vec!["definition".into(), name.clone()],
                Outcome::Plotted(Plot::FunctionX(_)) => vec!["function".into(), "x".into()],
                Outcome::Plotted(Plot::FunctionY(_)) => vec!["function".into(), "y".into()],
                Outcome::Plotted(Plot::Polar { from, to, .. }) => vec!["polar".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Curve { from, to, .. }) => vec!["curve".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Point { x, y }) => vec!["point".into(), number(*x), number(*y)],
                Outcome::Plotted(Plot::Implicit(_)) => vec!["implicit".into()],
                Outcome::Plotted(Plot::Region { relation, .. }) => vec!["region".into(), if relation.strict() { "strict" } else { "loose" }.into()],
                Outcome::Plotted(Plot::ComplexPoint { re, im, name }) => vec!["cpoint".into(), number(*re), number(*im), name.clone()],
                Outcome::Plotted(Plot::Surface { axis, .. }) => vec!["surface".into(), axis.name().into()],
                Outcome::Plotted(Plot::Curve3 { from, to, .. }) => vec!["curve3".into(), number(*from), number(*to)],
                Outcome::Plotted(Plot::Point3 { x, y, z }) => vec!["point3".into(), number(*x), number(*y), number(*z)],
                Outcome::Plotted(Plot::ComplexSurface { height, .. }) => vec!["csurface".into(), height.name().into()],
            };
            fields.join(&field)
        })
        .collect::<Vec<_>>()
        .join(&RECORD.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{Mode, analyze};

    #[test]
    fn rows_round_trip_through_the_text_protocol() {
        let rows = read_rows("y = a x\u{1f}\u{1f}\u{1f}0\u{1e}a = 2\u{1f}\u{1f}\u{1f}1\u{1e}r = 2\u{1f}0\u{1f}π\u{1f}0\u{1e}\u{1f}\u{1f}\u{1f}0\u{1e}k");
        assert_eq!(rows.len(), 5);
        assert!(rows[1].hidden);
        assert_eq!(rows[2].to, "π");
        let text = write_outcomes(&analyze(Mode::Cartesian, &rows));
        let records: Vec<&str> = text.split(RECORD).collect();
        assert_eq!(records[0], "function\u{1f}x");
        assert_eq!(records[1], "param\u{1f}a\u{1f}2\u{1f}1");
        assert!(records[2].starts_with("polar\u{1f}0\u{1f}3.14159"));
        assert_eq!(records[3], "empty");
        assert_eq!(records[4], "error\u{1f}error.unknown\u{1f}k\u{1f}k");
        assert!(read_rows("").is_empty());
        assert_eq!(number(f64::NEG_INFINITY), "-Infinity");
    }
}
