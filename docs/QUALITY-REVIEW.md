# Independent technical review — 2026-10-22

The sections below retain the initial gate review as historical evidence; old file names refer to that layout. Current hash-bound records live in `tools/quality/reviews.json` and resolve specific complexity heuristics, not hard errors or human release acceptance. Source changes invalidate those records. Unpublished CI and kernel safety are not claimed.

The actual review run passed **122 tests, zero failures and zero skips** across `core`, `control-grammar`, `generic-grammar`, `generic-expressions`, `visual-program`, `contract-cases`, `contract-view`, `quality-policy`, `quality-hook`, `service` and `mcp`. The first sandboxed run could not initialize temporary Git fixture repositories; rerunning with permission for those fixtures and ephemeral loopback servers passed. No project server was started by this review.

## Scene graph smoke check

Executed `ArenaScene.prototype.setGraph` and `clear` with real Three.js geometry/material objects and a JSDOM label container, without a WebGL renderer. Both layer and operation modes used four nodes at `(0,0)`, `(5,0)`, `(5,5)`, `(-4,6)`, three valid horizontal/vertical/diagonal edges and one missing-endpoint edge. Assertions confirmed four labels, three links, finite vertex coordinates, actual click and hover callbacks, and a disposal event from every created geometry/material when cleared. This checks construction/lifecycle contracts, not pixels, GPU resources after rendering, or animation timing.

## Gate and hook contracts

Reviewed index/tip snapshot construction, owned-directory deletion bounds, dependency-manifest matching, nonzero checker propagation, concurrent-index detection, environment cleanup for nested Git fixtures, source inventory, exact-byte review matching and CI configuration. Tests exercise partially staged/deleted/untracked files, checker failure and cleanup without index mutation. Hook installation now sets executable permissions, and extensionless hook files enter the source inventory. CI pins action revisions, uses clean `npm ci`, runs GNU Windows/Linux jobs and preserves reports even on failure.

Local hooks can be bypassed by their owner and reuse installed dependencies after manifest/lock comparison; they do not attest installed package bytes. The clean CI installation supplies that separate check. Repository policy and review records remain editable code requiring review; static analysis is not a malicious-code proof. Main-branch protection was configured and separately verified by the parent agent; this review did not make or re-query remote configuration changes.

## Defect found during review

A malformed saved v6 Blockly workspace could throw during `setGraph` before draft/error state was reported. The fix validates the saved structure/version separately from compilation, protects exact saved bytes with a recovery copy, falls back with an explicit notice, and keeps schema-valid incomplete drafts editable. A storage failure protects the original record from subsequent persistence. A changed base now preserves the old draft and reports a conflict. Supported intermediate v6 shapes migrate, and an unchanged saved baseline does not auto-save merely because structured ASM has different canonical formatting.

The reviewer implemented these fixes. Agent `/boot_model` independently inspected the final recovery delta and reran all nine real-Blockly regressions in `tests/block-editor.test.mjs`; no blocking defect remained in that delta. After the final fix and pure draft-validation export, **45 targeted tests passed**, including all visual-program/generic-expression tests and nine recovery/save tests; scoped ESLint and Prettier also passed. The complexity finding for `setGraph` disappeared after recovery became an explicit helper boundary; its hash-bound review remains recorded for the storage/save contracts.

## Local architecture maps and component extraction — 2026-10-22

Current navigation starts at [AGENTS.md](../AGENTS.md); boundaries and migration rationale are in [ADR 0002](adr/0002-local-architecture-maps.md). The generic machine/visual layers take an explicit adapter, Linux placement owns its contracts/history, UI components own separate lifecycles, and HTTP/store/native/MCP have distinct authority. Each first-party directory has a short local ownership map; pinned upstream files remain byte-preserved.

Independent review: `/local_service` inspected core and HTTP, ran **92 core + 9 service tests**, and recorded seven exact-byte reviews. `/boot_model` reviewed policy/structure/inventory and ran **46 policy/structure + 9 inventory/hook tests**; five exact-byte records capture the remaining cohesive dispatchers. `/root` reviewed UI rendering/resource ownership and ran **16 UI tests**, including real Three.js disposal on graph replacement. No author's complexity finding is self-approved.

The model extraction matched the previous implementation in **1,224 input/program combinations**, including registers, flags and traces. CSS comparison retained **431 selector/media groups**; computed styles matched for **1,984 elements** across four widths. Browser checks retained the saved candidate and showed no console errors. These checks establish refactor equivalence, not a new performance result.

Review found and closed bypasses involving hidden ownership rows, malformed fences, unmanifested vendor additions, inherited Git ignore rules and Windows aliases of agent-map URLs. Negative tests cover these cases. Real Git fixtures verify that staged ownership omissions and deleted maps block commit without changing HEAD. Full-run status is generated in `.quality/report.json`; CI remains unrun until publication.
