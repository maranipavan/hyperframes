use std::hint::black_box;
use std::time::Instant;

use hf_media_kernels::{Transfer, blit_rgba8_over_rgb48le, build_transfer_lut};

const WARMUPS: usize = 3;
const SAMPLES: usize = 7;

fn main() {
    let width = std::env::args()
        .nth(1)
        .as_deref()
        .unwrap_or("1920")
        .parse::<usize>()
        .expect("width must be a positive integer");
    let height = std::env::args()
        .nth(2)
        .as_deref()
        .unwrap_or("1080")
        .parse::<usize>()
        .expect("height must be a positive integer");
    assert!(width > 0 && height > 0, "dimensions must be positive");

    let pixels = width.checked_mul(height).expect("pixel count overflow");
    let mut dom_rgba = vec![0_u8; pixels * 4];
    let mut canvas = vec![0_u8; pixels * 6];

    for i in 0..pixels {
        let dom_offset = i * 4;
        dom_rgba[dom_offset] = (17_u32.wrapping_mul(i as u32).wrapping_add(13) & 0xff) as u8;
        dom_rgba[dom_offset + 1] = (31_u32.wrapping_mul(i as u32).wrapping_add(71) & 0xff) as u8;
        dom_rgba[dom_offset + 2] = (47_u32.wrapping_mul(i as u32).wrapping_add(149) & 0xff) as u8;
        let lane = i & 7;
        dom_rgba[dom_offset + 3] = if lane == 0 {
            0
        } else if lane == 1 {
            255
        } else {
            (29_u32.wrapping_mul(i as u32).wrapping_add(37) & 0xff) as u8
        };

        let canvas_offset = i * 6;
        canvas[canvas_offset] = (11_u32.wrapping_mul(i as u32).wrapping_add(3) & 0xff) as u8;
        canvas[canvas_offset + 1] = (7_u32.wrapping_mul(i as u32).wrapping_add(19) & 0xff) as u8;
        canvas[canvas_offset + 2] = (13_u32.wrapping_mul(i as u32).wrapping_add(29) & 0xff) as u8;
        canvas[canvas_offset + 3] = (17_u32.wrapping_mul(i as u32).wrapping_add(41) & 0xff) as u8;
        canvas[canvas_offset + 4] = (19_u32.wrapping_mul(i as u32).wrapping_add(53) & 0xff) as u8;
        canvas[canvas_offset + 5] = (23_u32.wrapping_mul(i as u32).wrapping_add(67) & 0xff) as u8;
    }

    let initial_canvas = canvas.clone();
    let lut = build_transfer_lut(Transfer::Hlg);

    let mut run_once = || {
        canvas.copy_from_slice(&initial_canvas);
        let start = Instant::now();
        blit_rgba8_over_rgb48le(&dom_rgba, &mut canvas, width, height, &lut)
            .expect("benchmark buffers are valid");
        start.elapsed().as_secs_f64() * 1_000.0
    };

    for _ in 0..WARMUPS {
        black_box(run_once());
    }

    let mut timings = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        timings.push(run_once());
    }

    timings.sort_by(|left, right| left.partial_cmp(right).expect("finite timing"));
    let median_ms = timings[SAMPLES / 2];
    let checksum = canvas.iter().fold(0_u32, |sum, byte| {
        sum.wrapping_mul(33).wrapping_add(u32::from(*byte))
    });
    let megapixels_per_second = (pixels as f64 / 1_000_000.0 / median_ms) * 1_000.0;

    println!(
        "{{\"implementation\":\"rust-release\",\"operation\":\"blitRgba8OverRgb48le\",\"transfer\":\"hlg\",\"width\":{width},\"height\":{height},\"warmups\":{WARMUPS},\"samples\":{SAMPLES},\"timingsMs\":{:?},\"medianMs\":{median_ms:.6},\"minMs\":{:.6},\"maxMs\":{:.6},\"megapixelsPerSecond\":{megapixels_per_second:.6},\"checksum\":{checksum}}}",
        timings,
        timings[0],
        timings[SAMPLES - 1],
    );
}
