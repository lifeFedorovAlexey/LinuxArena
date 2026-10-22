import { t, formatNumber } from '../shared/i18n/index.mjs';
import { $ } from '../shared/dom.mjs';

export function createInspector(model) {
  function openInspector(tab = 'contract') {
    if (model.layer !== 'placement') return;
    $('#inspector').hidden = false;
    const code = tab === 'source';
    $('#contract-view').hidden = code;
    $('#source-view').hidden = !code;
    $('#contract-tab').classList.toggle('active', !code);
    $('#source-tab').classList.toggle('active', code);
    $('#contract-button').classList.toggle('active', !code);
    $('#code-button').classList.toggle('active', code);
    renderInputs();
  }

  function closeInspector() {
    $('#inspector').hidden = true;
    $('#contract-button').classList.remove('active');
    $('#code-button').classList.remove('active');
  }

  function renderInputs() {
    if (!model.state) return;
    const active = document.activeElement;
    for (const [id, key] of [
      ['load-address', 'loadAddress'],
      ['minimum-address', 'minimumAddress'],
    ])
      if (active !== $(`#${id}`)) $(`#${id}`).value = model.state.inputs[key];
    const select = $('#alignment'),
      value = model.state.inputs.alignment;
    if (![...select.options].some((option) => option.value === value)) {
      const option = new Option(value, value);
      select.add(option);
    }
    if (active !== select) select.value = value;
    if (active !== $('#relocatable')) $('#relocatable').checked = model.state.inputs.relocatable;
    renderInputLabels();
    if (!model.sourceDirty) $('#source-editor').value = model.state.program.assembly;
  }

  function renderInputLabels() {
    $('#edit-status').textContent = t(model.sourceDirty ? 'Есть изменения' : 'Синхронизировано');
    if (!model.state) return;
    $('#output-value').textContent = model.state.evaluation.output;
    const byteAddress = BigInt(model.state.evaluation.output);
    $('#output-description').textContent =
      byteAddress < 2n ** 52n
        ? t('{value} MiB · адрес распаковки', {
            value: formatNumber(Number(byteAddress) / 1048576, { maximumFractionDigits: 3 }),
          })
        : t('Адрес распаковки · u64');
    $('#contract-warning').hidden = !model.state.evaluation.warnings.length;
    $('#contract-warning').textContent = model.state.evaluation.warnings
      .map((warning) => t(warning))
      .join(' ');
    const effects = model.state.evaluation.inferredEffects;
    const registers = effects?.registersWritten ?? ['rax', 'rbp'];
    $('#contract-effects').textContent = t('Записи в {registers}; арифметические флаги', {
      registers: registers.map((name) => name.toUpperCase()).join(', '),
    });
    const extraEffects = effects?.extraClobbers ?? [];
    $('#contract-extra-effects').hidden = !extraEffects.length;
    $('#contract-extra-effects').textContent = extraEffects.length
      ? t('Дополнительно: {registers}. Совместимость с окружением ядра ещё не проверена.', {
          registers: extraEffects.map((name) => name.toUpperCase()).join(', '),
        })
      : '';
  }
  return { openInspector, closeInspector, renderInputs, renderInputLabels };
}
