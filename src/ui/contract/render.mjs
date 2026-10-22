import { t } from '../shared/i18n/index.mjs';
import { evaluateContractCase, evaluateContractCases } from '../../core/placement/index.mjs';
import { formatAddress } from './address.mjs';
import { renderCases, diagnosticMessage } from './render-cases.mjs';

export function renderContract(view) {
  if (view.destroyed) return;
  const pending = !view.preview && (view.pending > 0 || view.dirty.size > 0);
  const draftValid =
    view.draft.valid && !view.draft.pending && !pending && (!view.inputError || !!view.preview);
  const displayState = formState(view);
  const result = evaluateContractCases(displayState, { draftValid, checkCases: !view.run });
  if (view.run && draftValid)
    result.cases = result.cases.map((item) => view.run.results.get(item.id) ?? item);
  const suite = draftValid && !view.run?.running ? view.state?.checks?.candidate : null;
  renderCases(view, result.cases, suite);
  if (view.preview)
    result.current = view.visibleCases.get(view.preview.id) ?? evaluateContractCase(null, view.preview);
  result.status = statusFor(view, result, draftValid, suite);
  view.host.dataset.status = result.status;
  renderStatus(view, result, pending, suite);
  const error = view.host.querySelector('.cv-error');
  error.textContent = t(view.inputError ?? '');
  error.hidden = !view.inputError || !!view.preview;
  renderOutputs(view, result);
  view.host.querySelector('.cv-selection-label').textContent = view.preview
    ? t(result.current.title)
    : t('Свои данные');
  const manual = view.host.querySelector('.cv-manual');
  manual.hidden = !view.preview;
  manual.disabled = !!view.run?.running;
}

function formState(view) {
  if (!view.state || !view.dirty.size || view.preview) return view.state;
  const inputs = { ...view.state.inputs };
  for (const name of view.dirty) inputs[name] = view.fields.get(name).value;
  return { ...view.state, inputs };
}

function statusFor(view, result, draftValid, suite) {
  if (!view.state) return 'empty';
  if (!draftValid) return 'stale';
  if (view.run?.running) return 'running';
  if (
    view.run?.error ||
    suite?.status === 'failed' ||
    result.current.error ||
    result.current.passed === false ||
    result.cases.some((item) => item.passed === false)
  )
    return 'failed';
  if (result.current.warnings?.length) return 'caution';
  return result.current.passed === true ? 'passed' : 'empty';
}

function renderStatus(view, result, pending, suite) {
  const passed = suite?.passed ?? result.cases.filter((item) => item.passed === true).length;
  const total = suite?.total ?? result.total;
  const progress = view.run?.results.size ?? 0;
  const count = t('{passed}/{total} проверок', { passed, total });
  const labels = {
    empty: t('Выберите вход'),
    passed: count,
    failed: view.run?.error
      ? t('Проверка прервана')
      : passed === total
        ? t('Ошибка на текущем вводе')
        : count,
    caution: t('Вне штатных условий'),
    running:
      progress < result.total
        ? t('Проверяем {current}/{total}', { current: progress + 1, total: result.total })
        : t('Полный набор…'),
    stale:
      view.draft.pending || view.pending > 0
        ? t('Обновляем…')
        : pending
          ? t('Вход изменён')
          : t('Схема не завершена'),
  };
  view.host.querySelector('.cv-state').textContent = labels[result.status];
  view.host.setAttribute('aria-busy', String(!!view.run?.running));
}

function renderOutputs(view, result) {
  const current = result.current;
  view.host.querySelector('.cv-outputs').dataset.match =
    current.passed === true ? 'yes' : current.passed === false ? 'no' : 'unknown';
  view.host.querySelector('.cv-equals').textContent =
    current.passed === false ? '≠' : current.passed === true ? '=' : '·';
  for (const name of ['expected', 'actual']) {
    const value = current[name];
    view.host.querySelector(`[data-value="${name}"]`).textContent =
      value == null ? '—' : formatAddress(value);
    const address = view.host.querySelector(`[data-address="${name}"]`);
    address.textContent =
      value ??
      (name === 'actual' && result.status === 'stale'
        ? view.draft.pending || view.pending > 0
          ? t('Обновляем…')
          : t('Ожидает изменения')
        : '—');
    address.title = value ?? '';
  }
  for (const [name, input] of view.fields) {
    const unit = view.host.querySelector(`[data-unit="${name}"]`);
    if (unit) unit.textContent = formatAddress(input.value);
  }
  renderDiagnostic(view, current);
}

function renderDiagnostic(view, current) {
  const diagnostic = view.host.querySelector('.cv-diagnostic');
  const message = current.error
    ? t(current.error)
    : current.passed === false
      ? t('Не совпал адрес: ожидалось {expected}, получено {actual}.', {
          expected: current.expected,
          actual: current.actual ?? '—',
        })
      : (current.warnings ?? []).map((warning) => t(warning)).join(' ');
  diagnostic.textContent = message;
  diagnostic.hidden = !message;
  diagnostic.dataset.status = current.passed === false || current.error ? 'failed' : 'caution';
  view.problem = current.diagnostic?.instructionIds.length ? current : null;
  const problemButton = view.host.querySelector('.cv-problem');
  problemButton.hidden = !view.problem || typeof view.onProblem !== 'function';
  problemButton.textContent = t('Показать причину в схеме ↗');
  if (view.problem) diagnostic.textContent += ` ${diagnosticMessage(current)}`;
}
