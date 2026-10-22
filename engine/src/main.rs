// SPDX-License-Identifier: GPL-2.0-only
use linuxarena_engine::{
    BASELINE, CheckResult, DEFAULT_ALIGNMENT, DEFAULT_MINIMUM, DeterministicInputs, Input,
    alignment_contract, check_equivalence, linux_asm_address, rust_address,
};
use std::{env, fmt::Write, hint::black_box, process::ExitCode, time::Instant};

const CHECK_RANDOM_CASES: usize = 100_000;

fn main() -> ExitCode {
    match run() {
        Ok(passed) => {
            if passed {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(message) => {
            println!(
                "{{\"status\":\"error\",\"error\":{}}}",
                json_string(&message)
            );
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<bool, String> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match arguments.first().map_or("check", String::as_str) {
        "check" if arguments.len() <= 1 => {
            let result = check_equivalence(CHECK_RANDOM_CASES);
            println!("{}", check_json(&result));
            Ok(result.mismatches == 0)
        }
        "evaluate" if arguments.len() == 4 => {
            let input = Input {
                load_address: parse_unsigned(&arguments[1])?,
                kernel_alignment: u32::try_from(parse_unsigned(&arguments[2])?)
                    .map_err(|_| "kernel_alignment must fit into uint32".to_owned())?,
                minimum_address: parse_unsigned(&arguments[3])?,
            };
            let reference = linux_asm_address(input);
            let rust = rust_address(input);
            println!(
                "{{\"operation\":\"evaluate\",\"baseline\":\"{BASELINE}\",\"input\":{{\"load_address\":\"0x{:x}\",\"kernel_alignment\":\"0x{:x}\",\"minimum_address\":\"0x{:x}\"}},\"reference\":\"0x{reference:x}\",\"rust\":\"0x{rust:x}\",\"equal\":{},\"alignment_contract_valid\":{},\"boot_verified\":false}}",
                input.load_address,
                input.kernel_alignment,
                input.minimum_address,
                reference == rust,
                alignment_contract(input)
            );
            Ok(reference == rust)
        }
        "bench" if arguments.len() <= 1 => {
            if cfg!(debug_assertions) {
                return Err("bench requires a release build".to_owned());
            }
            let check = check_equivalence(CHECK_RANDOM_CASES);
            if check.mismatches != 0 {
                println!("{}", check_json(&check));
                return Ok(false);
            }
            let result = benchmark()?;
            println!("{result}");
            Ok(true)
        }
        "--help" | "help" => {
            println!(
                "{{\"commands\":[\"check\",\"evaluate <load_address> <kernel_alignment> <minimum_address>\",\"bench\"],\"numbers\":\"decimal or 0x-prefixed hexadecimal\",\"scope\":\"CONFIG_RELOCATABLE startup_64 address-selection arithmetic; not kernel boot\"}}"
            );
            Ok(true)
        }
        _ => Err(
            "usage: linuxarena-engine check | evaluate <load> <alignment> <minimum> | bench"
                .to_owned(),
        ),
    }
}

fn parse_unsigned(value: &str) -> Result<u64, String> {
    let parsed = if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else {
        value.parse::<u64>()
    };
    parsed.map_err(|_| "addresses must be uint64 decimal or 0x-prefixed hexadecimal".to_owned())
}

fn json_string(value: &str) -> String {
    let mut result = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            character if character.is_control() => {
                // String's fmt::Write implementation cannot return an error;
                // integer LowerHex formatting does not introduce another sink.
                #[expect(
                    clippy::expect_used,
                    reason = "Formatting an integer into String is infallible; no I/O or user formatter is involved"
                )]
                write!(result, "\\u{:04x}", u32::from(character))
                    .expect("formatting an integer into String cannot fail");
            }
            character => result.push(character),
        }
    }
    result.push('"');
    result
}

fn check_json(result: &CheckResult) -> String {
    format!(
        "{{\"operation\":\"check\",\"status\":\"{}\",\"baseline\":\"{BASELINE}\",\"reference\":\"adapted-native-x86-64-asm\",\"scope\":\"relocation-address-arithmetic\",\"cases\":{},\"boundary_cases\":{},\"random_cases\":{},\"seed\":\"0x{:x}\",\"mismatches\":{},\"boot_verified\":false}}",
        if result.mismatches == 0 {
            "passed"
        } else {
            "failed"
        },
        result.boundary_cases + result.random_cases,
        result.boundary_cases,
        result.random_cases,
        DeterministicInputs::SEED,
        result.mismatches
    )
}

