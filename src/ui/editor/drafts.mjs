import { t } from '../shared/i18n/index.mjs';
import {
  modelToWorkspace,
  compileWorkspace,
  migrateLegacyWorkspace,
  migrateConfigPredicates,
  migrateExpressionWorkspace,
  validateWorkspaceDraft,
} from '../../core/placement/visual.mjs';
import { serializeAssembly } from '../../core/placement/index.mjs';
import { PLACEMENT_ADAPTER } from '../../core/placement/adapter.mjs';

const storageKey = 'linuxarena.visual-draft.v6';
const previousStorageKeys = [5, 4, 3, 2, 1].map((version) => `linuxarena.visual-draft.v${version}`);
const draftError = (error) =>
  error.message.includes('Чтение %rbp') ? 'Сначала задай адрес, затем используй его.' : error.message;
function migrateDraft(json) {
  const visit = (node) => {
    if (!node) return;
    if (node.type === 'arena_if' && node.fields?.OP) {
      node.inputs = {
        TEST: {
          block: { type: 'arena_condition', id: `condition-${node.id}`, fields: { OP: node.fields.OP } },
        },
      };
      delete node.fields;
    }
    visit(node.next?.block);
    for (const input of Object.values(node.inputs ?? {})) visit(input.block);
  };
  for (const node of json.blocks?.blocks ?? []) visit(node);
  return json;
}

function restoredWorkspace(key, workspace) {
  if (key.endsWith('.v6')) {
    const entry = workspace?.blocks?.blocks?.find((block) => block.type === 'arena_entry');
    const metadata = JSON.parse(entry?.data);
    if (metadata?.visualVersion !== 6 || metadata?.adapter !== PLACEMENT_ADAPTER.id)
      throw new Error('Версия или привязка сохранённого черновика не поддерживается.');
  }
  const structured =
    key.endsWith('.v6') || key.endsWith('.v5') || key.endsWith('.v4')
      ? workspace
      : key.endsWith('.v3')
        ? migrateConfigPredicates(workspace)
        : migrateLegacyWorkspace(migrateDraft(workspace));
  const result = migrateExpressionWorkspace(structured);
  validateWorkspaceDraft(result);
  return result;
}

// Owns draft recovery, conflict handling and accepted-program synchronization.
export function createDraftController(editor) {
  function persist() {
    if (editor.preserveStoredDraft) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ base: editor.acceptedAssembly, workspace: editor.snapshot() }),
      );
      editor.storageWarning = false;
    } catch {
      if (!editor.storageWarning)
        editor.onNotice?.(
          t('Не удалось сохранить локальный черновик. Не закрывай вкладку до сохранения рабочего алгоритма.'),
        );
      editor.storageWarning = true;
    }
  }

  function recoverStoredDraft(key, raw, { baseChanged = false } = {}) {
    let backedUp = false;
    try {
      if (key === null || raw === null) throw new Error('Исходная запись недоступна.');
      const prefix = `${key}.recovery.${Date.now()}`;
      let backupKey = prefix;
      let suffix = 1;
      while (localStorage.getItem(backupKey) !== null) backupKey = `${prefix}.${suffix++}`;
      localStorage.setItem(backupKey, raw);
      backedUp = true;
    } catch {
      editor.preserveStoredDraft = true;
    }
    const reason = baseChanged
      ? t('Черновик относится к другой версии кода.')
      : t('Черновик не удалось открыть.');
    editor.onNotice?.(
      `${reason} ${
        backedUp
          ? t('Исходная запись и отдельная копия сохранены; открыт рабочий алгоритм.')
          : t('Исходная запись защищена от перезаписи; локальное сохранение недоступно.')
      }`,
    );
  }

  function readStoredDraft(assembly) {
    let key = null;
    let raw = null;
    try {
      key =
        [storageKey, ...previousStorageKeys].find((candidate) => localStorage.getItem(candidate) !== null) ??
        null;
      if (key === null) return null;
      raw = localStorage.getItem(key);
      const saved = JSON.parse(raw);
      if (
        saved === null ||
        typeof saved !== 'object' ||
        typeof saved.base !== 'string' ||
        !Object.hasOwn(saved, 'workspace')
      )
        throw new Error('Неверная запись сохранённого черновика.');
      if (saved.base !== assembly) {
        recoverStoredDraft(key, raw, { baseChanged: true });
        return { recovered: true };
      }
      return { key, raw, workspace: restoredWorkspace(key, saved.workspace) };
    } catch {
      recoverStoredDraft(key, raw);
      return { recovered: true };
    }
  }

  function setGraph(model, { restoreDraft = true } = {}) {
    editor.clearProblem();
    editor.model = model;
    const assembly = serializeAssembly(model);
    if (assembly === editor.acceptedAssembly) return;
    if (editor.pending) {
      editor.acceptedAssembly = assembly;
      return;
    }
    if (editor.dirty) {
      editor.remoteModel = model;
      editor.onDraft({ valid: false, error: 'Код изменился снаружи. Сохрани блоки или загрузи код заново.' });
      return;
    }
    const saved = restoreDraft && editor.acceptedAssembly === null ? readStoredDraft(assembly) : null;
    let workspace = saved?.workspace ?? modelToWorkspace(model);
    let restoredDraft = Boolean(saved?.workspace);
    let recovered = Boolean(saved?.recovered);
    editor.acceptedAssembly = assembly;
    try {
      editor.load(workspace);
    } catch (error) {
      if (!restoredDraft) throw error;
      recoverStoredDraft(saved.key, saved.raw);
      recovered = true;
      restoredDraft = false;
      workspace = modelToWorkspace(model);
      editor.load(workspace);
    }
    try {
      const compiled = compileWorkspace(workspace);
      editor.instructionBlocks = compiled.instructionBlocks;
      if (restoredDraft && compiled.assembly !== compileWorkspace(modelToWorkspace(model)).assembly) {
        editor.dirty = true;
        editor.onDraft({ valid: false, pending: true, error: '' });
        editor.timer = setTimeout(() => commit(), 350);
      } else editor.onDraft({ valid: true, error: '' });
    } catch (error) {
      editor.dirty = true;
      editor.onDraft({ valid: false, error: error.message });
    }
    if (!recovered) persist();
  }

  async function commit() {
    clearTimeout(editor.timer);
    if (editor.pending || editor.workspace.isDragging()) {
      editor.timer = setTimeout(() => commit(), 150);
      return false;
    }
    let compiled;
    try {
      compiled = compileWorkspace(editor.snapshot());
    } catch (error) {
      editor.onDraft({ valid: false, error: draftError(error) });
      persist();
      return false;
    }
    editor.instructionBlocks = compiled.instructionBlocks;
    if (compiled.assembly === editor.acceptedAssembly) {
      editor.dirty = false;
      editor.onDraft({ valid: true, error: '' });
      persist();
      return true;
    }
    const version = editor.version;
    editor.pending = true;
    try {
      await editor.onProgram(compiled.assembly);
      editor.acceptedAssembly = compiled.assembly;
      if (version === editor.version) {
        editor.dirty = false;
        editor.onDraft({ valid: true, error: '' });
      } else editor.timer = setTimeout(() => commit(), 0);
      persist();
      return version === editor.version;
    } catch (error) {
      editor.onDraft({ valid: false, error: draftError(error) });
      return false;
    } finally {
      editor.pending = false;
    }
  }

  function reload(model) {
    editor.dirty = false;
    editor.acceptedAssembly = null;
    setGraph(model, { restoreDraft: false });
  }
  return { persist, recoverStoredDraft, readStoredDraft, setGraph, commit, reload };
}
