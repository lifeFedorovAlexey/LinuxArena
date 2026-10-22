import { CONTRACT_CASES } from '../../core/placement/index.mjs';
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';

export function contractTemplate() {
  return `
      <div class="cv-heading">
        <div class="cv-title"><span class="cv-title-mark">${check}</span><span>Задача блока</span></div>
        <span class="cv-state" role="status" aria-live="polite"></span>
      </div>
      <p class="cv-goal">Найди адрес для распаковки ядра: выровняй вверх по шагу, соблюди нижнюю границу.<span>Без перемещения — всегда нижняя граница.</span></p>
      <div class="cv-flow">
        <div class="cv-input-area">
          <div class="cv-fields">
            <label class="cv-field"><span>Адрес загрузки</span><input name="loadAddress" aria-label="Адрес загрузки" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x1380000"><small data-unit="loadAddress">—</small></label>
            <label class="cv-field"><span>Шаг</span><input name="alignment" aria-label="Шаг выравнивания" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x200000"><small data-unit="alignment">—</small></label>
            <label class="cv-field"><span>Нижняя граница</span><input name="minimumAddress" aria-label="Нижняя граница адреса" spellcheck="false" autocomplete="off" maxlength="32" placeholder="0x1000000"><small data-unit="minimumAddress">—</small></label>
          </div>
          <label class="cv-relocatable"><input name="relocatable" type="checkbox" aria-label="Разрешить перемещение"><span class="cv-switch" aria-hidden="true"></span><span>Перемещение</span></label>
        </div>
        <div class="cv-flow-arrow">${arrow}</div>
        <div class="cv-outputs">
          <div class="cv-output cv-expected"><span class="cv-output-label">Linux · ожидаем</span><strong data-value="expected">—</strong><small data-address="expected">—</small></div>
          <span class="cv-equals" aria-hidden="true">=</span>
          <div class="cv-output cv-actual"><span class="cv-output-label">Моё решение</span><strong data-value="actual">—</strong><small data-address="actual">—</small></div>
        </div>
      </div>
      <div class="cv-rule-row"><span class="cv-rule">4 примера · шаг 2 МиБ · граница 16 МиБ</span><span class="cv-error" role="alert" hidden></span></div>
      <div class="cv-cases" aria-label="Четыре условия для адреса распаковки">
        ${CONTRACT_CASES.map((item) => `<button type="button" class="cv-case" data-case="${item.id}"><span class="cv-case-title"><i class="cv-case-mark" aria-hidden="true">·</i><span>${item.title}</span></span><span class="cv-case-path"><span data-case-input>—</span><span class="cv-mini-arrow">→</span><strong data-case-expected>—</strong></span><span class="cv-case-actual" data-case-actual hidden></span><span class="cv-case-reason" data-case-reason hidden></span></button>`).join('')}
      </div>
      <button type="button" class="cv-problem" hidden>Показать причину в схеме <span aria-hidden="true">↗</span></button>`;
}
