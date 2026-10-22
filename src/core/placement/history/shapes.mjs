// SPDX-License-Identifier: GPL-2.0-only
import { branches } from '../../visual/schema.mjs';
export const fixedShapes = {
  arena_entry: {},
  arena_config_if: {},
  arena_if: {},
  arena_result: {},
  arena_alignment: {},
  arena_invert: {},
  arena_compare: {},
  arena_address: { SOURCE: ['load', 'minimum'] },
  arena_adjust: { OP: ['decrement32', 'increment32'] },
  arena_math: { OP: ['add64', 'subtract64', 'and64', 'or64', 'xor64'] },
  arena_condition: { OP: branches },
  arena_flag_condition: { OP: branches },
  arena_relocatable: { WHEN: ['enabled', 'disabled'] },
};
export const legacyShapes = { arena_config: {}, arena_finish: {}, arena_branch: { OP: branches } };
export function primitiveOperation(block) {
  const fields = block.fields ?? {};
  if (block.type === 'arena_address') return fields.SOURCE === 'load' ? 'load_base' : 'load_minimum';
  if (block.type === 'arena_alignment') return 'load_alignment';
  if (block.type === 'arena_adjust' || block.type === 'arena_math') return fields.OP;
  if (block.type === 'arena_invert') return 'invert64';
  if (block.type === 'arena_compare') return 'compare_minimum';
  return null;
}
