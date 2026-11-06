//! CPU kernels for HyperFrames media compositing.
//!
//! The first kernel mirrors `packages/engine/src/utils/alphaBlit.ts`'s
//! `blitRgba8OverRgb48le` operation. It deliberately uses byte-oriented
//! little-endian access so it remains correct for buffers whose address is not
//! aligned to a `u16` boundary.

use std::fmt;
use std::sync::OnceLock;

/// Transfer functions supported by the existing HDR compositor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Transfer {
    Hlg,
    Pq,
    Srgb,
}

/// Errors returned before a buffer kernel starts mutating its destination.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlitError {
    InvalidDimensions,
    DomBufferTooShort { expected: usize, actual: usize },
    CanvasBufferTooShort { expected: usize, actual: usize },
}

impl BlitError {
    /// Stable machine-readable code for the JavaScript/native boundary.
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidDimensions => "HF_INVALID_DIMENSIONS",
            Self::DomBufferTooShort { .. } => "HF_DOM_BUFFER_TOO_SHORT",
            Self::CanvasBufferTooShort { .. } => "HF_CANVAS_BUFFER_TOO_SHORT",
        }
    }
}

impl fmt::Display for BlitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDimensions => write!(f, "width and height must be positive"),
            Self::DomBufferTooShort { expected, actual } => {
                write!(
                    f,
                    "RGBA8 buffer is too short: expected {expected} bytes, got {actual}"
                )
            }
            Self::CanvasBufferTooShort { expected, actual } => write!(
                f,
                "rgb48le canvas is too short: expected {expected} bytes, got {actual}"
            ),
        }
    }
}

impl std::error::Error for BlitError {}

/// Build the same 256-entry sRGB-to-signal LUT used by the TypeScript path.
pub fn build_transfer_lut(transfer: Transfer) -> [u16; 256] {
    let mut lut = [0_u16; 256];

    // HLG OETF constants (Rec. 2100).
    let hlg_a = 0.17883277_f64;
    let hlg_b = 1.0 - 4.0 * hlg_a;
    let hlg_c = 0.5 - hlg_a * (4.0 * hlg_a).ln();
    let hlg_sdr_white = (((0.75 - hlg_c) / hlg_a).exp() + hlg_b) / 12.0;

    // PQ (SMPTE 2084) OETF constants.
    let pq_m1 = 0.1593017578125_f64;
    let pq_m2 = 78.84375_f64;
    let pq_c1 = 0.8359375_f64;
    let pq_c2 = 18.8515625_f64;
    let pq_c3 = 18.6875_f64;
    let pq_max_nits = 10_000.0_f64;
    let sdr_nits = 203.0_f64;

    for (i, slot) in lut.iter_mut().enumerate() {
        if transfer == Transfer::Srgb {
            *slot = (i * 257) as u16;
            continue;
        }

        let value = i as f64 / 255.0;
        let linear = if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        };

        let signal = match transfer {
            Transfer::Hlg => {
                let scene = linear * hlg_sdr_white;
                if scene <= 1.0 / 12.0 {
                    (3.0 * scene).sqrt()
                } else {
                    hlg_a * (12.0 * scene - hlg_b).ln() + hlg_c
                }
            }
            Transfer::Pq => {
                let lp = (linear * sdr_nits / pq_max_nits).max(0.0);
                let lm1 = lp.powf(pq_m1);
                ((pq_c1 + pq_c2 * lm1) / (1.0 + pq_c3 * lm1)).powf(pq_m2)
            }
            Transfer::Srgb => unreachable!("handled before transfer-function calculation"),
        };

        *slot = (signal * 65_535.0).round().clamp(0.0, 65_535.0) as u16;
    }

    lut
}

static HLG_LUT: OnceLock<[u16; 256]> = OnceLock::new();
static PQ_LUT: OnceLock<[u16; 256]> = OnceLock::new();
static SRGB_LUT: OnceLock<[u16; 256]> = OnceLock::new();

