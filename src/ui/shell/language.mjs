import { $ } from '../shared/dom.mjs';
import { getLocale, onLocaleChange, t } from '../shared/i18n/index.mjs';
import { translateDOM } from '../shared/i18n/dom.mjs';
import { graphFor } from './layer-graph.mjs';

export function bindLanguage(model, { switcher, editor, scene, render, renderInputLabels }) {
  const refresh = () => {
    translateDOM(document);
    switcher.update({ value: getLocale(), label: t('Язык интерфейса') });
    render();
    renderInputLabels();
    const draft = model.draft;
    $('#draft-status').textContent = draft.pending ? '…' : draft.valid ? t('Сохранено') : t(draft.error);
    // The locale affects presentation only: do not call showLayer/setGraph on the editor.
    editor.localize();
    if (model.layer !== 'placement') scene.setGraph(graphFor(model.layer));
    model.traceToken++;
    $('#trace-banner').hidden = true;
    $('#toast').hidden = true;
  };
  const unsubscribe = onLocaleChange(refresh);
  refresh();
  return unsubscribe;
}
