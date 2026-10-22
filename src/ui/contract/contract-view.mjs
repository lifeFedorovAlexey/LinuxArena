import { CONTRACT_CASES } from '../../core/placement/index.mjs';
import { contractTemplate } from './template.mjs';
import { renderContract } from './render.mjs';

/** A bounded, API-independent contract view. onInputs receives an input patch. */
export class ContractView {
  constructor(host, { onInputs = () => {}, onProblem = null } = {}) {
    this.host = host;
    this.onInputs = onInputs;
    this.onProblem = onProblem;
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
    for (const item of CONTRACT_CASES) {
      this.caseButtons.get(item.id).addEventListener(
        'click',
        () => {
          this.dirty.clear();
          this.applyInputs({ ...item.inputs });
        },
        options,
      );
    }
    host.querySelector('.cv-problem').addEventListener('click', () => this.showProblem(), options);
    this.render();
  }

  update(state) {
    if (this.destroyed) return;
    this.state = state;
    this.syncInputs();
    this.render();
  }

  setDraftState({ valid, error = null, pending = false } = {}) {
    if (this.destroyed) return;
    this.draft = { valid: valid !== false, error, pending: pending === true };
    this.render();
  }

  syncInputs() {
    if (!this.state || this.destroyed) return;
    for (const [name, input] of this.fields) {
      if (name === 'relocatable') input.checked = this.state.inputs.relocatable;
      else if (this.host.ownerDocument.activeElement !== input && !this.dirty.has(name))
        input.value = this.state.inputs[name];
    }
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
        button.textContent = 'Не удалось показать путь';
      }
    }
  }

  render() {
    renderContract(this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.host.replaceChildren();
    this.host.classList.remove('contract-view');
    delete this.host.dataset.status;
  }
}
