import { $, escape } from '../shared/dom.mjs';
import { icon } from '../shared/icons.mjs';

function metric(
  title,
  value,
  unit,
  foot,
  { highlight = false, action = null, warning = false, type = 'clock' } = {},
) {
  return `<article class="metric"><div class="metric-top"><span>${escape(title)}</span>${icon(type)}</div><div class="metric-value-row"><span class="metric-value${highlight ? ' highlight' : ''}">${escape(value)}</span><span class="metric-unit">${escape(unit)}</span></div><div class="metric-foot${warning ? ' warning' : ''}">${action ? `<button class="metric-action" data-action="${action}">${escape(foot)} ${icon('arrow')}</button>` : escape(foot)}</div></article>`;
}
export function renderMetrics(model, runBenchmark) {
  $('#metrics').hidden = model.layer === 'placement';
  if (model.layer === 'root') {
    $('#metrics').innerHTML =
      metric('Загрузка ядра', '—', 'мс', 'Пока не измерено') +
      metric('Распаковка', '—', 'мс', 'Пока не измерено', { type: 'box' }) +
      metric('Инициализация', '—', 'мс', 'Пока не измерено', { type: 'layers' }) +
      metric('Открытый маршрут', '01', 'блок', 'startup_64 → адрес распаковки', {
        highlight: true,
        type: 'branch',
      });
  } else {
    const native = model.state?.checks?.native,
      candidate = model.state?.checks?.candidate,
      bench = model.state?.benchmark;
    const count = candidate ? new Intl.NumberFormat('ru-RU').format(candidate.passed) : '—';
    const asm = bench?.reference_median,
      rust = bench?.rust_median;
    const scope = model.layer === 'startup' ? 'Арифметический блок' : 'Корректность кандидата';
    $('#metrics').innerHTML =
      metric(
        scope,
        count,
        candidate ? `/ ${candidate.total}` : 'тестов',
        candidate?.status === 'failed'
          ? `${candidate.failed} несовпадений`
          : candidate
            ? 'Модель · не проверка загрузки'
            : 'Пока не проверено',
        {
          highlight: candidate?.status === 'passed',
          warning: candidate?.status === 'failed',
          type: 'checkCircle',
        },
      ) +
      metric(
        'Rust ↔ исходные инструкции',
        native?.cases ? new Intl.NumberFormat('ru-RU').format(native.cases) : '—',
        'тестов',
        native?.status === 'passed'
          ? 'Арифметика · 0 несовпадений'
          : native?.status === 'unavailable'
            ? 'Требуется сборка engine'
            : 'После запуска проверки',
        { highlight: native?.status === 'passed', type: 'code' },
      ) +
      metric(
        'Эталон · ASM',
        Number.isFinite(asm) ? asm.toFixed(2) : '—',
        'нс/оп',
        asm ? '9 серий · повторить замер' : 'Измерить арифметику',
        { action: 'bench' },
      ) +
      metric(
        'Фиксированный перенос · Rust',
        Number.isFinite(rust) ? rust.toFixed(2) : '—',
        'нс/оп',
        rust ? 'Не результат изменённого графа' : 'Без присвоения рекорда',
        { type: 'chip' },
      );
  }
  $('#metrics')
    .querySelectorAll('[data-action="bench"]')
    .forEach((button) => button.addEventListener('click', runBenchmark));
}
