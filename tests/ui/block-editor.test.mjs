import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import { REFERENCE_ASM, parseAssembly, serializeAssembly } from '../../src/core/placement/index.mjs';
import { modelToWorkspace, compileWorkspace } from '../../src/core/placement/visual.mjs';

// Exercise the real Blockly serializer in its supported headless environment.
globalThis.window = { Blockly };
globalThis.requestAnimationFrame = () => 0;
const { BlockEditor } = await import('../../src/ui/editor/block-editor.mjs');
const { createDraftController } = await import('../../src/ui/editor/drafts.mjs');
const model = parseAssembly(REFERENCE_ASM);
const assembly = serializeAssembly(model);
const canonical = compileWorkspace(modelToWorkspace(model)).assembly;
const key = 'linuxarena.visual-draft.v6';

function fixture(t, raw, { failStorage = false } = {}) {
  const records = new Map(raw === undefined ? [] : [[key, raw]]);
  globalThis.localStorage = {
    getItem: (name) => records.get(name) ?? null,
    setItem: (name, value) => {
      if (failStorage) throw new Error('Storage quota exceeded.');
      records.set(name, value);
    },
  };
  const notices = [],
    drafts = [],
    sent = [];
  const editor = Object.create(BlockEditor.prototype);
  Object.assign(editor, {
    acceptedAssembly: null,
    version: 0,
    workspace: new Blockly.Workspace(),
    instructionBlocks: {},
    onNotice: (message) => notices.push(message),
    onDraft: (state) => drafts.push(state),
    onProgram: async (source) => {
      sent.push(source);
    },
  });
  editor.drafts = createDraftController(editor);
  t.after(() => {
    clearTimeout(editor.timer);
    editor.workspace.dispose();
  });
  return { editor, records, notices, drafts, sent };
}

function flatten(json) {
  const result = [];
  const visit = (block) => {
    if (!block) return;
    result.push(block);
    for (const input of Object.values(block.inputs ?? {})) visit(input.block);
    visit(block.next?.block);
  };
  json.blocks.blocks.forEach(visit);
  return result;
}

test('corrupt, stale and malformed drafts fall back without replacing their exact stored bytes', (t) => {
  const invalid = [
    (draft) => {
      draft.blocks.blocks[0].type = 'arena_unknown_stale';
    },
    (draft) => {
      draft.blocks.languageVersion = 99;
    },
    (draft) => {
      draft.blocks.blocks[0].data = JSON.stringify({ visualVersion: 99, adapter: 'unknown' });
    },
    (draft) => {
      draft.blocks.blocks[0].next.block.fields = { unknown: true };
    },
  ];
  for (const mutate of invalid) {
    const draft = modelToWorkspace(model);
    mutate(draft);
    const raw = JSON.stringify({ base: assembly, workspace: draft }, null, 3) + '\n';
    const { editor, records, notices, drafts } = fixture(t, raw);
    assert.doesNotThrow(() => editor.setGraph(model));
    assert.equal(compileWorkspace(editor.snapshot()).assembly, canonical);
    assert.equal(records.get(key), raw);
    const backups = [...records].filter(([name]) => name.startsWith(`${key}.recovery.`));
    assert.equal(backups.length, 1);
    assert.equal(backups[0][1], raw);
    assert.match(notices[0], /отдельная копия сохранены/);
    assert.equal(drafts.at(-1).valid, true);
  }
});

test('invalid JSON is backed up byte for byte and does not stop editor startup', (t) => {
  const raw = '{ unparseable draft\n';
  const { editor, records, notices } = fixture(t, raw);
  assert.doesNotThrow(() => editor.setGraph(model));
  assert.equal(records.get(key), raw);
  assert.equal([...records.values()].filter((value) => value === raw).length, 2);
  assert.equal(notices.length, 1);
});

test('a draft for a changed server base is preserved with an explicit conflict notice', (t) => {
  const workspace = modelToWorkspace(model);
  const assignment = flatten(workspace).find((block) => block.type === 'arena_assign');
  delete assignment.inputs.VALUE;
  const raw = JSON.stringify({ base: 'older accepted assembly', workspace }, null, 2);
  const { editor, records, notices, drafts } = fixture(t, raw);
  editor.setGraph(model);
  assert.equal(compileWorkspace(editor.snapshot()).assembly, canonical);
  assert.equal(records.get(key), raw);
  assert.equal([...records.values()].filter((value) => value === raw).length, 2);
  assert.match(notices[0], /другой версии кода/);
  assert.equal(drafts.at(-1).valid, true);
});

