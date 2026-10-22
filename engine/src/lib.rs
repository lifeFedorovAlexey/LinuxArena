// SPDX-License-Identifier: GPL-2.0-only
// Arithmetic extracted from Linux v6.18.58, arch/x86/boot/compressed/head_64.S.
// This is not a boot emulator: privileged setup and the rest of startup_64 are outside its scope.

#[cfg(not(target_arch = "x86_64"))]
compile_error!("The native Linux assembly reference requires an x86-64 host.");

pub const BASELINE: &str = "v6.18.58";
pub const DEFAULT_MINIMUM: u64 = 0x0100_0000;
pub const DEFAULT_ALIGNMENT: u32 = 0x0020_0000;

#[derive(Clone, Copy, Debug)]
pub struct Input {
    pub load_address: u64,
    pub kernel_alignment: u32,
    pub minimum_address: u64,
}

/// Rust translation of the `CONFIG_RELOCATABLE` address-selection block.
/// `decl %eax` operates in 32 bits and zero-extends the result into `%rax`.
/// `addq` wraps modulo 2^64; `jae` uses an unsigned comparison.
#[inline(never)]
#[must_use]
pub fn rust_address(input: Input) -> u64 {
    let mask = u64::from(input.kernel_alignment.wrapping_sub(1));
    let aligned = input.load_address.wrapping_add(mask) & !mask;
    aligned.max(input.minimum_address)
}

/// The same x86-64 instruction sequence as the Linux arithmetic block, with
/// live inputs substituted for `boot_params`, the image-relative LEA and the
/// compile-time `LOAD_PHYSICAL_ADDR`. This executes in user mode and touches no
/// memory. Register renaming and a runtime minimum preserve result semantics,
/// but timings are not measurements of an actual kernel boot.
#[inline(never)]
#[must_use]
pub fn linux_asm_address(input: Input) -> u64 {
    let mut address = input.load_address;
    // SAFETY: this x86-64 sequence accepts every u64/u32 bit pattern, uses only
    // integer registers, terminates, and touches neither memory nor the stack.
    // The early-clobber `out(reg)` mask cannot overlap inputs; `inout(reg)`
    // declares the changed address. Flags are clobbered (no preserves_flags),
    // and no privileged instruction or external code is invoked.
    unsafe {
        core::arch::asm!(
            "mov {mask:e}, {alignment:e}",
            "dec {mask:e}",
            "add {address}, {mask}",
            "not {mask}",
            "and {address}, {mask}",
            "cmp {address}, {minimum}",
            "jae 2f",
            "mov {address}, {minimum}",
            "2:",
            address = inout(reg) address,
            alignment = in(reg) input.kernel_alignment,
            minimum = in(reg) input.minimum_address,
            mask = out(reg) _,
            options(nomem, nostack),
        );
    }
    address
}

/// Only the alignment portion of the boot contract; this does not establish
/// valid mappings, RAM ranges, CPU state, image placement or a bootable kernel.
#[must_use]
pub fn alignment_contract(input: Input) -> bool {
    input.kernel_alignment >= DEFAULT_ALIGNMENT && input.kernel_alignment.is_power_of_two()
}

#[must_use]
pub fn boundary_inputs() -> Vec<Input> {
    let loads = [
        0,
        1,
        0x001f_ffff,
        0x0020_0000,
        0x0020_0001,
        0x00ff_ffff,
        0x0100_0000,
        0x0100_0001,
        0xffff_ffff,
        0x1_0000_0000,
        0x7fff_ffff_ffff_ffff,
        0x8000_0000_0000_0000,
        u64::MAX - 0x0020_0000,
        u64::MAX - 1,
        u64::MAX,
    ];
    let alignments = [
        0,
        1,
        2,
        3,
        0x1000,
        0x0020_0000,
        0x0040_0000,
        0x8000_0000,
        u32::MAX,
    ];
    let minimums = [0, DEFAULT_MINIMUM, 0x8000_0000_0000_0000, u64::MAX];
    let mut values = Vec::new();
    for load_address in loads {
        for kernel_alignment in alignments {
            for minimum_address in minimums {
                values.push(Input {
                    load_address,
                    kernel_alignment,
                    minimum_address,
                });
            }
        }
    }
    values
}

