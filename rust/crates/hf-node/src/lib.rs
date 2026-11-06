use hf_media_kernels::{Transfer, blit_rgba8_over_rgb48le, transfer_lut};
use napi::Error;
use napi::bindgen_prelude::{Buffer, Result};
use napi_derive::napi;

fn parse_transfer(value: &str) -> Result<Transfer> {
    match value {
        "hlg" => Ok(Transfer::Hlg),
        "pq" => Ok(Transfer::Pq),
        "srgb" => Ok(Transfer::Srgb),
        _ => Err(Error::from_reason(format!(
            "HF_UNSUPPORTED_TRANSFER: unsupported transfer function: {value}"
        ))),
    }
}

/// Native Node boundary for the HDR DOM-overlay kernel.
///
/// The JavaScript wrapper keeps this opt-in. The function accepts Node Buffers
/// directly and mutates the RGB48LE canvas in place, avoiding a per-pixel FFI
/// call or a JSON serialization boundary.
#[napi(js_name = "blitRgba8OverRgb48leNative")]
pub fn blit_rgba8_over_rgb48le_native(
    dom_rgba: Buffer,
    mut canvas: Buffer,
    width: i64,
    height: i64,
    transfer: String,
) -> Result<()> {
    let width = usize::try_from(width)
        .map_err(|_| Error::from_reason("HF_INVALID_DIMENSIONS: width must be positive"))?;
    let height = usize::try_from(height)
        .map_err(|_| Error::from_reason("HF_INVALID_DIMENSIONS: height must be positive"))?;
    let transfer = parse_transfer(&transfer)?;
    let lut = transfer_lut(transfer);

    blit_rgba8_over_rgb48le(&dom_rgba, &mut canvas, width, height, lut)
        .map_err(|error| Error::from_reason(format!("{}: {}", error.code(), error)))
}
