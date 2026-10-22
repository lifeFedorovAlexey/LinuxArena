import { $ } from './dom.mjs';
import { t } from './i18n/index.mjs';
export function createToast() {
  let toastTimer;
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    const element = $('#toast');
    element.textContent = t(message);
    element.classList.toggle('error', error);
    element.hidden = false;
    toastTimer = setTimeout(
      () => {
        element.hidden = true;
      },
      error ? 6500 : 3500,
    );
  }
  return toast;
}
