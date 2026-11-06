# Grapher

Plot functions in Cartesian, trigonometric, polar and parametric coordinates, with live sliders and a zoomable graph.

## Use

Open **Grapher** in the left sidebar. The header switches the coordinate system; each one keeps its own expressions:

| System | Grid | Typical rows |
| --- | --- | --- |
| Cartesian | decimal | `y = x^2`, `x = y^2`, `f(x) = sin x`, `x^2 + y^2 = 4`, `(1, 2)` |
| Trigonometric | x-axis in multiples of π, radians | `sin(x)`, `tan x`, `y = A sin(k x)` |
| Polar | circles and rays labelled in radians | `r = 1 + cos(θ)` (type `theta` or `t` for θ) |
| Parametric | decimal | `(cos(3t), sin(2t))` |
| 3D | cube with floor grid, drag to orbit | `z = x^2 + y^2` or just `x^2 + y^2`, `x = y z`, `(cos t, sin t, t)`, `(1, 2, 3)` |
| Complex | Gaussian plane, imaginary axis in multiples of i | `3 - 2i`, `w = 2e^(iπ/3)`, `r(cos φ + i sin φ)`, `\|z + 2\| < 3`, `Re(z) ≥ 1`, `arg(z) < π/4`, `\|z - i\| = \|z + 1\|` |

Inequalities such as `y > x^2` or `x^2 + y^2 ≤ 4` shade their region, with a dashed boundary when it is excluded. On the complex sheet every number is drawn as an arrow from 0 and shown in both forms (`1 + 1.732i = 2·e^(iπ/3)`), `Re`, `Im`, `conj` and `arg` are available, and a relation in `z` (or its parts `x` and `y`) draws its region, or only its boundary with `=`. A row `a = 1` becomes a slider, and every undefined name offers one. Polar and parametric rows set their range below the input (default 0 to 2π). Rows may use `π`, `e`, `|x|`, `x!`, `sqrt`, `cbrt`, `ln`, `log`, `exp`, the trigonometric, inverse and hyperbolic functions, `min`, `max`, `mod`, `floor`, `ceil`, `round` and `sign`; `2x`, `sin 2x`, `sin^2 x` and `sin^-1 x` read as usual. Input is forgiving: Greek letters and constants may be typed as words in any case (`theta`, `Phi`, `PI`, `inf`), `30°` or `30deg` is in degrees, `log_2 x`, `root(x, 3)`, `∛x`, `x⁻¹` and `f(x) := …` work, parentheses and bars left open at the end close themselves, stray closing parentheses at the end are ignored, `0,5` outside parentheses is a decimal comma, and `x2` means `x²` for the plot variables `x`, `y`, `t` and `θ`. Enter adds a row, Backspace on an empty row removes it, the swatch shows or hides a graph and its context menu picks the colour.

The open-page button in the header opens the graph in the workspace: drag to pan, scroll or pinch to zoom about the pointer, hover a graph to read its coordinates, or use the arrow keys, `+`, `−` and `0` with the graph focused. Sheets are saved to `.valley/plugins/data/grapher/graphs.json`.

## Install

Copy this repository into `<vault>/.valley/plugins/packages/local/grapher`. The compiled `runtime/` (`index.js`, locales and `assets/plot.wasm`) is included; Valley does not install dependencies or compile plugins on load.

## Development

Use Node 24.19.0 and npm 11.17.0, plus rustup: `rust-toolchain.toml` selects Rust 1.99.1 with the `wasm32-unknown-unknown` target, and the build needs binaryen's `wasm-opt` version 133 (`VALLEY_WASM_OPT` or on `PATH`). Run `npm ci` and `npm run check` in this directory; it lints, typechecks, builds the WebAssembly module twice to prove the bytes are reproducible, bundles `runtime/index.js` and runs the tests against the built module. When the Rust source changes, the build reports the new module digest: record it as `runtime.wasm[0].sha256` in `config.json`.

The plotting kernel lives in `src/wasm` (Rust): the lexer and parser, the sheet analysis that resolves parameters and user functions, the adaptive sampler for functions, polar and parametric curves, implicit equations and inequalities (marching squares, joined into polylines, and filled regions), complex arithmetic with principal values for the complex sheet, and the 3D renderer that samples surfaces on a grid, clips surfaces and space curves to the visible cube, projects them for the orbiting camera, shades them and orders them back to front. Run its unit tests from `src/wasm` with host flags, since `.cargo/config.toml` carries the WebAssembly link arguments:

```bash
RUSTFLAGS="-Cdebuginfo=0" cargo test
```

The TypeScript side (`src/`) holds the store, the sidebar, the canvas drawing, the axis ticks and the localization in five languages.
