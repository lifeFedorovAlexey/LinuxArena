// SPDX-License-Identifier: GPL-2.0-only
// Generic Blockly vocabulary. Algorithm names and machine bindings belong to adapters.
export const NUMBER_BLOCKS = Object.freeze([
  'arena_input',
  'arena_variable',
  'arena_literal',
  'arena_binary',
  'arena_unary',
]);
export const BINARY_OPERATIONS = Object.freeze(['add', 'sub', 'and', 'or', 'xor']);
export const UNARY_OPERATIONS = Object.freeze(['not', 'inc', 'dec', 'cast']);
export const COMPARISONS = Object.freeze([
  'branch_ge',
  'branch_lt',
  'branch_gt',
  'branch_le',
  'branch_eq',
  'branch_ne',
]);

const comparisonOptions = [
  ['≥', 'branch_ge'],
  ['<', 'branch_lt'],
  ['>', 'branch_gt'],
  ['≤', 'branch_le'],
  ['=', 'branch_eq'],
  ['≠', 'branch_ne'],
];
const mathOptions = [
  ['+', 'add'],
  ['−', 'sub'],
  ['И', 'and'],
  ['ИЛИ', 'or'],
  ['XOR', 'xor'],
];
const width = () => ({
  type: 'field_dropdown',
  name: 'WIDTH',
  options: [
    ['32', '32'],
    ['64', '64'],
  ],
});
const number = (name) => ({ type: 'input_value', name, check: 'Number' });
const statement = (name) => ({ type: 'input_statement', name });
const dropdown = (name, options) => ({ type: 'field_dropdown', name, options });
const fields = (items, labelKey = 'label') => items.map((item) => [item[labelKey], item.key]);

/** Register behavior through Blockly's supported extension API, without a custom renderer. */
export function registerVisualExtensions(Blockly) {
  if (!Blockly.Extensions.isRegistered('arena_optional_else')) {
    Blockly.Extensions.registerMutator('arena_optional_else', {
      saveExtraState() {
        return { hasElse: Boolean(this.getInput('ELSE')) };
      },
      loadExtraState(state) {
        const hasElse = state?.hasElse === true;
        if (hasElse && !this.getInput('ELSE')) {
          this.appendDummyInput('ELSE_LABEL').appendField('иначе');
          this.appendStatementInput('ELSE');
        } else if (!hasElse && this.getInput('ELSE')) {
          if (this.getInputTargetBlock('ELSE')) throw new Error('Сначала вынь команды из ветки «иначе».');
          this.removeInput('ELSE');
          this.removeInput('ELSE_LABEL');
        }
      },
      customContextMenu(options) {
        const hasElse = Boolean(this.getInput('ELSE'));
        options.push({
          text: hasElse ? 'Убрать «иначе»' : 'Добавить «иначе»',
          enabled: !this.getInputTargetBlock('ELSE'),
          callback: () => {
            const before = JSON.stringify(this.saveExtraState());
            this.loadExtraState({ hasElse: !hasElse });
            Blockly.Events.fire(
              new Blockly.Events.BlockChange(
                this,
                'mutation',
                null,
                before,
                JSON.stringify(this.saveExtraState()),
              ),
            );
          },
        });
      },
    });
  }
  if (!Blockly.Extensions.isRegistered('arena_numeric_properties')) {
    Blockly.Extensions.register('arena_numeric_properties', function () {
      this.getField('WIDTH').setVisible(false);
      const description = this.tooltip;
      this.setTooltip(
        () => `${description}\n${this.getFieldValue('WIDTH')} бита. Разрядность меняется в контекстном меню.`,
      );
      this.customContextMenu = (options) => {
        for (const value of ['32', '64'])
          options.push({
            text: `${this.getFieldValue('WIDTH') === value ? '✓ ' : ''}${value} бита`,
            enabled: true,
            callback: () => this.setFieldValue(value, 'WIDTH'),
          });
      };
    });
  }
}

