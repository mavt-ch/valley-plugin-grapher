//! Grapher's plotting kernel. JavaScript writes the active sheet's rows into the buffer `plot_input(len)`
//! returns, calls `plot_analyze(mode)` and reads the per-row outcomes from `plot_text()`; then, once per
//! viewport, `plot_sample(width, height, cx, cy, scale)` fills the `f64` path stream at `plot_samples()` and
//! `plot_eval(row, value)` traces a function under the pointer. A 3D or complex 3D sheet renders with
//! `plot_space(width, height, yaw, pitch, range)` into the same `plot_samples()` buffer. Addresses point into the host-owned
//! `env.memory` and stay valid until the next call. The Valley ABI exports are present because the host
//! requires them of every module; `valley_call` answers no method.

#[forbid(unsafe_code)]
mod builtins;
#[forbid(unsafe_code)]
mod complex;
#[forbid(unsafe_code)]
mod error;
#[forbid(unsafe_code)]
mod eval;
#[forbid(unsafe_code)]
mod lexer;
#[forbid(unsafe_code)]
mod parser;
#[forbid(unsafe_code)]
mod protocol;
#[forbid(unsafe_code)]
mod sample;
#[forbid(unsafe_code)]
mod sheet;
#[forbid(unsafe_code)]
mod space;

use std::cell::RefCell;

use sample::View;
use sheet::{Mode, Sheet};
use valley_plugin_abi::{ABI_VERSION, Status, encode_response, pack_region};

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static TEXT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SAMPLES: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static SHEET: RefCell<Option<Sheet>> = const { RefCell::new(None) };
}

fn address<T>(values: &[T]) -> u32 {
    u32::try_from(values.as_ptr() as usize).unwrap_or(0)
}

fn length(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(0)
}

/// A zero-filled input buffer of `len` bytes for the rows' text; its address.
#[unsafe(no_mangle)]
pub extern "C" fn plot_input(len: u32) -> u32 {
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.clear();
        input.resize(len as usize, 0);
        address(&input)
    })
}

/// Analyses the rows in the input buffer for `mode` (0 Cartesian, 1 trigonometric, 2 polar, 3 parametric, 4 3D,
/// 5 complex, 6 complex 3D);
/// the byte length of the outcome text.
#[unsafe(no_mangle)]
pub extern "C" fn plot_analyze(mode: u32) -> u32 {
    let rows = INPUT.with(|input| protocol::read_rows(&String::from_utf8_lossy(&input.borrow())));
    let sheet = sheet::analyze(Mode::from_index(mode), &rows);
    let text = protocol::write_outcomes(&sheet).into_bytes();
    let len = length(text.len());
    TEXT.with(|out| *out.borrow_mut() = text);
    SHEET.with(|current| *current.borrow_mut() = Some(sheet));
    len
}

#[unsafe(no_mangle)]
pub extern "C" fn plot_text() -> u32 {
    TEXT.with(|text| address(&text.borrow()))
}

/// Samples the analysed sheet for a viewport of `width` × `height` CSS pixels centred on (`cx`, `cy`) at
/// `scale` pixels per unit; the number of `f64` values written.
#[unsafe(no_mangle)]
pub extern "C" fn plot_sample(width: f64, height: f64, cx: f64, cy: f64, scale: f64) -> u32 {
    let data = SHEET.with(|current| match current.borrow_mut().as_mut() {
        Some(sheet) => sample::sample(sheet, View { width, height, cx, cy, scale }),
        None => Vec::new(),
    });
    let len = length(data.len());
    SAMPLES.with(|samples| *samples.borrow_mut() = data);
    len
}

/// Projects the analysed 3D sheet for an orbiting camera; the number of `f64` values written (see `space`).
#[unsafe(no_mangle)]
pub extern "C" fn plot_space(width: f64, height: f64, yaw: f64, pitch: f64, range: f64) -> u32 {
    let data = SHEET.with(|current| match current.borrow_mut().as_mut() {
        Some(sheet) => space::render(sheet, space::Camera { width, height, yaw, pitch, range }),
        None => Vec::new(),
    });
    let len = length(data.len());
    SAMPLES.with(|samples| *samples.borrow_mut() = data);
    len
}

#[unsafe(no_mangle)]
pub extern "C" fn plot_samples() -> u32 {
    SAMPLES.with(|samples| address(&samples.borrow()))
}

#[unsafe(no_mangle)]
pub extern "C" fn plot_eval(row: u32, value: f64) -> f64 {
    SHEET.with(|current| match current.borrow_mut().as_mut() {
        Some(sheet) => sample::evaluate(sheet, row as usize, value),
        None => f64::NAN,
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_alloc(len: u32) -> u32 {
    let ptr = Box::into_raw(vec![0_u8; len as usize].into_boxed_slice()).cast::<u8>() as usize;
    u32::try_from(ptr).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_free(ptr: u32, len: u32) {
    if ptr == 0 {
        return;
    }
    // SAFETY: `ptr`/`len` describe a boxed slice this module leaked from `valley_alloc` or a response frame; the host
    // frees each region exactly once.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr as usize as *mut u8, len as usize)) });
}

/// The frame-dispatched entry: the kernel is driven through its direct exports, so every method is unknown.
#[unsafe(no_mangle)]
pub extern "C" fn valley_call(_ptr: u32, _len: u32) -> u64 {
    let frame = encode_response(Status::Error, b"grapher plot has no framed methods; call the plot_* exports").into_boxed_slice();
    let len = length(frame.len());
    let ptr = Box::into_raw(frame).cast::<u8>() as usize;
    pack_region(u32::try_from(ptr).unwrap_or(0), len)
}
