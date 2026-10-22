import { Blockly } from './appearance.mjs';
import { createEditorWorkspace, createReferenceWorkspace, loadWorkspace } from './workspace.mjs';
import { createDraftController } from './drafts.mjs';
import { parseAssembly, executeProgram, getReferenceModel } from '../../core/placement/index.mjs';
import { modelToWorkspace, compileWorkspace } from '../../core/placement/visual.mjs';

export class BlockEditor {
  constructor(host, { onProgram, onDraft, onSelect, onNotice }) {
    Object.assign(this, {
      host,
      onProgram,
      onDraft,
      onSelect,
      onNotice,
      loading: false,
      pending: false,
      version: 0,
      acceptedAssembly: null,
      instructionBlocks: {},
    });
    this.drafts = createDraftController(this);
    Object.assign(
      this,
      createEditorWorkspace(
        host,
        (event) => this.changed(event),
        () => {
          if (host.clientWidth) this.resize();
        },
      ),
    );
  }
  changed(event) {
    if (this.loading) return;
    if (event.type === Blockly.Events.SELECTED) {
      const chosen = this.workspace.getBlockById(event.newElementId);
      if (chosen) {
        this.workspace.getBlockById(this.selectedId)?.getSvgRoot()?.classList.remove('arena-selected');
        this.selectedId = chosen.id;
        chosen.getSvgRoot()?.classList.add('arena-selected');
        this.onSelect?.(chosen.id);
      }
      return;
    }
    if (event.isUiEvent) return;
    this.version++;
    this.dirty = true;
    this.persist();
    this.clearProblem();
    this.resetTrace();
    clearTimeout(this.timer);
    this.onDraft({ valid: false, pending: true, error: '' });
    this.timer = setTimeout(() => this.commit(), 350);
  }
  persist(...args) {
    return this.drafts.persist(...args);
  }
  setGraph(...args) {
    return this.drafts.setGraph(...args);
  }
  commit(...args) {
    return this.drafts.commit(...args);
  }
  reload(...args) {
    return this.drafts.reload(...args);
  }
  load(json) {
    this.loading = true;
    try {
      loadWorkspace(this.workspace, json);
    } finally {
      this.loading = false;
    }
    this.selectedId = null;
    this.onSelect?.(null);
    requestAnimationFrame(() => {
      Blockly.svgResize(this.workspace);
      this.workspace.zoomToFit();
      this.workspace.scrollCenter();
    });
  }
  snapshot() {
    return Blockly.serialization.workspaces.save(this.workspace);
  }

  get activeWorkspace() {
    return this.referenceMode ? this.referenceWorkspace : this.workspace;
  }

  get activeMap() {
    return this.referenceMode ? this.referenceMap : this.instructionBlocks;
  }

  setInputs(inputs) {
    if (JSON.stringify(this.inputs) !== JSON.stringify(inputs)) {
      this.clearProblem();
      this.resetTrace();
    }
    this.inputs = inputs;
  }

  setReferenceView(enabled) {
    this.referenceMode = enabled;
    this.editSurface.hidden = enabled;
    this.referenceSurface.hidden = !enabled;
    if (enabled && !this.referenceWorkspace) {
      const reference = createReferenceWorkspace(this.referenceSurface);
      this.referenceWorkspace = reference.workspace;
      this.referenceMap = reference.map;
    }
    requestAnimationFrame(() => this.resize());
  }

  highlight(instruction) {
    const id = this.activeMap?.[instruction];
    this.activeWorkspace.highlightBlock(id ?? null);
    if (id) this.activeWorkspace.getBlockById(id)?.getSvgRoot()?.classList.add('arena-executed');
  }

  highlightResult() {
    const result = this.activeWorkspace.getBlocksByType('arena_result', false)[0];
    this.activeWorkspace.highlightBlock(result?.id ?? null);
    result?.getSvgRoot()?.classList.add('arena-executed');
  }

  resetTrace() {
    for (const workspace of [this.workspace, this.referenceWorkspace])
      for (const block of workspace?.getAllBlocks(false) ?? [])
        block.getSvgRoot()?.classList.remove('arena-executed');
  }

  clearProblem() {
    for (const block of this.workspace.getAllBlocks(false))
      block.getSvgRoot()?.classList.remove('arena-problem');
  }

  showProblem(ids) {
    this.clearProblem();
    for (const id of ids)
      this.workspace.getBlockById(this.instructionBlocks[id])?.getSvgRoot()?.classList.add('arena-problem');
    this.workspace.zoomToFit();
    this.workspace.scrollCenter();
  }

  evaluation() {
    const compiled = compileWorkspace(Blockly.serialization.workspaces.save(this.activeWorkspace));
    if (this.referenceMode) this.referenceMap = compiled.instructionBlocks;
    else this.instructionBlocks = compiled.instructionBlocks;
    return executeProgram(parseAssembly(compiled.assembly), this.inputs);
  }

  isReference() {
    try {
      return (
        compileWorkspace(this.snapshot()).assembly ===
        compileWorkspace(modelToWorkspace(getReferenceModel())).assembly
      );
    } catch {
      return false;
    }
  }

  setZoom(delta, reset = false) {
    const workspace = this.activeWorkspace;
    if (reset) {
      workspace.zoomToFit();
      workspace.scrollCenter();
    } else workspace.zoomCenter(delta > 0 ? 1 : -1);
  }

  undo(redo = false) {
    if (!this.referenceMode) this.workspace.undo(redo);
  }

  deleteSelected() {
    if (this.referenceMode) return;
    const selected = this.workspace.getBlockById(this.selectedId);
    if (selected?.isDeletable()) {
      Blockly.Events.setGroup(true);
      selected.dispose(true);
      Blockly.Events.setGroup(false);
      this.selectedId = null;
      this.onSelect?.(null);
    }
  }

  resize() {
    Blockly.svgResize(this.activeWorkspace);
  }
}
