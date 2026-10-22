import { getLocale, t } from '../shared/i18n/index.mjs';
import { createVisualToolbox } from '../../core/visual/language.mjs';
import { PLACEMENT_ADAPTER } from '../../core/placement/adapter.mjs';

const Blockly = window.Blockly;
const fields = new WeakMap();
const blocks = new WeakSet();
const messages = { ru: { ...Blockly.Msg } };

/** Load the pinned vendor catalog once; later switches are synchronous and offline. */
export async function prepareBlocklyLocales() {
  const script = document.createElement('script');
  script.src = '/vendor/blockly/msg/en.js';
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the Blockly English catalog.'));
    document.head.append(script);
  });
  messages.en = { ...Blockly.Msg };
  Blockly.setLocale(messages[getLocale()] ?? messages.ru);
}

function blockText(source) {
  return source
    .split('\n')
    .map((line) => {
      const width = /^(✓ )?(32|64) бита(\. Разрядность меняется в контекстном меню\.)?$/.exec(line);
      if (!width) return t(line);
      return (
        (width[1] ?? '') +
        t(width[3] ? '{width} бита. Разрядность меняется в контекстном меню.' : '{width} бита', {
          width: width[2],
        })
      );
    })
    .join('\n');
}

function localizeField(field) {
  if (field instanceof Blockly.FieldDropdown) {
    if (!fields.has(field)) fields.set(field, field.getOptions(false));
    const value = field.getValue();
    field.setOptions(() => fields.get(field).map(([label, id]) => [t(label), id]));
    field.setValue(value);
    field.forceRerender();
    field.recomputeAriaContext();
  } else if (field instanceof Blockly.FieldLabel) {
    if (!fields.has(field)) fields.set(field, field.getValue());
    field.setValue(t(fields.get(field)));
  }
}

export function localizeBlock(block) {
  Blockly.Events.disable();
  try {
    for (const input of block.inputList) for (const field of input.fieldRow) localizeField(field);
  } finally {
    Blockly.Events.enable();
  }
  if (blocks.has(block)) return;
  blocks.add(block);
  const tooltip = block.tooltip;
  if (typeof tooltip === 'string' || typeof tooltip === 'function')
    block.setTooltip(() => blockText(typeof tooltip === 'function' ? tooltip.call(block) : tooltip));
  const menu = block.customContextMenu;
  if (menu)
    block.customContextMenu = function (options) {
      menu.call(this, options);
      for (const option of options) if (typeof option.text === 'string') option.text = blockText(option.text);
    };
  const load = block.loadExtraState;
  if (load)
    block.loadExtraState = function (state) {
      load.call(this, state);
      localizeBlock(this);
    };
}

export function defineLocalizedBlocks(definitions) {
  for (const definition of definitions) {
    // Dynamic menus keep labels intact: Blockly must not extract a shared word prefix.
    for (const [key, args] of Object.entries(definition)) {
      if (!key.startsWith('args')) continue;
      for (const arg of args)
        if (arg.type === 'field_dropdown') {
          const options = arg.options;
          arg.options = () => options;
        }
    }
  }
  Blockly.common.defineBlocksWithJsonArray(definitions);
  // Decorate initialization after Blockly has applied and validated its mutators.
  for (const { type } of definitions) {
    const initialize = Blockly.Blocks[type].init;
    Blockly.Blocks[type].init = function () {
      initialize.call(this);
      localizeBlock(this);
    };
  }
}

export function localizedToolbox() {
  const toolbox = createVisualToolbox(PLACEMENT_ADAPTER);
  for (const category of toolbox.contents) category.name = t(category.name);
  return toolbox;
}

export function localizeWorkspaces(workspace, referenceWorkspace) {
  Blockly.setLocale(messages[getLocale()] ?? messages.ru);
  for (const current of [workspace, referenceWorkspace])
    for (const block of current?.getAllBlocks(false) ?? []) localizeBlock(block);
  workspace.updateToolbox?.(localizedToolbox());
}