#[derive(Debug)]
pub struct DeterministicInputs(u64);

impl DeterministicInputs {
    pub const SEED: u64 = 0x6a09_e667_f3bc_c909;

    #[must_use]
    pub fn new() -> Self {
        Self(Self::SEED)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    pub fn next_input(&mut self) -> Input {
        let load_address = self.next_u64();
        // The alignment samples use the low 32 bits, exactly as a movl input.
        let [a, b, c, d, ..] = self.next_u64().to_le_bytes();
        Input {
            load_address,
            kernel_alignment: u32::from_le_bytes([a, b, c, d]),
            minimum_address: self.next_u64(),
        }
    }
}

impl Default for DeterministicInputs {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub struct CheckResult {
    pub boundary_cases: usize,
    pub random_cases: usize,
    pub mismatches: usize,
}

#[must_use]
pub fn check_equivalence(random_cases: usize) -> CheckResult {
    let boundaries = boundary_inputs();
    let mut mismatches = boundaries
        .iter()
        .filter(|&&input| linux_asm_address(input) != rust_address(input))
        .count();
    let mut random = DeterministicInputs::new();
    for _ in 0..random_cases {
        let input = random.next_input();
        if linux_asm_address(input) != rust_address(input) {
            mismatches += 1;
        }
    }
    CheckResult {
        boundary_cases: boundaries.len(),
        random_cases,
        mismatches,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(load_address: u64, kernel_alignment: u32, minimum_address: u64) -> Input {
        Input {
            load_address,
            kernel_alignment,
            minimum_address,
        }
    }

    #[test]
    fn minimum_floor_and_alignment_boundaries() {
        assert_eq!(
            rust_address(input(0, DEFAULT_ALIGNMENT, DEFAULT_MINIMUM)),
            DEFAULT_MINIMUM
        );
        assert_eq!(
            rust_address(input(DEFAULT_MINIMUM, DEFAULT_ALIGNMENT, DEFAULT_MINIMUM)),
            DEFAULT_MINIMUM
        );
        assert_eq!(
            rust_address(input(
                DEFAULT_MINIMUM + 1,
                DEFAULT_ALIGNMENT,
                DEFAULT_MINIMUM
            )),
            0x0120_0000
        );
    }

    #[test]
    fn eax_decrement_zero_extends_and_u64_add_wraps() {
        // alignment == 0 is outside the boot contract, but catches the wrong
        // translation of the 32-bit decrement as a 64-bit wrapping_sub.
        assert_eq!(rust_address(input(0x1_0000_0001, 0, 0)), 0x2_0000_0000);
        assert_eq!(rust_address(input(u64::MAX, DEFAULT_ALIGNMENT, 0)), 0);
        assert_eq!(
            rust_address(input(u64::MAX, DEFAULT_ALIGNMENT, DEFAULT_MINIMUM)),
            DEFAULT_MINIMUM
        );
    }

    #[test]
    fn comparison_is_unsigned() {
        assert_eq!(
            rust_address(input(
                0x8000_0000_0000_0000,
                DEFAULT_ALIGNMENT,
                DEFAULT_MINIMUM
            )),
            0x8000_0000_0000_0000
        );
        assert_eq!(
            rust_address(input(0, DEFAULT_ALIGNMENT, u64::MAX)),
            u64::MAX
        );
    }

    #[test]
    fn rejects_invalid_alignment_contract_without_hiding_machine_behavior() {
        assert!(!alignment_contract(input(0, 0, 0)));
        assert!(!alignment_contract(input(0, 0x1000, 0)));
        assert!(!alignment_contract(input(0, 0x0030_0000, 0)));
        assert!(alignment_contract(input(0, DEFAULT_ALIGNMENT, 0)));
    }

    #[test]
    fn rust_matches_actual_x86_instructions_on_boundaries_and_random_values() {
        let result = check_equivalence(100_000);
        assert_eq!(result.mismatches, 0, "{result:?}");
    }
}
