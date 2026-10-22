import { t } from '../shared/i18n/index.mjs';
import { CONTRACT_REQUIREMENTS } from '../../core/placement/index.mjs';
import { formatAddress } from './address.mjs';
import { caseTemplate, requirementTitleTemplate } from './template.mjs';

export function diagnosticMessage(item) {
  if (!item.diagnostic) return '';
  if (item.diagnostic.kind === 'output-mismatch')
    return t('Этот вход должен дать {expected}, получает {actual}.', {
      expected: formatAddress(item.expected),
      actual: formatAddress(item.actual),
    });
  return t(item.diagnostic.message);
}

function renderCase(button, item, view) {
  const active = view.preview?.id === item.id;
  const running = view.run?.active === item.id && !view.run.results.has(item.id);
  const status = item.passed === true ? 'passed' : item.passed === false ? 'failed' : 'pending';
  const label = running
    ? t('Проверяем…')
    : item.passed === true
      ? t('Пройдено')
      : item.passed === false
        ? t('Не пройдено')
        : t('Не проверено');
  button.dataset.status = running ? 'running' : status;
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute(
    'aria-label',
    `${label}: ${t(item.title)}. ${item.inputs.loadAddress} → ${item.expected}`,
  );
  button.title = `${t(item.title)}: ${item.inputs.loadAddress} → ${item.expected}`;
  button.querySelector('.cv-case-title span').textContent = t(item.title);
  button.querySelector('.cv-case-mark').textContent = running ? '…' : item.passed === false ? '×' : '·';
  button.querySelector('[data-case-input]').textContent = formatAddress(item.inputs.loadAddress);
  button.querySelector('[data-case-expected]').textContent = formatAddress(item.expected);
  const actual = button.querySelector('[data-case-actual]');
  actual.hidden = item.passed !== false;
  actual.textContent = item.error
    ? t('Схема не вычисляет адрес')
    : t('Должно: {expected}; сейчас: {actual}', {
        expected: formatAddress(item.expected),
        actual: formatAddress(item.actual),
      });
  const reason = button.querySelector('[data-case-reason]');
  reason.hidden = !item.error && (!item.diagnostic || item.diagnostic.kind === 'output-mismatch');
  reason.textContent = item.error ? t(item.error) : diagnosticMessage(item);
  button.disabled = !!view.run?.running || view.pending > 0;
}

function renderSuite(view, suite) {
  const host = view.host.querySelector('.cv-suite');
  const groups = (suite?.groups ?? []).filter((group) => group.id !== 'requirements');
  const failed = groups.some((group) => group.status === 'failed');
  host.dataset.status = groups.length ? (failed ? 'failed' : 'passed') : 'pending';
  host.querySelector('.cv-suite-status').textContent = view.run?.running
    ? t('Полный набор выполняется…')
    : view.run?.error
      ? t('Не удалось завершить проверку. Повторите запуск.')
      : groups.length
        ? t('Сравнение результата с Linux')
        : t('Запускается кнопкой «Проверить»');
  for (const row of host.querySelectorAll('[data-batch]')) {
    const group = groups.find((item) => item.id === row.dataset.batch);
    row.dataset.status = group?.status ?? 'pending';
    row.querySelector('.cv-batch-count').textContent = group ? `${group.passed}/${group.total}` : '—';
  }
  const failures = (groups.length ? groups.flatMap((group) => group.failures) : (suite?.failures ?? [])).map(
    (item, index) => ({
      ...item,
      id: `suite-${index}`,
      title: t('Ошибка {number}', { number: index + 1 }),
      actual: item.actual ?? null,
      passed: false,
      diagnostic: null,
    }),
  );
  const container = host.querySelector('.cv-suite-failures');
  for (const button of [...container.children]) {
    if (!failures.some((item) => item.id === button.dataset.case)) {
      view.caseButtons.delete(button.dataset.case);
      button.remove();
    }
  }
  for (const item of failures) {
    if (!view.caseButtons.has(item.id)) {
      container.insertAdjacentHTML('beforeend', caseTemplate(item));
      view.caseButtons.set(item.id, container.lastElementChild);
    }
  }
  if (suite?.status === 'failed') host.open = true;
  return failures;
}

export function renderCases(view, cases, suite) {
  const failures = renderSuite(view, suite);
  view.visibleCases = new Map([...cases, ...failures].map((item) => [item.id, item]));
  for (const item of view.visibleCases.values()) renderCase(view.caseButtons.get(item.id), item, view);
  for (const requirement of CONTRACT_REQUIREMENTS) {
    const group = view.host.querySelector(`[data-requirement="${requirement.id}"]`);
    const items = cases.filter((item) => item.requirement === requirement.id);
    const passed = items.filter((item) => item.passed === true).length;
    group.querySelector('.cv-requirement-title').innerHTML = requirementTitleTemplate(requirement);
    group.querySelector('.cv-requirement-count').textContent = `${passed}/${items.length}`;
    group.dataset.status = items.some((item) => item.passed === false)
      ? 'failed'
      : passed === items.length
        ? 'passed'
        : 'pending';
    group.querySelector('.cv-requirement-mark').textContent =
      group.dataset.status === 'passed' ? '✓' : group.dataset.status === 'failed' ? '×' : '·';
  }
}
