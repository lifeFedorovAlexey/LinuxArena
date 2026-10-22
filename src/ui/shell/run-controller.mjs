import { t } from '../shared/i18n/index.mjs';
import { $ } from '../shared/dom.mjs';
import { api } from './api.mjs';

export function createRunController(
  model,
  { editor, contractView, toast, renderChrome, applyState, setReferenceView },
) {
  async function animateTrace() {
    if (model.layer !== 'placement' || !model.state) return;
    if (!editor.referenceMode && !model.visualReady) return;
    const token = ++model.traceToken;
    let evaluation;
    try {
      evaluation = editor.evaluation();
    } catch (error) {
      toast(error.message, true);
      return;
    }
    const trace = evaluation.trace.filter((entry) => !['label', 'jump'].includes(entry.op));
    editor.resetTrace();
    $('#trace-banner').hidden = false;
    for (const entry of trace) {
      if (token !== model.traceToken || model.layer !== 'placement') return;
      editor.highlight(entry.id);
      $('#trace-label').textContent = t(entry.label);
      $('#trace-value').textContent = entry.registers.rbp ?? entry.registers.rax ?? '—';
      await new Promise((resolve) => {
        setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
      });
    }
    if (token === model.traceToken) {
      editor.highlightResult();
      $('#trace-label').textContent = editor.referenceMode ? t('Linux · адрес получен') : t('Адрес получен');
      $('#trace-value').textContent = evaluation.output;
      setTimeout(() => {
        if (token === model.traceToken) {
          $('#trace-banner').hidden = true;
          editor.highlight(null);
        }
      }, 1800);
    }
  }

  async function runCheck() {
    if (model.busy) return;
    model.busy = true;
    $('#run-button').disabled = true;
    renderChrome();
    try {
      if (editor.referenceMode) setReferenceView(false);
      if (model.layer === 'placement' && !(await editor.commit())) return;
      const [next] = await Promise.all([api('check', {}), contractView.runChecks()]);
      applyState(next);
      contractView.finishChecks();
      const result = next.checks.candidate;
      toast(
        result.status === 'passed' ? t('Проверочный набор пройден') : t('Обнаружено расхождение с эталоном'),
        result.status !== 'passed',
      );
    } catch (error) {
      contractView.finishChecks(error.message);
      toast(error.message, true);
    } finally {
      model.busy = false;
      $('#run-button').disabled = false;
      renderChrome();
    }
  }

  async function runBenchmark() {
    if (model.busy) return;
    model.busy = true;
    $('#run-button').disabled = true;
    renderChrome();
    toast(t('Измеряем фиксированный Rust-перенос и ASM'));
    try {
      const next = await api('bench', {});
      applyState(next);
      toast(
        next.benchmark.status === 'measured'
          ? t('9 серий измерений завершены · локальный микротест')
          : (next.benchmark.reason ?? t('Измерение недоступно')),
        next.benchmark.status !== 'measured',
      );
    } catch (error) {
      toast(error.message, true);
    } finally {
      model.busy = false;
      $('#run-button').disabled = false;
      renderChrome();
    }
  }
  return { animateTrace, runCheck, runBenchmark };
}
