import { getLocale, t } from './index.mjs';

const attributes = ['title', 'aria-label', 'content'];

/** Translate only explicitly owned text/attributes; never replace controls or user values. */
export function translateDOM(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const name of attributes)
    for (const element of root.querySelectorAll(`[data-i18n-${name}]`))
      element.setAttribute(name, t(element.getAttribute(`data-i18n-${name}`)));
  if (root.documentElement) root.documentElement.lang = getLocale();
}
