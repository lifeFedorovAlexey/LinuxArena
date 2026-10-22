import { t, formatNumber } from '../shared/i18n/index.mjs';
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
      metric(t('Загрузка ядра'), '—', t('мс'), t('Пока не измерено')) +
      metric(t('Распаковка'), '—', t('мс'), t('Пока не измерено'), { type: 'box' }) +
      metric(t('Инициализация'), '—', t('мс'), t('Пока не измерено'), { type: 'layers' }) +
      metric(t('Открытый маршрут'), '01', t('блок'), t('startup_64 → адрес распаковки'), {
        highlight: true,
        type: 'branch',
      });
  } else {
    const native = model.state?.checks?.native,
      candidate = model.state?.checks?.candidate,
      bench = model.state?.benchmark;
    const count = candidate ? formatNumber(candidate.passed) : '—';
    const asm = bench?.reference_median,
      rust = bench?.rust_median;
    const scope = model.layer === 'startup' ? t('Арифметический блок') : t('Корректность кандидата');
    $('#metrics').innerHTML =
      metric(
        scope,
        count,
        candidate ? `/ ${formatNumber(candidate.total)}` : t('тестов'),
        candidate?.status === 'failed'
          ? t('{count} несовпадений', { count: formatNumber(candidate.failed) })
          : candidate
            ? t('Модель · не проверка загрузки')
            : t('Пока не проверено'),
        {
          highlight: candidate?.status === 'passed',
          warning: candidate?.status === 'failed',
          type: 'checkCircle',
        },
      ) +
      metric(
        t('Rust ↔ исходные инструкции'),
        native?.cases ? formatNumber(native.cases) : '—',
        t('тестов'),
        native?.status === 'passed'
          ? t('Арифметика · 0 несовпадений')
          : native?.status === 'unavailable'
            ? t('Требуется сборка engine')
            : t('После запуска проверки'),
        { highlight: native?.status === 'passed', type: 'code' },
      ) +
      metric(
        t('Эталон · ASM'),
        Number.isFinite(asm)
          ? formatNumber(asm, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—',
        t('нс/оп'),
        asm ? t('9 серий · повторить замер') : t('Измерить арифметику'),
        { action: 'bench' },
      ) +
      metric(
        t('Фиксированный перенос · Rust'),
        Number.isFinite(rust)
          ? formatNumber(rust, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—',
        t('нс/оп'),
        rust ? t('Не результат изменённого графа') : t('Без присвоения рекорда'),
        { type: 'chip' },
      );
  }
  $('#metrics')
    .querySelectorAll('[data-action="bench"]')
    .forEach((button) => button.addEventListener('click', runBenchmark));
}
