// SPDX-License-Identifier: GPL-2.0-only
import * as visual from '../visual/index.mjs';
import * as migration from './history/migration.mjs';
import { PLACEMENT_ADAPTER } from './adapter.mjs';
export { VISUAL_BLOCK_TYPES } from '../visual/index.mjs';
export const compileWorkspace = (value, adapter = PLACEMENT_ADAPTER) =>
  visual.compileWorkspace(value, adapter);
export const workspaceToAssembly = (value, adapter = PLACEMENT_ADAPTER) =>
  visual.workspaceToAssembly(value, adapter);
export const workspaceInstructionMap = (value, adapter = PLACEMENT_ADAPTER) =>
  visual.workspaceInstructionMap(value, adapter);
export const modelToWorkspace = (value, adapter = PLACEMENT_ADAPTER) =>
  visual.modelToWorkspace(value, adapter);
export const migrateConfigPredicates = (value, adapter = PLACEMENT_ADAPTER) =>
  migration.migrateConfigPredicates(value, adapter);
export const migrateExpressionWorkspace = (value, adapter = PLACEMENT_ADAPTER) =>
  migration.migrateExpressionWorkspace(value, adapter);
export const migrateLegacyWorkspace = (value, adapter = PLACEMENT_ADAPTER) =>
  migration.migrateLegacyWorkspace(value, adapter);
export const validateWorkspaceDraft = (value, adapter = PLACEMENT_ADAPTER) =>
  visual.validateWorkspaceDraft(value, adapter);
