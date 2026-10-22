import { t } from '../shared/i18n/index.mjs';
import { $, escape } from '../shared/dom.mjs';
import { icon } from '../shared/icons.mjs';
import { renderMetrics } from './metrics.mjs';

export function renderChrome(model, editor, { navigate, runBenchmark }) {
  $('#connection').innerHTML = `<i></i> ${escape(t(model.connection))}`;
  const names = { root: t('Ядро Linux'), startup: t('Вход в ядро'), placement: t('Адрес распаковки') };
  const order = ['root', 'startup', 'placement'],
    index = order.indexOf(model.layer);
  $('#breadcrumbs').innerHTML = order
    .slice(0, index + 1)
    .map(
      (id, i) =>
        `${i ? icon('chevron') : ''}<button class="${id === model.layer ? 'current' : ''}" data-layer="${id}">${escape(id === 'root' ? 'Linux' : id === 'startup' ? t('Вход') : t('Адрес'))}</button>`,
    )
    .join('');
  $('#breadcrumbs')
    .querySelectorAll('button')
    .forEach((button) => button.addEventListener('click', () => navigate(button.dataset.layer, null, true)));
  $('#layer-title').textContent = names[model.layer];
  $('#layer-index').textContent = `0${index + 1} / 03`;
  $('#scope-label').textContent =
    model.layer === 'root'
      ? t('x86-64 · путь загрузки')
      : model.layer === 'startup'
        ? t('head_64.S · вход 0x200')
        : t('Улучши расчёт, сохраняя поведение Linux');
  $('#map-kind').textContent =
    model.layer === 'placement'
      ? t('РЕДАКТОР БЛОКОВ')
      : model.layer === 'startup'
        ? t('ПЕРВЫЕ ИНСТРУКЦИИ')
        : t('МАРШРУТ ЗАГРУЗКИ');
  $('#map-status').textContent =
    model.layer === 'placement'
      ? editor.referenceMode
        ? t('Linux · только просмотр')
        : editor.acceptedAssembly !== null
          ? editor.isReference()
            ? t('Старт: алгоритм Linux')
            : t('Моё решение')
          : model.state?.program?.isReference
            ? t('Старт: алгоритм Linux')
            : t('Моё решение')
      : t('1 блок доступен');
  $('#back-button').hidden = model.layer === 'root';
  $('#contract-button').disabled = model.layer !== 'placement';
  $('#code-button').disabled = model.layer !== 'placement';
  $('#run-label').textContent = model.busy
    ? t('Проверяем…')
    : model.layer === 'placement'
      ? t('Проверить')
      : model.layer === 'startup'
        ? t('Открыть блок')
        : t('Исследовать');
  $('#run-button').disabled = model.busy || (model.layer === 'placement' && !model.visualReady);
  $('#scene-hint').innerHTML =
    model.layer === 'placement'
      ? editor.referenceMode
        ? t('Исходник · правки сохранены')
        : t('Меняй расчёт · сохраняй результат')
      : `<span class="hint-key">↵</span> ${escape(t('Войти в блок'))}`;
  renderMetrics(model, runBenchmark);
}
