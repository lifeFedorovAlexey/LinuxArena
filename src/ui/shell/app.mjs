import { t, initializeLocale, LOCALES, getLocale, setLocale } from '../shared/i18n/index.mjs';
import { LanguageSwitcher } from '../shared/language-switcher/language-switcher.mjs';
import { bindLanguage } from './language.mjs';
import { prepareBlocklyLocales } from '../editor/localization.mjs';
import { ArenaScene } from '../scene/scene.mjs';
import { BlockEditor } from '../editor/block-editor.mjs';
import { ContractView } from '../contract/contract-view.mjs';
import { BOOT_LAYERS } from '../../core/placement/index.mjs';
import { $, escape } from '../shared/dom.mjs';
import { icon } from '../shared/icons.mjs';
import { createToast } from '../shared/feedback.mjs';
import { api } from './api.mjs';
import { graphFor } from './layer-graph.mjs';
import { renderChrome } from './render.mjs';
import { createInspector } from './inspector.mjs';
import { createWorkspaceController } from './workspace-controller.mjs';
import { createRunController } from './run-controller.mjs';
import { bindControls } from './bindings.mjs';

initializeLocale();
await prepareBlocklyLocales();
const switcher = new LanguageSwitcher($('#language-switcher'), {
  languages: LOCALES,
  value: getLocale(),
  label: t('Язык интерфейса'),
  onChange: setLocale,
});
const model = {
  state: null,
  layer: 'root',
  busy: false,
  transitioning: false,
  traceToken: 0,
  visualReady: true,
  sourceDirty: false,
  lastRemoteRevision: -1,
  connection: 'Локально',
  draft: { valid: true },
};
const actions = {};
const toast = createToast();
document.querySelectorAll('[data-icon]').forEach((element) => {
  element.innerHTML = icon(element.dataset.icon);
});
const scene = new ArenaScene($('#scene-host'), $('#node-labels'), {
  onNode: (node) => {
    if (model.transitioning) return;
    if (node.target) actions.navigate(node.target, node.id);
    else if (node.kind === 'hardware')
      toast(t('{title}: аппаратный этап · {symbol}', { title: node.title, symbol: node.symbol }));
    else if (node.source)
      toast(
        t('{title}: следующий участок разбора · строки {start}–{end}', { title: node.title, ...node.source }),
      );
    else
      toast(
        node.kind === 'external'
          ? t('Загрузчик передаёт управление ядру')
          : t('Этот участок ещё не разобран'),
      );
  },
  renderLabel: (node, operation) =>
    `${operation ? '' : `<span class="node-icon">${icon(node.icon ?? 'box')}</span>`}<span class="node-name">${escape(node.title)}</span><span class="node-subtitle">${escape(node.subtitle)}</span>${node.target ? `<span class="node-badge">${icon('chevron')}</span>` : ''}`,
});

const contractView = new ContractView($('#live-contract'), {
  onInputs: async (inputs) => {
    actions.applyState(await api('inputs', inputs));
    actions.animateTrace();
  },
  onPreview: (inputs) => {
    model.traceToken++;
    $('#trace-banner').hidden = true;
    editor.setInputs(inputs ?? model.state.inputs);
  },
  onProblem: async ({ inputs, instructionIds }) => {
    actions.setReferenceView(false);
    if (!(await editor.commit())) return;
    editor.setInputs(inputs);
    editor.showProblem(instructionIds);
    await actions.animateTrace();
  },
});
const editor = new BlockEditor($('#flow-host'), {
  onProgram: (assembly) => actions.saveAssembly(assembly, { fromBlocks: true }),
  onNotice: (message) => toast(message),
  onSelect: (id) => {
    $('#delete-block').disabled = editor.referenceMode || !id || id === 'arena-entry';
  },
  onDraft: (draft) => {
    model.draft = draft;
    model.visualReady = draft.valid;
    $('#trace-button').disabled = !editor.referenceMode && !model.visualReady;
    $('#run-button').disabled = model.busy || (model.layer === 'placement' && !model.visualReady);
    contractView.setDraftState(draft);
    $('#draft-status').textContent = draft.pending ? '…' : draft.valid ? t('Сохранено') : t(draft.error);
    $('#draft-status').classList.toggle('invalid', !draft.valid && !draft.pending);
    $('#reload-blocks').hidden = draft.valid || draft.pending;
  },
});

const render = () => renderChrome(model, editor, actions);
const inspector = createInspector(model);
Object.assign(
  actions,
  createWorkspaceController(model, {
    scene,
    editor,
    contractView,
    toast,
    renderChrome: render,
    ...inspector,
  }),
);
Object.assign(
  actions,
  createRunController(model, { editor, contractView, toast, renderChrome: render, ...actions }),
);
bindControls(model, { editor, scene, toast, ...inspector, ...actions });
bindLanguage(model, { switcher, editor, scene, render, renderInputLabels: inspector.renderInputLabels });
try {
  actions.applyState(await api('state'));
  const requested = location.hash.slice(1);
  if (BOOT_LAYERS[requested]) model.layer = requested;
  render();
  actions.showLayer();
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => {
    actions.applyState(JSON.parse(event.data), { remote: true });
    $('#connection').classList.remove('offline');
    model.connection = 'В реальном времени';
    render();
  });
  events.onerror = () => {
    $('#connection').classList.add('offline');
    model.connection = 'Переподключение';
    render();
  };
} catch (error) {
  render();
  scene.setGraph(graphFor('root'));
  toast(t('Сервис недоступен: {message}', { message: t(error.message) }), true);
  model.connection = 'Переподключение';
  render();
  $('#connection').classList.add('offline');
}
