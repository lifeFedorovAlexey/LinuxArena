# ADR 0001: enforce existing LinuxArena boundaries

Status: accepted baseline from the current project concept. Module names below describe the initial implementation; the current responsibility tree is defined by ADR 0002 and local AGENTS maps. This ADR does not authorize a kernel architecture redesign.

## Responsibilities

- `generic-isa`, `placement-adapter`, `visual-language`: shared vocabulary/arithmetic and algorithm bindings. No ambient host APIs. The Blockly extension registration receives its UI dependency explicitly.
- `boot-model`: bounded parsing, control flow and execution using the ISA. `visual-program`: socket validation and compilation using the model, vocabulary and adapter. Cases/story consume the model.
- UI consumes UI/core modules. The same native Blockly renderer, options, dropdown template and styles serve the palette, editable graph and Linux reference. Numeric literals, mutable variables, read-only inputs and conditions have different logical roles, not ad hoc views.
- Service owns persistence and process execution; it consumes core, never the browser. HTTP stays on `127.0.0.1`, rejects foreign origins/traversal, and does not execute candidate ASM. MCP talks only to the selected local service without redirects.
- The Rust crate is a dependency-free, user-mode x86-64 arithmetic harness. Supported hosts are GNU Linux and GNU Windows. ARM64, paging, scheduling, interrupt handling and privileged boot are not implemented or verified.

## Invariants and review

Preserve exact integer/flag semantics, input contracts, build/runtime conditions, rejected-program atomicity and pinned upstream hashes. Additional generated registers are reported as effects, never silently accepted as kernel ABI compatible. A restored unsent draft cannot display server results as its own success.

Automated AST import checks enforce boundaries/cycles. Complexity and duplication findings require review of the exact file bytes; they are heuristics, not proofs. Reviewed findings live in `tools/quality/reviews.json` with reviewer, rationale and test evidence; changing the file invalidates its review. Hard errors cannot be waived there. Reviews cannot replace the maintainer's acceptance of a release.

Low-level exceptions are local: Rust's integer formatting into `String` has an infallible writer and a documented `expect` rationale. The persistence queue absorbs only its internal scheduling rejection while returning the original rejected promise to the caller. These are not general permission to suppress failures.

## Gate and limits

Pre-commit checks an isolated index snapshot. Pre-push checks each pushed tip. CI uses clean dependencies and both native hosts. Missing required tools fail; source/vendor bytes are not reformatted. The initial formatting normalization is required to establish an enforceable style baseline; it does not intentionally change behavior.

Security audit reports known dependency advisories, not absence of vulnerabilities. Clippy cannot prove assembly safety or exclude all races. Algorithm changes need contract tests and review; claimed speedups need comparable measurements. Kernel/hardware work must add QEMU or real hardware evidence before making boot claims.

Local hooks and repository-controlled policy can be changed by an owner. Branch protection must enforce required CI independently. LinuxArena currently has one human maintainer: GitHub cannot let a PR author approve their own PR, so owner review is recorded explicitly, and CI checks remain mandatory for administrators.
