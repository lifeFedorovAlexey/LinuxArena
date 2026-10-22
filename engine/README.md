# Native arithmetic check

`node engine/build.mjs gate` runs the mandatory native Rust checks. Individual
actions: `fmt` (check only), `clippy`, `check`, `test`, `build` (release).

Supported native hosts: `x86_64-pc-windows-gnu` and
`x86_64-unknown-linux-gnu`, Rust 1.99+ (CI: 1.99.0), with rustfmt and Clippy.
Uses installed tools only; Windows selects an installed GNU toolchain, Linux
uses its configured native toolchain. Missing tools or unsupported hosts fail.
The gate checks formatting, Clippy and type checking for all targets/features,
tests in debug and release, then builds the release executable. It disables
incremental caching so cache hard-link availability cannot affect the run.
Cargo runs offline and locked; this crate currently has no external dependencies.

Rust warnings and Clippy `all`/`pedantic` findings block the build. Additional
lints require local unsafe explanations and reject unreasoned unwrap, expect,
panic, unfinished implementations and debug macros. The single assembly block
documents its input, register, flags, memory and stack contract in `SAFETY`.
The only local lint exception is integer formatting into an in-memory `String`,
whose `fmt::Write` implementation cannot return an error. Lints cannot establish
that safety arguments are true; changes to ASM or these exceptions need review.

CI must run this same gate on both native hosts. A successful Windows run does
not establish Linux compatibility. The extracted arithmetic is not a bootable
kernel image, so there is no applicable QEMU boot scenario in this crate; ARM64,
bare-metal targets, interrupts, paging and privilege transitions are outside scope.

`engine/target/release/linuxarena-engine[.exe]` commands:

- `check`: 540 boundary + 100,000 seeded random comparisons against native x86 instructions.
- `evaluate 0x1000001 0x200000 0x1000000`: reference and Rust results (u64/u32/u64).
- `bench`: nine alternating timing samples; informational, never a record claim.

Scope: Linux `v6.18.58`, `arch/x86/boot/compressed/head_64.S:315–326`, `CONFIG_RELOCATABLE=y`. Inputs replace the image-relative LEA, boot_params load and immediate minimum; remaining arithmetic/unsigned branch semantics are preserved. Default minimum derives from `CONFIG_PHYSICAL_START=0x1000000`, `CONFIG_PHYSICAL_ALIGN=0x200000`.

No privileged boot instructions run. Alignment validation is partial; memory mappings and whole-kernel behavior are not verified. Timings include adapted inputs and function-call overhead. They compare this fixed Rust translation, not arbitrary edited graph candidates.
