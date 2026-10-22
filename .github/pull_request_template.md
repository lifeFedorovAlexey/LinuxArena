## Change and evidence

Describe the problem, resulting behavior, affected contracts and alternatives.

- [ ] Full diff and related callers reviewed; no hidden authority/ABI expansion.
- [ ] Changed files have one owner and current local AGENTS maps; modules were split by responsibility.
- [ ] `npm run quality` passes; both native CI hosts pass.
- [ ] Boundary, negative and regression tests cover the changed contracts.
- [ ] UI changes were inspected in the editor, palette and reference view.
- [ ] Any performance claim has comparable before/after measurements.

Reviewer and evidence:

If an architecture, unsafe, dependency or gate rule changes, link the rationale/ADR.
Unrun hardware scenarios must be identified explicitly; model tests do not prove boot correctness.