test('an unchanged saved visual baseline does not auto-save canonical ASM over the original source', (t) => {
  const raw = JSON.stringify({ base: assembly, workspace: modelToWorkspace(model) });
  const { editor, drafts, sent, notices } = fixture(t, raw);
  assert.notEqual(canonical, assembly);
  editor.setGraph(model);
  assert.equal(Boolean(editor.dirty), false);
  assert.equal(editor.timer, undefined);
  assert.equal(drafts.at(-1).valid, true);
  assert.equal(editor.acceptedAssembly, assembly);
  assert.equal(sent.length, 0);
  assert.equal(notices.length, 0);
});

test('an older supported v6 assignment shape is migrated while an empty value remains empty', (t) => {
  const workspace = modelToWorkspace(model);
  const assignment = flatten(workspace).find((block) => block.type === 'arena_assign');
  const variable = assignment.inputs.TARGET.block.fields.VAR;
  assignment.fields = { VAR: variable };
  delete assignment.inputs.TARGET;
  delete assignment.inputs.VALUE;
  const { editor, notices, drafts } = fixture(t, JSON.stringify({ base: assembly, workspace }));
  editor.setGraph(model);
  const migrated = flatten(editor.snapshot()).find((block) => block.id === assignment.id);
  assert.equal(migrated.inputs.TARGET.block.fields.VAR, variable);
  assert.equal(migrated.inputs.VALUE?.block, undefined);
  assert.equal(notices.length, 0);
  assert.equal(drafts.at(-1).valid, false);
});

test('a valid incomplete draft preserves its empty socket and detached work instead of restoring baseline', (t) => {
  const workspace = modelToWorkspace(model);
  const assignment = flatten(workspace).find((block) => block.type === 'arena_assign');
  delete assignment.inputs.VALUE;
  workspace.blocks.blocks.push({
    type: 'arena_literal',
    id: 'detached-draft',
    fields: { VALUE: '37' },
    x: 700,
    y: 160,
  });
  const { editor, records, notices, drafts } = fixture(t, JSON.stringify({ base: assembly, workspace }));
  editor.setGraph(model);
  const restored = editor.snapshot();
  const actual = flatten(restored).find((block) => block.id === assignment.id);
  assert.equal(actual.inputs?.VALUE?.block, undefined);
  assert.equal(editor.workspace.getBlockById('detached-draft').getFieldValue('VALUE'), '37');
  assert.equal(editor.dirty, true);
  assert.equal(drafts.at(-1).valid, false);
  assert.equal(notices.length, 0);
  assert.equal(
    [...records.keys()].some((name) => name.includes('.recovery.')),
    false,
  );
});

test('backup storage failure protects the original record even when persistence is retried', (t) => {
  const raw = '{ unparseable draft\n';
  const { editor, records, notices } = fixture(t, raw, { failStorage: true });
  editor.setGraph(model);
  assert.equal(editor.preserveStoredDraft, true);
  editor.persist();
  assert.equal(records.get(key), raw);
  assert.equal(records.size, 1);
  assert.match(notices[0], /защищена от перезаписи/);
  assert.equal(compileWorkspace(editor.snapshot()).assembly, canonical);
});

test('a semantically changed valid draft is pending until the actual save callback accepts it', async (t) => {
  const workspace = modelToWorkspace(model);
  flatten(workspace).find((block) => block.type === 'arena_unary' && block.fields.OP === 'dec').fields.OP =
    'inc';
  const { editor, drafts, sent, notices } = fixture(t, JSON.stringify({ base: assembly, workspace }));
  editor.workspace.isDragging = () => false;
  editor.setGraph(model);
  clearTimeout(editor.timer);
  assert.equal(editor.dirty, true);
  assert.equal(drafts.at(-1).valid, false);
  assert.equal(drafts.at(-1).pending, true);
  assert.equal(sent.length, 0);
  assert.equal(await editor.commit(), true);
  assert.equal(sent.length, 1);
  assert.notEqual(sent[0], assembly);
  assert.equal(drafts.at(-1).valid, true);
  assert.equal(notices.length, 0);
});

test('a Blockly load failure also preserves the saved bytes and loads the real reference fallback', (t) => {
  const raw = JSON.stringify({ base: assembly, workspace: modelToWorkspace(model) });
  const { editor, records, notices } = fixture(t, raw);
  let attempts = 0;
  editor.load = (workspace) => {
    if (attempts++ === 0) throw new Error('Blockly serializer failed.');
    BlockEditor.prototype.load.call(editor, workspace);
  };
  assert.doesNotThrow(() => editor.setGraph(model));
  assert.equal(attempts, 2);
  assert.equal(compileWorkspace(editor.snapshot()).assembly, canonical);
  assert.equal(records.get(key), raw);
  assert.equal([...records.keys()].filter((name) => name.includes('.recovery.')).length, 1);
  assert.equal(notices.length, 1);
});