/// Return a process-cached transfer LUT for hot native calls.
///
/// The TypeScript implementation builds these tables once at module load. The
/// N-API boundary must not rebuild a 256-entry table for every video frame.
pub fn transfer_lut(transfer: Transfer) -> &'static [u16; 256] {
    match transfer {
        Transfer::Hlg => HLG_LUT.get_or_init(|| build_transfer_lut(Transfer::Hlg)),
        Transfer::Pq => PQ_LUT.get_or_init(|| build_transfer_lut(Transfer::Pq)),
        Transfer::Srgb => SRGB_LUT.get_or_init(|| build_transfer_lut(Transfer::Srgb)),
    }
}

#[inline(always)]
fn read_u16_le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

#[inline(always)]
fn write_u16_le(bytes: &mut [u8], offset: usize, value: u16) {
    let [low, high] = value.to_le_bytes();
    bytes[offset] = low;
    bytes[offset + 1] = high;
}

#[inline(always)]
fn blend(source: u16, destination: u16, alpha: f64) -> u16 {
    (f64::from(source) * alpha + f64::from(destination) * (1.0 - alpha))
        .round()
        .clamp(0.0, 65_535.0) as u16
}

/// Alpha-composite RGBA8 sRGB pixels over an in-place RGB48LE canvas.
///
/// This mirrors the current TypeScript operation:
/// - alpha 0 leaves the destination untouched;
/// - alpha 255 overwrites with transfer-LUT values;
/// - intermediate alpha values use the existing straight-alpha blend and
///   `Math.round`-equivalent positive rounding.
pub fn blit_rgba8_over_rgb48le(
    dom_rgba: &[u8],
    canvas: &mut [u8],
    width: usize,
    height: usize,
    lut: &[u16; 256],
) -> Result<(), BlitError> {
    if width == 0 || height == 0 {
        return Err(BlitError::InvalidDimensions);
    }

    let pixels = width
        .checked_mul(height)
        .ok_or(BlitError::InvalidDimensions)?;
    let expected_dom = pixels.checked_mul(4).ok_or(BlitError::InvalidDimensions)?;
    let expected_canvas = pixels.checked_mul(6).ok_or(BlitError::InvalidDimensions)?;

    if dom_rgba.len() < expected_dom {
        return Err(BlitError::DomBufferTooShort {
            expected: expected_dom,
            actual: dom_rgba.len(),
        });
    }
    if canvas.len() < expected_canvas {
        return Err(BlitError::CanvasBufferTooShort {
            expected: expected_canvas,
            actual: canvas.len(),
        });
    }

    for i in 0..pixels {
        let dom_offset = i * 4;
        let alpha_byte = dom_rgba[dom_offset + 3];
        if alpha_byte == 0 {
            continue;
        }

        let canvas_offset = i * 6;
        let r = lut[usize::from(dom_rgba[dom_offset])];
        let g = lut[usize::from(dom_rgba[dom_offset + 1])];
        let b = lut[usize::from(dom_rgba[dom_offset + 2])];

        if alpha_byte == 255 {
            write_u16_le(canvas, canvas_offset, r);
            write_u16_le(canvas, canvas_offset + 2, g);
            write_u16_le(canvas, canvas_offset + 4, b);
            continue;
        }

        let alpha = f64::from(alpha_byte) / 255.0;
        let destination_r = read_u16_le(canvas, canvas_offset);
        let destination_g = read_u16_le(canvas, canvas_offset + 2);
        let destination_b = read_u16_le(canvas, canvas_offset + 4);

        write_u16_le(canvas, canvas_offset, blend(r, destination_r, alpha));
        write_u16_le(canvas, canvas_offset + 2, blend(g, destination_g, alpha));
        write_u16_le(canvas, canvas_offset + 4, blend(b, destination_b, alpha));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{BlitError, Transfer, blit_rgba8_over_rgb48le, build_transfer_lut};

    #[test]
    fn transfer_luts_match_typescript_reference_values() {
        let hlg = build_transfer_lut(Transfer::Hlg);
        let pq = build_transfer_lut(Transfer::Pq);
        let srgb = build_transfer_lut(Transfer::Srgb);

        assert_eq!(hlg[0], 0);
        assert_eq!(hlg[128], 27_146);
        assert_eq!(hlg[255], 49_151);
        assert_eq!(pq[128], 28_037);
        assert_eq!(pq[255], 38_055);
        assert_eq!(srgb[128], 128 * 257);
        assert_eq!(srgb[255], 65_535);
    }

    #[test]
    fn transparent_pixels_leave_the_canvas_unchanged() {
        let lut = build_transfer_lut(Transfer::Hlg);
        let dom = [255, 0, 0, 0];
        let mut canvas = [0x34, 0x12, 0x78, 0x56, 0xbc, 0x9a];
        let original = canvas;

        blit_rgba8_over_rgb48le(&dom, &mut canvas, 1, 1, &lut).unwrap();

        assert_eq!(canvas, original);
    }

    #[test]
    fn opaque_pixels_overwrite_all_channels() {
        let lut = build_transfer_lut(Transfer::Hlg);
        let dom = [255, 128, 0, 255];
        let mut canvas = [0; 6];

        blit_rgba8_over_rgb48le(&dom, &mut canvas, 1, 1, &lut).unwrap();

        assert_eq!(read_u16(&canvas, 0), 49_151);
        assert_eq!(read_u16(&canvas, 2), 27_146);
        assert_eq!(read_u16(&canvas, 4), 0);
    }

    #[test]
    fn mixed_alpha_matches_positive_math_rounding() {
        let lut = build_transfer_lut(Transfer::Hlg);
        let dom = [255, 255, 255, 128];
        let mut canvas = [0; 6];

        blit_rgba8_over_rgb48le(&dom, &mut canvas, 1, 1, &lut).unwrap();

        let expected = (49_151.0_f64 * (128.0_f64 / 255.0_f64)).round() as u16;
        assert_eq!(read_u16(&canvas, 0), expected);
        assert_eq!(read_u16(&canvas, 2), expected);
        assert_eq!(read_u16(&canvas, 4), expected);
    }

    #[test]
    fn rejects_short_buffers_before_mutation() {
        let lut = build_transfer_lut(Transfer::Hlg);
        let mut canvas = [0; 6];
        let original = canvas;

        let error = blit_rgba8_over_rgb48le(&[0; 3], &mut canvas, 1, 1, &lut).unwrap_err();
        assert_eq!(
            error,
            BlitError::DomBufferTooShort {
                expected: 4,
                actual: 3
            }
        );
        assert_eq!(error.code(), "HF_DOM_BUFFER_TOO_SHORT");
        assert_eq!(canvas, original);

        let error = blit_rgba8_over_rgb48le(&[0; 4], &mut canvas[..5], 1, 1, &lut).unwrap_err();
        assert_eq!(
            error,
            BlitError::CanvasBufferTooShort {
                expected: 6,
                actual: 5
            }
        );
        assert_eq!(error.code(), "HF_CANVAS_BUFFER_TOO_SHORT");
        assert_eq!(canvas, original);
    }

    #[test]
    fn accepts_oddly_offset_slices() {
        let lut = build_transfer_lut(Transfer::Srgb);
        let dom_storage = [0, 255, 0, 0, 255, 255];
        let canvas_storage = [0, 0, 0, 0, 0, 0, 0];
        let dom = &dom_storage[1..5];
        let mut canvas = canvas_storage[1..7].to_vec();

        blit_rgba8_over_rgb48le(dom, &mut canvas, 1, 1, &lut).unwrap();

        assert_eq!(read_u16(&canvas, 0), 65_535);
        assert_eq!(read_u16(&canvas, 2), 0);
        assert_eq!(read_u16(&canvas, 4), 0);
    }

    fn read_u16(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
    }
}
