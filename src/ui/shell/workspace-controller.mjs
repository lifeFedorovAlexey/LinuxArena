import { t } from '../shared/i18n/index.mjs';
import { BOOT_LAYERS, parseAssembly } from '../../core/placement/index.mjs';
import { $ } from '../shared/dom.mjs';
import { graphFor } from './layer-graph.mjs';
import { api } from './api.mjs';

export function createWorkspaceController(
  model,
  { scene, editor, contractView, toast, renderChrome, renderInputs, closeInspector },
) {
  function showLayer() {
    const logic = model.layer === 'placement';
    $('#workspace').classList.toggle('logic-view', logic);
    $('#arena-workbench').classList.toggle('editing', logic);
    $('#live-contract').hidden = !logic;
    $('#edit-tools').hidden = !logic;
    $('#scene-host').hidden = logic;
    $('#node-labels').hidden = logic;
    $('#flow-host').hidden = !logic;
    if (logic) {
      $('#scene-fallback').hidden = true;
      editor.setGraph(model.state.program.model);
      editor.setInputs(contractView.preview?.inputs ?? model.state.inputs);
      editor.resize();
      contractView.update(model.state);
    } else scene.setGraph(graphFor(model.layer));
  }

  async function navigate(next, from = null, reverse = false) {
    if (model.transitioning || next === model.layer || !BOOT_LAYERS[next]) return;
    model.transitioning = true;
    model.traceToken++;
    $('#trace-banner').hidden = true;
    if (next !== 'placement') closeInspector();
    model.layer = next;
    renderChrome();
    history.replaceState(null, '', `#${model.layer}`);
    if (model.layer === 'placement' || $('#workspace').classList.contains('logic-view')) showLayer();
    else await scene.transition(graphFor(model.layer), from, reverse);
    model.transitioning = false;
  }

  function applyState(next, { remote = false } = {}) {
    const changed = model.state?.program?.hash !== next.program.hash;
    const evaluationChanged = JSON.stringify(model.state?.evaluation) !== JSON.stringify(next.evaluation);
    if (changed || evaluationChanged) {
      model.traceToken++;
      $('#trace-banner').hidden = true;
    }
    model.state = next;
    contractView.update(model.state);
    if (
      remote &&
      model.lastRemoteRevision >= 0 &&
      next.revision > model.lastRemoteRevision &&
      changed &&
      !editor.pending
    )
      toast(t('Алгоритм обновлён'));
    model.lastRemoteRevision = next.revision;
    renderInputs();
    renderChrome();
    if (model.layer === 'placement' && changed && !model.transitioning)
      editor.setGraph(model.state.program.model);
    editor.setInputs(contractView.preview?.inputs ?? model.state.inputs);
  }

  function setReferenceView(enabled) {
    model.traceToken++;
    $('#trace-banner').hidden = true;
    editor.setReferenceView(enabled);
    $('#candidate-view').setAttribute('aria-pressed', String(!enabled));
    $('#reference-view').setAttribute('aria-pressed', String(enabled));
    $('#undo-blocks').disabled = enabled;
    $('#redo-blocks').disabled = enabled;
    $('#delete-block').disabled = enabled || !editor.selectedId || editor.selectedId === 'arena-entry';
    $('#trace-button').disabled = !enabled && !model.visualReady;
    renderChrome();
  }

  async function saveAssembly(assembly, { fromBlocks = false } = {}) {
    if (fromBlocks && model.sourceDirty)
      throw new Error('Сначала примени изменения в панели кода. Правки блоков сохранены в черновике.');
    parseAssembly(assembly);
    const next = await api('program', { assembly });
    model.sourceDirty = false;
    applyState(next);
    if (!fromBlocks) {
      editor.reload(next.program.model);
      toast(t('Блоки и код синхронизированы'));
    }
  }
  return { showLayer, navigate, applyState, setReferenceView, saveAssembly };
}