export function createVisualBlockDefinitions(adapter) {
  const inputOptions = fields(adapter.inputs);
  const variableOptions = fields(adapter.variables);
  const statementBlock = (type, message0, args0, style = 'math_blocks') => ({
    type,
    message0,
    args0,
    previousStatement: null,
    nextStatement: null,
    style,
    inputsInline: true,
  });
  const outputBlock = (type, message0, args0, output = 'Number', style = 'data_blocks') => ({
    type,
    message0,
    args0,
    output,
    style,
    inputsInline: true,
  });
  const choice = {
    type: 'arena_if',
    message0: 'если %1',
    args0: [{ type: 'input_value', name: 'TEST', check: 'Boolean' }],
    message1: '%1',
    args1: [statement('THEN')],
    previousStatement: null,
    nextStatement: null,
    style: 'condition_blocks',
    mutator: 'arena_optional_else',
  };
  return [
    {
      type: 'arena_entry',
      message0: adapter.entryTitle ?? 'Начало',
      nextStatement: null,
      hat: 'cap',
      style: 'entry_blocks',
    },
    {
      type: 'arena_result',
      message0: adapter.resultLabel ?? 'Результат',
      previousStatement: null,
      style: 'entry_blocks',
    },
    outputBlock('arena_input', '%1', [dropdown('KEY', inputOptions)]),
    outputBlock('arena_variable', '%1', [dropdown('VAR', variableOptions)], ['Number', 'Variable']),
    {
      ...outputBlock('arena_literal', '%1', [{ type: 'field_input', name: 'VALUE', text: '0' }]),
      tooltip: 'Число. Нажми, чтобы изменить; перетащи в гнездо операции.',
    },
    {
      ...outputBlock(
        'arena_binary',
        '%1 %2 %3 %4',
        [width(), number('LEFT'), dropdown('OP', mathOptions), number('RIGHT')],
        'Number',
        'math_blocks',
      ),
      extensions: ['arena_numeric_properties'],
      tooltip: 'Арифметика без знака.',
    },
    {
      ...outputBlock(
        'arena_unary',
        '%1 %2 %3',
        [
          width(),
          dropdown('OP', [
            ['НЕ', 'not'],
            ['+1', 'inc'],
            ['−1', 'dec'],
            ['младшие биты', 'cast'],
          ]),
          number('VALUE'),
        ],
        'Number',
        'math_blocks',
      ),
      extensions: ['arena_numeric_properties'],
      tooltip: 'Инкремент и декремент сохраняют перенос. НЕ и выбор младших битов сохраняют флаги.',
    },
    statementBlock(
      'arena_assign',
      '%1 ← %2',
      [{ type: 'input_value', name: 'TARGET', check: 'Variable' }, number('VALUE')],
      'data_blocks',
    ),
    outputBlock(
      'arena_condition',
      '%1 %2 %3',
      [number('LEFT'), dropdown('OP', comparisonOptions), number('RIGHT')],
      'Boolean',
      'condition_blocks',
    ),
    statementBlock(
      'arena_compare',
      'сравнить %1 и %2',
      [number('LEFT'), number('RIGHT')],
      'condition_blocks',
    ),
    outputBlock(
      'arena_flag_condition',
      '%1',
      [
        dropdown('OP', [
          ['нет переноса', 'branch_ge'],
          ['есть перенос', 'branch_lt'],
          ['нет переноса и результат не нулевой', 'branch_gt'],
          ['перенос или нулевой результат', 'branch_le'],
          ['нулевой результат', 'branch_eq'],
          ['не нулевой результат', 'branch_ne'],
        ]),
      ],
      'Boolean',
      'condition_blocks',
    ),
    choice,
    outputBlock(
      'arena_boolean_input',
      '%1 %2',
      [
        dropdown('KEY', [[adapter.buildInput.label, adapter.buildInput.key]]),
        dropdown('WHEN', [
          ['включено', 'enabled'],
          ['выключено', 'disabled'],
        ]),
      ],
      'Boolean',
      'data_blocks',
    ),
  ];
}

export function createVisualToolbox(adapter) {
  const block = (type, fields) => ({ kind: 'block', type, ...(fields ? { fields } : {}) });
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category',
        name: 'Данные',
        colour: '#2d9c91',
        contents: [
          ...adapter.inputs.map((input) => block('arena_input', { KEY: input.key })),
          block('arena_boolean_input', { KEY: adapter.buildInput.key, WHEN: 'enabled' }),
          block('arena_literal', { VALUE: '0' }),
          ...adapter.variables
            .filter((variable) => !variable.temporary)
            .map((variable) => block('arena_variable', { VAR: variable.key })),
        ],
      },
      {
        kind: 'category',
        name: 'Вычисления',
        colour: '#53a66e',
        contents: [
          block('arena_assign'),
          ...BINARY_OPERATIONS.map((OP) => block('arena_binary', { OP, WIDTH: '64' })),
          block('arena_unary', { OP: 'not', WIDTH: '64' }),
        ],
      },
      {
        kind: 'category',
        name: 'Условия',
        colour: '#d69435',
        contents: [
          { ...block('arena_if'), extraState: { hasElse: false } },
          { ...block('arena_if'), extraState: { hasElse: true } },
          block('arena_condition', { OP: 'branch_ge' }),
        ],
      },
      {
        kind: 'category',
        name: 'Дополнительно',
        colour: '#938674',
        contents: [
          ...['inc', 'dec', 'cast'].map((OP) => block('arena_unary', { OP, WIDTH: '64' })),
          block('arena_compare'),
          block('arena_flag_condition', { OP: 'branch_ge' }),
        ],
      },
    ],
  };
}
