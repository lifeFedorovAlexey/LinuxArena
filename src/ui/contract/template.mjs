import { t } from '../shared/i18n/index.mjs';
import { escape } from '../shared/dom.mjs';
import { CONTRACT_CASES, CONTRACT_REQUIREMENTS } from '../../core/placement/index.mjs';
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';
const inputLabels = {
  loadAddress: 'Адрес загрузки',
  alignment: 'Шаг',
  minimumAddress: 'Нижняя граница',
  relocatable: 'Перемещение',
};

function inputLabelTemplate(name) {
  const label = inputLabels[name];
  return `<span class="cv-term" data-input-name="${name}" data-i18n="${escape(label)}">${escape(t(label))}</span>`;
}

export function requirementTitleTemplate(item) {
  return t(item.title)
    .split(/(\{\w+\})/g)
    .map((part) => {
      const name = part.slice(1, -1);
      return Object.hasOwn(inputLabels, name) ? inputLabelTemplate(name) : escape(part);
    })
    .join('');
}

export function caseTemplate(item) {
  return `<button type="button" class="cv-case" data-case="${escape(item.id)}"><span class="cv-case-title"><i class="cv-case-mark" aria-hidden="true">·</i><span>${escape(t(item.title))}</span></span><span class="cv-case-path"><span data-case-input>—</span><span class="cv-mini-arrow">→</span><strong data-case-expected>—</strong></span><span class="cv-case-actual" data-case-actual hidden></span><span class="cv-case-reason" data-case-reason hidden></span></button>`;
}

function requirementTemplate(item) {
  return `<details class="cv-requirement" data-requirement="${item.id}"><summary><span class="cv-requirement-mark" aria-hidden="true">·</span><span class="cv-requirement-title">${requirementTitleTemplate(item)}</span><span class="cv-requirement-count"></span></summary><div class="cv-cases">${CONTRACT_CASES.filter(
    (sample) => sample.requirement === item.id,
  )
    .map(caseTemplate)
    .join('')}</div></details>`;
}

export function contractTemplate() {
  return `
      <div class="cv-heading">
        <div class="cv-title" data-i18n="Проверки">Проверки</div>
        <span class="cv-state" role="status" aria-live="polite"></span>
      </div>
      <div class="cv-selection"><span class="cv-selection-label" role="status"></span><button type="button" class="cv-manual" hidden data-i18n="Вручную">Вручную</button></div>
      <div class="cv-flow">
        <div class="cv-input-area">
          <div class="cv-fields">
            <label class="cv-field"><span>${inputLabelTemplate('loadAddress')}</span><input name="loadAddress" aria-label="Адрес загрузки" data-i18n-aria-label="Адрес загрузки" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x1380000"><small data-unit="loadAddress">—</small></label>
            <label class="cv-field"><span>${inputLabelTemplate('alignment')}</span><input name="alignment" aria-label="Шаг выравнивания" data-i18n-aria-label="Шаг выравнивания" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x200000"><small data-unit="alignment">—</small></label>
            <label class="cv-field"><span>${inputLabelTemplate('minimumAddress')}</span><input name="minimumAddress" aria-label="Нижняя граница адреса" data-i18n-aria-label="Нижняя граница адреса" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x1000000"><small data-unit="minimumAddress">—</small></label>
          </div>
          <label class="cv-relocatable"><input name="relocatable" type="checkbox" aria-label="Разрешить перемещение" data-i18n-aria-label="Разрешить перемещение"><span class="cv-switch" aria-hidden="true"></span><span>${inputLabelTemplate('relocatable')}</span></label>
        </div>
        <div class="cv-flow-arrow">${arrow}</div>
        <div class="cv-outputs">
          <div class="cv-output cv-expected"><span class="cv-output-label" data-i18n="Ожидается">Ожидается</span><strong data-value="expected">—</strong><small data-address="expected">—</small></div>
          <span class="cv-equals" aria-hidden="true">=</span>
          <div class="cv-output cv-actual"><span class="cv-output-label"><span data-i18n="Получено">Получено</span></span><strong data-value="actual">—</strong><small data-address="actual">—</small></div>
        </div>
      </div>
      <div class="cv-diagnostic" role="status" hidden></div>
      <span class="cv-error" role="alert" hidden></span>
      <div class="cv-requirements" aria-label="Требования и проверки" data-i18n-aria-label="Требования и проверки">
        ${CONTRACT_REQUIREMENTS.map(requirementTemplate).join('')}
      </div>
      <a class="cv-specification" href="https://docs.kernel.org/6.18/arch/x86/boot.html#details-of-header-fields" target="_blank" rel="noopener noreferrer"><span data-i18n="Протокол загрузки Linux 6.18">Протокол загрузки Linux 6.18</span> ↗</a>
      <details class="cv-suite" open><summary><span data-i18n="Дополнительные тесты">Дополнительные тесты</span></summary><div class="cv-suite-status" role="status"></div><div class="cv-batches">${[
        ['current', 'Текущий ввод'],
        ['boundaries', 'Границы u64 · 90 комбинаций'],
        ['random', 'Случайные входы · 4096 комбинаций'],
      ]
        .map(
          ([id, title]) =>
            `<div class="cv-batch" data-batch="${id}"><span data-i18n="${title}">${escape(t(title))}</span><span class="cv-batch-count">—</span></div>`,
        )
        .join('')}</div><div class="cv-suite-failures cv-cases"></div></details>
      <button type="button" class="cv-problem" hidden><span data-i18n="Показать причину в схеме">Показать причину в схеме</span><span aria-hidden="true">↗</span></button>`;
}
