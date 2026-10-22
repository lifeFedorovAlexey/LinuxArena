import { checkCandidate } from './candidate-check.mjs';
import { nativeRunner } from '../native/runner.mjs';
import { DEFAULT_INPUTS } from './defaults.mjs';
import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  REFERENCE_ASM,
  CONTRACT,
  BOOT_LAYERS,
  MAX_ASSEMBLY_LENGTH,
  parseAssembly,
  serializeAssembly,
  executeProgram,
  referenceResult,
} from '../../core/placement/index.mjs';

const SCHEMA_VERSION = 1;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const clone = (value) => structuredClone(value);

export class ArenaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validInputs(input, previous = DEFAULT_INPUTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ArenaError('Параметры должны быть объектом.');
  }
  const result = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_INPUTS, key)) throw new ArenaError(`Неизвестный параметр: ${key}`);
    if (key === 'relocatable') {
      if (typeof value !== 'boolean') throw new ArenaError('relocatable должен быть boolean.');
      result[key] = value;
    } else {
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
        throw new ArenaError(`${key}: ожидается целое число или строка с адресом.`);
      }
      if (typeof value === 'string' && value.length > 32)
        throw new ArenaError(`${key}: слишком длинное значение.`);
      result[key] = String(value);
    }
  }
  // The interpreter is also the authoritative width/range validator.
  referenceResult(result);
  return result;
}

export async function createArenaStore({
  root,
  statePath = join(root, '.arena', 'state.json'),
  runNative = (command) => nativeRunner(root, command),
}) {
  const listeners = new Set();
  let queue = Promise.resolve();
  let state;
  const referenceAssembly = serializeAssembly(parseAssembly(REFERENCE_ASM));
  const makeState = (assembly, inputs, revision = 0) => {
    const model = parseAssembly(assembly);
    const canonical = serializeAssembly(model);
    return {
      schemaVersion: SCHEMA_VERSION,
      revision,
      program: {
        assembly: canonical,
        model,
        hash: hash(canonical),
        isReference: canonical === referenceAssembly,
      },
      inputs,
      evaluation: executeProgram(model, inputs),
      checks: { status: 'not-run', candidate: null, native: null, checkedAt: null },
      benchmark: null,
      updatedAt: new Date().toISOString(),
    };
  };
  try {
    const stored = JSON.parse(await readFile(statePath, 'utf8'));
    if (stored.schemaVersion !== SCHEMA_VERSION) {
      await copyFile(statePath, `${statePath}.v${stored.schemaVersion ?? 'unknown'}.${Date.now()}.backup`);
      state = makeState(referenceAssembly, { ...DEFAULT_INPUTS });
    } else {
      state = makeState(stored.program.assembly, validInputs(stored.inputs), stored.revision ?? 0);
      // Results belong to the previous process/toolchain/hardware session.
      // Until persisted results carry executable and environment fingerprints,
      // restore the candidate only; never present an old check or timing as current.
      state.updatedAt = stored.updatedAt ?? state.updatedAt;
    }
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(`Не удалось восстановить ${statePath}: ${error.message}`, { cause: error });
    state = makeState(referenceAssembly, { ...DEFAULT_INPUTS });
  }
  const persist = async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, statePath);
    for (const listener of listeners) listener(clone(state));
  };
  const mutate = (operation) => {
    const pending = queue.then(async () => {
      const before = state;
      try {
        state = await operation(clone(state));
        state.revision++;
        state.updatedAt = new Date().toISOString();
        await persist();
        return clone(state);
      } catch (error) {
        state = before;
        throw error;
      }
    });
    queue = pending.catch(() => {});
    return pending;
  };
  return {
    snapshot: () => clone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async reference() {
      return JSON.parse(await readFile(join(root, 'reference', 'manifest.json'), 'utf8'));
    },
    async block() {
      return {
        id: CONTRACT.id,
        referenceAssembly,
        contract: CONTRACT,
        layers: BOOT_LAYERS,
        manifest: await this.reference(),
      };
    },
    setProgram(assembly) {
      if (typeof assembly !== 'string' || assembly.length > MAX_ASSEMBLY_LENGTH)
        throw new ArenaError(`Ожидается ASM-фрагмент длиной до ${MAX_ASSEMBLY_LENGTH} символов.`);
      return mutate((current) => {
        const next = makeState(assembly, current.inputs, current.revision);
        // Native measurements describe the fixed Rust implementation, never the edited interpreter candidate.
        next.benchmark = current.benchmark;
        return next;
      });
    },
    setInputs(input) {
      return mutate((current) => {
        current.inputs = validInputs(input, current.inputs);
        current.evaluation = executeProgram(current.program.model, current.inputs);
        current.checks = { status: 'not-run', candidate: null, native: null, checkedAt: null };
        return current;
      });
    },
    check() {
      return mutate(async (current) => {
        const candidate = checkCandidate(current.program.assembly, current.inputs);
        const native = await runNative('check');
        current.checks = {
          status:
            candidate.status === 'failed' || native.status === 'failed'
              ? 'failed'
              : native.status === 'passed'
                ? 'passed'
                : 'partial',
          candidate,
          native,
          checkedAt: new Date().toISOString(),
        };
        return current;
      });
    },
    benchmark() {
      return mutate(async (current) => {
        current.benchmark = {
          ...(await runNative('bench')),
          appliesTo: 'fixed-rust-port',
          candidateProgramHash: null,
          measuredAt: new Date().toISOString(),
        };
        return current;
      });
    },
  };
}
