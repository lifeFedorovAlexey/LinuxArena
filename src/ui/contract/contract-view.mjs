import { t, onLocaleChange } from '../shared/i18n/index.mjs';
import { translateDOM } from '../shared/i18n/dom.mjs';
import { CONTRACT_CASES, CONTRACT_REQUIREMENTS, evaluateContractCase } from '../../core/placement/index.mjs';
import { contractTemplate } from './template.mjs';
import { renderContract } from './render.mjs';

/** A bounded, API-independent contract view. onInputs receives an input patch. */
export class ContractView {
  constructor(host, { onInputs = () => {}, onProblem = null, onPreview = () => {} } = {}) {
    this.host = host;
    this.onInputs = onInputs;
    this.onProblem = onProblem;
    this.onPreview = onPreview;
    this.preview = null;
    this.manualValues = null;
    this.run = null;
    this.runToken = 0;
    this.problem = null;
    this.state = null;
    this.draft = { valid: true, error: null, pending: false };
    this.dirty = new Set();
    this.pending = 0;
    this.inputError = null;
    this.destroyed = false;
    const Abort = host.ownerDocument.defaultView?.AbortController ?? AbortController;
    this.abort = new Abort();
    host.classList.add('contract-view');
    host.innerHTML = contractTemplate();
    translateDOM(host);
    this.unsubscribeLocale = onLocaleChange(() => {
      translateDOM(host);
      this.render();
    });
    this.fields = new Map([...host.querySelectorAll('input')].map((input) => [input.name, input]));
    this.caseButtons = new Map(
      [...host.querySelectorAll('[data-case]')].map((button) => [button.dataset.case, button]),
    );
    const options = { signal: this.abort.signal };
    for (const [name, input] of this.fields) {
      if (name === 'relocatable') {
        input.addEventListener('change', () => this.applyInputs({ relocatable: input.checked }), options);
      } else {
        input.addEventListener(
          'input',
          () => {
            this.dirty.add(name);
            this.inputError = null;
            input.removeAttribute('aria-invalid');
            this.render();
          },
          options,
        );
        input.addEventListener('change', () => this.applyInputs({ [name]: input.value }), options);
        input.addEventListener(
          'keydown',
          (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              this.applyInputs({ [name]: input.value });
            }
            if (event.key === 'Escape' && this.state) {
              event.preventDefault();
              this.dirty.delete(name);
              input.value = this.state.inputs[name];
              this.inputError = null;
              input.removeAttribute('aria-invalid');
              this.render();
            }
          },
          options,
        );
        input.addEventListener('blur', () => this.syncInputs(), options);
      }
    }
    host.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-case]');
        if (button && !button.disabled) this.selectCase(this.visibleCases.get(button.dataset.case));
      },
      options,
    );
    host.querySelector('.cv-manual').addEventListener('click', () => this.showManual(), options);
    host.querySelector('.cv-problem').addEventListener('click', () => this.showProblem(), options);
    this.render();
  }

  update(state) {
    if (this.destroyed) return;
    if (
      this.state &&
      this.state.program.model !== state.program.model &&
      JSON.stringify(this.state.program.model) !== JSON.stringify(state.program.model)
    ) {
      this.cancelChecks();
      this.showManual();
    }
    this.state = state;
    this.syncInputs();
    this.render();
  }

  setDraftState({ valid, error = null, pending = false } = {}) {
    if (this.destroyed) return;
    this.draft = { valid: valid !== false, error, pending: pending === true };
    if (!this.draft.valid || this.draft.pending) this.cancelChecks();
    this.render();
  }

  syncInputs() {
    if (!this.state || this.destroyed) return;
    for (const [name, input] of this.fields) {
      const inputs = this.preview?.inputs ?? this.state.inputs;
      input.readOnly = !!this.preview;
      if (name === 'relocatable') {
        input.disabled = !!this.preview;
        input.checked = inputs.relocatable;
      } else if (this.preview) input.value = inputs[name];
      else if (this.host.ownerDocument.activeElement !== input && !this.dirty.has(name))
        input.value = inputs[name];
    }
  }

  selectCase(item) {
    if (!item || this.destroyed) return;
    if (!this.preview)
      this.manualValues = new Map([...this.fields].map(([name, input]) => [name, input.value]));
    this.preview = item;
    this.syncInputs();
    this.onPreview(item.inputs);
    const group = this.caseButtons.get(item.id)?.closest('details');
    if (group) {
      for (const other of this.host.querySelectorAll('.cv-requirement')) other.open = other === group;
      group.open = true;
    }
    this.render();
  }

  showManual() {
    if (this.run?.running) return;
    this.preview = null;
    for (const [name, value] of this.manualValues ?? [])
      if (this.dirty.has(name)) this.fields.get(name).value = value;
    this.manualValues = null;
    this.syncInputs();
    this.onPreview(null);
    this.render();
  }

  async runChecks() {
    if (!this.state || !this.draft.valid || this.draft.pending || this.destroyed) return false;
    const token = ++this.runToken;
    const model = this.state.program.model;
    this.run = { running: true, active: null, results: new Map(), error: null };
    const samples = CONTRACT_REQUIREMENTS.flatMap((group) =>
      CONTRACT_CASES.filter((item) => item.requirement === group.id),
    );
    for (const item of samples) {
      if (token !== this.runToken || this.destroyed) return false;
      this.run.active = item.id;
      this.selectCase(evaluateContractCase(null, item));
      // Yield before execution so the inputs of this real check can be inspected.
      await new Promise((resolve) => {
        setTimeout(resolve, 160);
      });
      if (token !== this.runToken || this.destroyed) return false;
      const result = evaluateContractCase(model, item);
      this.run.results.set(item.id, result);
      this.preview = result;
      this.render();
    }
    this.run.active = null;
    this.render();
    return true;
  }

  finishChecks(error = null) {
    if (!this.run || this.destroyed) return;
    this.runToken++;
    this.run.active = null;
    this.run.running = false;
    this.run.error = error;
    this.render();
    const failed = [...this.visibleCases.values()].find((item) => item.passed === false);
    if (failed) this.selectCase(failed);
    else this.render();
  }

  cancelChecks() {
    this.runToken++;
    this.run = null;
  }

  async applyInputs(patch) {
    if (this.destroyed) return;
    const submitted = new Map(Object.keys(patch).map((key) => [key, this.fields.get(key)?.value]));
    this.pending++;
    this.inputError = null;
    this.render();
    try {
      const next = await this.onInputs(patch);
      if (this.destroyed) return;
      if (next?.inputs && next?.program) this.state = next;
      for (const name of Object.keys(patch)) {
        const input = this.fields.get(name);
        if (name === 'relocatable' || input.value === submitted.get(name)) this.dirty.delete(name);
        input?.removeAttribute('aria-invalid');
      }
    } catch {
      this.inputError = 'Проверьте входные значения';
      for (const name of Object.keys(patch)) this.fields.get(name)?.setAttribute('aria-invalid', 'true');
    } finally {
      this.pending--;
      if (!this.destroyed) {
        this.syncInputs();
        this.render();
      }
    }
  }

  async showProblem() {
    if (this.destroyed || !this.problem || typeof this.onProblem !== 'function') return;
    const { inputs, diagnostic } = this.problem;
    try {
      await this.onProblem({ inputs: { ...inputs }, instructionIds: [...diagnostic.instructionIds] });
    } catch {
      if (!this.destroyed) {
        const button = this.host.querySelector('.cv-problem');
        button.textContent = t('Не удалось показать путь');
      }
    }
  }

  render() {
    renderContract(this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelChecks();
    this.abort.abort();
    this.unsubscribeLocale();
    this.host.replaceChildren();
    this.host.classList.remove('contract-view');
    delete this.host.dataset.status;
  }
}
