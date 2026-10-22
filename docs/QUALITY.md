# Quality Gate

Run **`npm run quality`**. The command runs local architecture-map checks, formatting, ESLint, AST dependency checks, strict Rust fmt/Clippy/check/tests (debug and release), native build, recursively discovered JS/integration tests, client build and dependency audits. Failures or missing tools return a nonzero exit code. The latest structured report is `.quality/report.json` with architecture, static analysis, style, security, tests, regression and overall status.

Prerequisites: Node 22.22.2 or 24.15+, npm, Git and Rust 1.99+ with rustfmt/Clippy. Native hosts: x86-64 GNU Windows/Linux. CI pins Node 24.22.0 and Rust 1.99.0. `npm ci` installs local hooks; `npm run hooks:install` reconnects them without replacing an unrelated hooksPath.

## Enforcement

| Stage         | Checks                                                                              | Scope                                                  |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| pre-commit    | format, ESLint, architecture, Rust fmt/Clippy                                       | isolated Git index snapshot, including partial staging |
| pre-push      | complete `quality`                                                                  | each pushed tip, not uncommitted working files         |
| CI            | complete `quality` with clean dependencies                                          | GNU Linux and GNU Windows                              |
| expert review | contracts, authority, unsafe, complexity, duplicated mechanisms, performance claims | entire diff and related callers                        |

`npm run quality:fast` is only the local static stage: its report explicitly leaves tests and external security audit unrun. It is not a full readiness report. Required CI statuses still block a merge after hooks are bypassed.

Hooks do not stash, reset or stage user files. They read Git blobs into an owned temporary directory, reject unresolved conflicts/symlinks/submodules, reuse installed tools only if the staged manifest/lock match the working dependency description, and remove that directory afterward. A concurrent index change invalidates the result. A pushed revision with different dependencies must be checked in its own checkout with `npm ci`.

The initial project implementation is not yet committed. Stage the intended project/configuration together when preparing its first implementation commit; hooks cannot validate files missing from the index. No automatic commit is part of setup.

## Review findings

Hard policy errors cannot be waived by review. Complexity, deep nesting and AST duplication are heuristics: they require independent technical review, not arbitrary automatic rejection or silent success. `tools/quality/reviews.json` records the rule, file hash, reviewer, concrete rationale and evidence. A byte change invalidates the review. Do not update hashes mechanically to make a failing gate pass; inspect the new diff and contracts first.

## Local architecture maps

Start at [the root map](../AGENTS.md) and follow only the required child map. Every first-party folder owns one `AGENTS.md` with purpose, boundaries, dependencies and a table linking each direct file or child map to its concrete responsibility. The gate rejects missing maps, undocumented additions, stale/duplicate/escaping links and empty responsibilities. It inventories every owned file, including unknown extensions, not just JavaScript.

Maps are limited to 80 lines / 6000 characters. A folder may contain up to 12 direct files and 12 child folders (24 files at the configuration root). Source files over 400 lines require cohesion review; over 600 lines are blocked. Test files have a hard 700-line limit. These limits measure navigation cost, not architectural correctness: reviewers must still reject arbitrary file slicing or misleading descriptions. Generated/local data and the pinned `reference/linux` subtree are explicit boundaries, not excuses to skip new first-party code.

Changes to authority, ASM, contracts, dependency set or gate policy need explicit rationale and review even when the automated tools pass. The PR template and CODEOWNERS route review to the maintainer. GitHub cannot accept the author's own approval: with one human maintainer, a second-account approval is not mandatory. Technical review records do not replace Alexey's release acceptance.

`main` protection uses the two GitHub Actions job names in `.github/branch-protection.json`, strict up-to-date checks, administrator enforcement and no force pushes/deletion. Verify server settings after changes; a JSON file alone does not activate protection. CI cannot verify unpublished local files; its status remains **NOT RUN** until these files reach a branch.

## Limits

- The pinned Linux files are byte-preserved, excluded from formatting, and hash-checked by tests. This is not a bootable kernel. QEMU/ARM64/paging/SMP tests are not claimed; actual kernel work must add suitable verification.
- Native tests compare 100,540 fixed Rust/ASM cases; edited graphs have separate model tests. Neither proves whole-kernel safety or an optimization record.
- Dependency auditing needs registry access. No network or missing Rust audit tool when dependencies exist means blocked, not clean. With zero Rust dependencies, the lock and metadata are checked instead of claiming an advisory scan.
- ESLint/Clippy and AST checks are not proofs against races, memory-ordering bugs or malicious policy edits. Owners can change repository policy; review remains necessary.
- UI screenshots and interaction checks supplement tests. Equal visual types use the same Blockly definitions/renderer/options/styles; numeric constants are editable values, not a separate algorithm-specific block.
