export class LanguageSwitcher {
  constructor(host, { languages, value, label, onChange }) {
    this.host = host;
    this.buttons = new Map();
    const Abort = host.ownerDocument.defaultView?.AbortController ?? AbortController;
    this.abort = new Abort();
    host.classList.add('language-switcher');
    host.setAttribute('role', 'group');
    for (const [id, language] of Object.entries(languages)) {
      const button = host.ownerDocument.createElement('button');
      button.type = 'button';
      button.lang = id;
      button.textContent = id.toUpperCase();
      button.setAttribute('aria-label', language.label);
      button.addEventListener('click', () => onChange(id), { signal: this.abort.signal });
      this.buttons.set(id, button);
      host.append(button);
    }
    this.update({ value, label });
  }

  update({ value, label }) {
    this.host.setAttribute('aria-label', label);
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === value));
  }

  destroy() {
    this.abort.abort();
    this.buttons.clear();
    this.host.replaceChildren();
    this.host.classList.remove('language-switcher');
    this.host.removeAttribute('role');
    this.host.removeAttribute('aria-label');
  }
}