fn measure(function: fn(Input) -> u64, inputs: &[Input], passes: u32) -> Result<f64, String> {
    let operations = u32::try_from(inputs.len())
        .ok()
        .and_then(|count| count.checked_mul(passes))
        .filter(|&count| count != 0)
        .ok_or_else(|| "benchmark operation count must fit a nonzero uint32".to_owned())?;
    let mut checksum = 0_u64;
    let started = Instant::now();
    for _ in 0..passes {
        for &input in inputs {
            checksum = checksum.wrapping_add(black_box(function(black_box(input))));
        }
    }
    black_box(checksum);
    Ok(started.elapsed().as_secs_f64() * 1_000_000_000.0 / f64::from(operations))
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[sorted.len() / 2]
}

fn samples_json(values: &[f64]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| format!("{value:.5}"))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn benchmark() -> Result<String, String> {
    const SAMPLE_COUNT: usize = 9;
    const INPUT_COUNT: u32 = 4096;
    const PASSES: u32 = 128;
    let mut generator = DeterministicInputs::new();
    // Representative low/high addresses and both sides of the minimum branch.
    // The full 64-bit edge behavior is independently checked before timing.
    let inputs: Vec<Input> = (0..INPUT_COUNT)
        .map(|index| {
            let random = generator.next_input();
            Input {
                load_address: if index % 2 == 0 {
                    random.load_address & 0x00ff_ffff
                } else {
                    random.load_address & 0x0000_00ff_ffff_ffff
                },
                kernel_alignment: DEFAULT_ALIGNMENT << (index % 4),
                minimum_address: DEFAULT_MINIMUM,
            }
        })
        .collect();
    black_box(measure(linux_asm_address, &inputs, 16)?);
    black_box(measure(rust_address, &inputs, 16)?);
    let mut asm_samples = Vec::new();
    let mut rust_samples = Vec::new();
    for index in 0..SAMPLE_COUNT {
        // Alternate ordering to reduce systematic warmup / frequency bias.
        if index % 2 == 0 {
            asm_samples.push(measure(linux_asm_address, &inputs, PASSES)?);
            rust_samples.push(measure(rust_address, &inputs, PASSES)?);
        } else {
            rust_samples.push(measure(rust_address, &inputs, PASSES)?);
            asm_samples.push(measure(linux_asm_address, &inputs, PASSES)?);
        }
    }
    let asm_median = median(&asm_samples);
    let rust_median = median(&rust_samples);
    Ok(format!(
        "{{\"operation\":\"bench\",\"status\":\"measured\",\"baseline\":\"{BASELINE}\",\"reference\":\"adapted-native-x86-64-asm\",\"scope\":\"isolated-user-mode-arithmetic\",\"unit\":\"ns/op\",\"sample_count\":{SAMPLE_COUNT},\"operations_per_sample\":{},\"reference_samples\":{},\"rust_samples\":{},\"reference_median\":{asm_median:.5},\"rust_median\":{rust_median:.5},\"ratio_reference_to_rust\":{:.5},\"decision\":\"informational\",\"record_eligible\":false,\"boot_verified\":false,\"limitations\":[\"Adapted inputs and function-call overhead\",\"One host and user-mode workload; no boot-time claim\",\"Memory, security, reliability and integration were not benchmarked\"]}}",
        INPUT_COUNT * PASSES,
        samples_json(&asm_samples),
        samples_json(&rust_samples),
        asm_median / rust_median
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_unsigned_inputs_without_truncation() {
        assert_eq!(parse_unsigned("0xffffffffffffffff"), Ok(u64::MAX));
        assert_eq!(parse_unsigned("18446744073709551615"), Ok(u64::MAX));
        assert!(parse_unsigned("0x10000000000000000").is_err());
        assert!(parse_unsigned("-1").is_err());
    }

    #[test]
    fn escapes_json_control_characters() {
        assert_eq!(json_string("a\"\n\\"), "\"a\\\"\\n\\\\\"");
        assert_eq!(
            json_string("\u{0000}\u{001f}\u{009f}"),
            "\"\\u0000\\u001f\\u009f\""
        );
    }

    #[test]
    fn rejects_empty_or_overflowing_benchmark_operation_counts() {
        let input = Input {
            load_address: DEFAULT_MINIMUM,
            kernel_alignment: DEFAULT_ALIGNMENT,
            minimum_address: DEFAULT_MINIMUM,
        };
        assert!(measure(rust_address, &[], 1).is_err());
        assert!(measure(rust_address, &[input], 0).is_err());
        assert!(measure(rust_address, &[input, input], u32::MAX).is_err());
    }
}
