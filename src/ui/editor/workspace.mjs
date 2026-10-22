import { Blockly, workspaceAppearance } from './appearance.mjs';
import { localizedToolbox } from './localization.mjs';
import { getReferenceModel } from '../../core/placement/index.mjs';
import { modelToWorkspace, compileWorkspace } from '../../core/placement/visual.mjs';

export function createEditorWorkspace(host, onChange, onResize) {
  const editSurface = document.createElement('div');
  editSurface.className = 'block-surface';
  host.append(editSurface);
  const referenceSurface = document.createElement('div');
  referenceSurface.className = 'block-surface';
  referenceSurface.hidden = true;
  host.append(referenceSurface);
  const workspace = Blockly.inject(editSurface, {
    ...workspaceAppearance,
    toolbox: localizedToolbox(),
    trashcan: true,
    comments: false,
    collapse: true,
    disable: false,
  });
  workspace.addChangeListener(onChange);
  const observer = new ResizeObserver(onResize);
  observer.observe(host);
  return { editSurface, referenceSurface, workspace, observer };
}

export function loadWorkspace(workspace, json) {
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(json, workspace);
    workspace.getBlocksByType('arena_entry', false)[0]?.setDeletable(false);
  } finally {
    Blockly.Events.enable();
  }
}

export function createReferenceWorkspace(surface) {
  const workspace = Blockly.inject(surface, { ...workspaceAppearance, readOnly: true });
  const json = modelToWorkspace(getReferenceModel());
  Blockly.serialization.workspaces.load(json, workspace);
  const map = compileWorkspace(json).instructionBlocks;
  workspace.zoomToFit();
  workspace.scrollCenter();
  return { workspace, map };
}
