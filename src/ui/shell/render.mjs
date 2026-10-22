import { $, escape } from '../shared/dom.mjs';
import { icon } from '../shared/icons.mjs';
import { renderMetrics } from './metrics.mjs';

export function renderChrome(model, editor, { navigate, runBenchmark }) {
  const names = { root: 'Ядро Linux', startup: 'Вход в ядро', placement: 'Адрес распаковки' };
  const order = ['root', 'startup', 'placement'],
    index = order.indexOf(model.layer);
  $('#breadcrumbs').innerHTML = order
    .slice(0, index + 1)
    .map(
      (id, i) =>
        `${i ? icon('chevron') : ''}<button class="${id === model.layer ? 'current' : ''}" data-layer="${id}">${escape(id === 'root' ? 'Linux' : id === 'startup' ? 'Вход' : 'Адрес')}</button>`,
    )
    .join('');
  $('#breadcrumbs')
    .querySelectorAll('button')
    .forEach((button) => button.addEventListener('click', () => navigate(button.dataset.layer, null, true)));
  $('#layer-title').textContent = names[model.layer];
  $('#layer-index').textContent = `0${index + 1} / 03`;
  $('#scope-label').textContent =
    model.layer === 'root'
      ? 'x86-64 · путь загрузки'
      : model.layer === 'startup'
        ? 'head_64.S · вход 0x200'
        : 'Улучши расчёт, сохраняя поведение Linux';
  $('#map-kind').textContent =
    model.layer === 'placement'
      ? 'РЕДАКТОР БЛОКОВ'
      : model.layer === 'startup'
        ? 'ПЕРВЫЕ ИНСТРУКЦИИ'
        : 'МАРШРУТ ЗАГРУЗКИ';
  $('#map-status').textContent =
    model.layer === 'placement'
      ? editor.referenceMode
        ? 'Linux · только просмотр'
        : editor.acceptedAssembly !== null
          ? editor.isReference()
            ? 'Старт: алгоритм Linux'
            : 'Моё решение'
          : model.state?.program?.isReference
            ? 'Старт: алгоритм Linux'
            : 'Моё решение'
      : '1 блок доступен';
  $('#back-button').hidden = model.layer === 'root';
  $('#contract-button').disabled = model.layer !== 'placement';
  $('#code-button').disabled = model.layer !== 'placement';
  $('#run-label').textContent = model.busy
    ? 'Проверяем…'
    : model.layer === 'placement'
      ? 'Проверить'
      : model.layer === 'startup'
        ? 'Открыть блок'
        : 'Исследовать';
  $('#run-button').disabled = model.busy || (model.layer === 'placement' && !model.visualReady);
  $('#scene-hint').innerHTML =
    model.layer === 'placement'
      ? editor.referenceMode
        ? 'Исходник · правки сохранены'
        : 'Меняй расчёт · сохраняй результат'
      : '<span class="hint-key">↵</span> Войти в блок';
  renderMetrics(model, runBenchmark);
}
