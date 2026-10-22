import { evaluateContractCases, formatAddress, sameContractInputs } from '../../core/placement/index.mjs';

export function renderContract(view) {
  if (view.destroyed) return;
  const pending = view.pending > 0 || view.dirty.size > 0;
  const draftValid = view.draft.valid && !view.draft.pending && !pending && !view.inputError;
  let displayState = view.state;
  if (view.state && view.dirty.size) {
    const inputs = { ...view.state.inputs };
    for (const name of view.dirty) inputs[name] = view.fields.get(name).value;
    displayState = { ...view.state, inputs };
  }
  const result = evaluateContractCases(displayState, { draftValid });
  view.host.dataset.status = result.status;
  const staleLabel =
    view.draft.pending || view.pending > 0 ? 'Обновляем…' : pending ? 'Вход изменён' : 'Схема не завершена';
  const labels = {
    empty: 'Выберите вход',
    passed: `${result.total} условия пройдены`,
    failed: `${result.passedCount} из ${result.total} условий`,
    caution: 'Вне штатных условий',
    stale: staleLabel,
  };
  view.host.querySelector('.cv-state').textContent = labels[result.status];
  const error = view.host.querySelector('.cv-error');
  error.textContent = view.inputError ?? '';
  error.hidden = !view.inputError;
  const current = result.current;
  view.host.querySelector('.cv-outputs').dataset.match =
    current.passed === true && result.status !== 'caution'
      ? 'yes'
      : current.passed === false
        ? 'no'
        : 'unknown';
  view.host.querySelector('.cv-equals').textContent =
    current.passed === false ? '≠' : current.passed === true ? '=' : '·';
  for (const name of ['expected', 'actual']) {
    const value = current[name];
    const readable = value === null ? '—' : formatAddress(value);
    view.host.querySelector(`[data-value="${name}"]`).textContent = readable;
    const address = view.host.querySelector(`[data-address="${name}"]`);
    address.textContent =
      value ??
      (name === 'actual' && result.status === 'stale'
        ? view.draft.pending || view.pending > 0
          ? 'Обновляем…'
          : 'Ожидает изменения'
        : '—');
    address.title = value ?? '';
  }
  for (const [name, input] of view.fields) {
    const unit = view.host.querySelector(`[data-unit="${name}"]`);
    if (unit) unit.textContent = formatAddress(input.value);
  }
  for (const item of result.cases) {
    const button = view.caseButtons.get(item.id);
    button.dataset.status = item.passed === true ? 'passed' : item.passed === false ? 'failed' : 'pending';
    const active = sameContractInputs(displayState?.inputs, item.inputs);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute(
      'aria-label',
      `${item.passed === true ? 'Пройдено' : item.passed === false ? 'Не пройдено' : 'Не проверено'}: ${item.title}. ${formatAddress(item.inputs.loadAddress)} → ${formatAddress(item.expected)}.${item.passed === false ? ` Сейчас: ${formatAddress(item.actual)}. ${item.diagnostic?.message ?? 'Схема не вычисляет адрес.'}` : ''}`,
    );
    button.title = `${item.title}: ${item.inputs.loadAddress} → ${item.expected}${item.actual ? `; получено ${item.actual}` : ''}`;
    button.querySelector('.cv-case-mark').textContent =
      item.passed === true ? '✓' : item.passed === false ? '×' : '·';
    button.querySelector('[data-case-input]').textContent = formatAddress(item.inputs.loadAddress);
    button.querySelector('[data-case-expected]').textContent = formatAddress(item.expected);
    const actual = button.querySelector('[data-case-actual]');
    actual.hidden = item.passed !== false;
    actual.textContent = item.error
      ? 'Схема не вычисляет адрес'
      : `Должно: ${formatAddress(item.expected)}; сейчас: ${formatAddress(item.actual)}`;
    const reason = button.querySelector('[data-case-reason]');
    // The generic mismatch is already stated by the preceding exact expected/actual values.
    reason.hidden = !item.diagnostic || item.diagnostic.kind === 'output-mismatch';
    reason.textContent = item.diagnostic?.message ?? '';
    button.disabled = view.pending > 0;
  }
  view.problem =
    result.cases.find(
      (item) =>
        item.diagnostic?.instructionIds.length && sameContractInputs(displayState?.inputs, item.inputs),
    ) ??
    result.cases.find((item) => item.diagnostic?.instructionIds.length) ??
    null;
  const problemButton = view.host.querySelector('.cv-problem');
  problemButton.hidden = !view.problem || typeof view.onProblem !== 'function';
  problemButton.textContent = 'Показать причину в схеме ↗';
}
