import { t } from '../shared/i18n/index.mjs';
import { BOOT_LAYERS } from '../../core/placement/index.mjs';
import { $ } from '../shared/dom.mjs';
import { api } from './api.mjs';

export function bindControls(
  model,
  {
    editor,
    scene,
    toast,
    navigate,
    runCheck,
    openInspector,
    closeInspector,
    applyState,
    animateTrace,
    saveAssembly,
    setReferenceView,
  },
) {
  const activeView = () => (model.layer === 'placement' ? editor : scene);
  $('#home').addEventListener('click', () => navigate('root', null, true));
  $('#back-button').addEventListener('click', () =>
    navigate(BOOT_LAYERS[model.layer].parent ?? 'root', null, true),
  );
  $('#run-button').addEventListener('click', () =>
    model.layer === 'root'
      ? navigate('startup', 'boot')
      : model.layer === 'startup'
        ? navigate('placement', 'placement')
        : runCheck(),
  );
  $('#contract-button').addEventListener('click', () => openInspector('contract'));
  $('#code-button').addEventListener('click', () => openInspector('source'));
  $('#contract-tab').addEventListener('click', () => openInspector('contract'));
  $('#source-tab').addEventListener('click', () => openInspector('source'));
  $('#close-inspector').addEventListener('click', closeInspector);
  $('#zoom-in').addEventListener('click', () => activeView().setZoom(0.15));
  $('#zoom-out').addEventListener('click', () => activeView().setZoom(-0.15));
  $('#fit-view').addEventListener('click', () => activeView().setZoom(0, true));
  $('#inputs-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      applyState(
        await api('inputs', {
          loadAddress: $('#load-address').value,
          alignment: $('#alignment').value,
          minimumAddress: $('#minimum-address').value,
          relocatable: $('#relocatable').checked,
        }),
      );
      animateTrace();
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#source-editor').addEventListener('input', () => {
    model.sourceDirty = true;
    $('#edit-status').textContent = t('Есть изменения');
  });
  $('#save-program').addEventListener('click', async () => {
    try {
      await saveAssembly($('#source-editor').value);
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#reset-program').addEventListener('click', async () => {
    try {
      const block = await api('block');
      await saveAssembly(block.referenceAssembly);
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#undo-blocks').addEventListener('click', () => editor.undo());
  $('#redo-blocks').addEventListener('click', () => editor.undo(true));
  $('#delete-block').addEventListener('click', () => editor.deleteSelected());
  $('#reload-blocks').addEventListener('click', () => editor.reload(model.state.program.model));
  $('#candidate-view').addEventListener('click', () => setReferenceView(false));
  $('#reference-view').addEventListener('click', () => setReferenceView(true));
  $('#trace-button').addEventListener('click', animateTrace);
  $('#agent-button').addEventListener('click', () => $('#agent-dialog').showModal());
  $('#close-dialog').addEventListener('click', () => $('#agent-dialog').close());
  $('#agent-dialog').addEventListener('click', (event) => {
    if (event.target === $('#agent-dialog')) {
      const rect = event.target.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        event.target.close();
    }
  });
  $('#server-address').textContent = location.host;
  $('#copy-command').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('node src/service/mcp/server.mjs');
      toast(t('Команда скопирована'));
    } catch {
      toast(t('Скопируйте команду из поля'), true);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      model.traceToken++;
      $('#trace-banner').hidden = true;
      closeInspector();
    }
    if (
      event.key === 'Backspace' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
      !event.target.closest('.injectionDiv') &&
      model.layer !== 'root'
    ) {
      event.preventDefault();
      navigate(BOOT_LAYERS[model.layer].parent ?? 'root', null, true);
    }
  });
}
