import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { analyzeSources } from '../../tools/quality/policy/index.mjs';

const analyze = (files) => analyzeSources(new Map(Object.entries(files)));
const rules = (files) => analyze(files).map((finding) => finding.rule);
const hasRule = (files, rule) => assert.ok(rules(files).includes(rule), `Expected ${rule}`);

test('pure dependency direction and injected Blockly interface are accepted', () => {
  assert.deepEqual(
    analyze({
      'src/core/machine/math.mjs': 'export const add = (a, b) => a + b;\n',
      'src/core/visual/language.mjs':
        'export function registerVisualExtensions(Blockly) { return Blockly.Extensions.register; }\n',
      'src/service/store/index.mjs':
        "import {readFile} from 'node:fs/promises'; import {add} from '../../core/machine/math.mjs'; export {readFile,add};\n",
      'src/ui/shell/app.mjs':
        "import {add} from '../../core/machine/math.mjs'; document.body.textContent = add(1,2);\n",
      'scripts/run.mjs': "import {readFile} from 'node:fs/promises'; console.log(process.argv, readFile);\n",
    }),
    [],
  );
});

test('core, UI and service imports cannot cross forbidden boundaries', () => {
  const files = {
    'src/core/machine/math.mjs': "import {view} from '../../ui/shell/view.mjs'; export {view};\n",
    'src/ui/shell/view.mjs':
      "import {store} from '../../service/store/index.mjs'; export const view = store;\n",
    'src/service/store/index.mjs': "import '../../ui/shell/view.mjs'; export const store = 1;\n",
  };
  const violations = analyze(files).filter((finding) => finding.rule === 'import-boundary');
  assert.equal(violations.length, 3);
  for (const finding of violations) {
    assert.equal(finding.severity, 'ERROR');
    assert.ok(finding.line > 0 && finding.reason && finding.fix);
  }
});

test('bare Node builtins and browser packages cannot bypass dependency boundaries', () => {
  for (const dependency of ['fs/promises', 'node:fs', 'blockly/core', 'three']) {
    hasRule({ 'src/core/machine/math.mjs': `import '${dependency}';\n` }, 'import-boundary');
  }
  hasRule({ 'src/ui/shell/app.mjs': "import 'node:path';\n" }, 'import-boundary');
  hasRule({ 'src/service/store/index.mjs': "import 'blockly';\n" }, 'import-boundary');
  const opaque = analyze({ 'src/core/machine/math.mjs': "import 'some-package';\n" });
  assert.equal(opaque[0].rule, 'opaque-core-dependency');
  assert.equal(opaque[0].severity, 'REVIEW_REQUIRED');
});

test('reexports, dynamic literal imports and require calls all enter the dependency graph', () => {
  for (const statement of [
    "export * from '../../ui/shell/view.mjs';",
    "export {view} from '../../ui/shell/view.mjs';",
    "const view = import('../../ui/shell/view.mjs');",
    "const view = require('../../ui/shell/view.mjs');",
    "const loader = require; const view = loader('../../ui/shell/view.mjs');",
  ]) {
    hasRule(
      {
        'src/core/machine/math.mjs': `${statement}\n`,
        'src/ui/shell/view.mjs': 'export const view = 1;\n',
      },
      'import-boundary',
    );
  }
});

test('nonliteral imports and unresolved local imports cannot hide dependencies', () => {
  for (const statement of [
    'import(moduleName);',
    "const name = './x.mjs'; import(name);",
    'require(moduleName);',
  ]) {
    hasRule({ 'scripts/loader.mjs': `${statement}\n` }, 'dynamic-import');
  }
  hasRule({ 'src/core/machine/math.mjs': "import './missing.mjs';\n" }, 'import-boundary');
  hasRule({ 'src/core/machine/math.mjs': "import 'file:///outside.mjs';\n" }, 'import-boundary');
});

test('local cycles are rejected even when reexports, import queries and dot segments are involved', () => {
  const findings = analyze({
    'src/core/machine/a.mjs': "export * from './inner/../b.mjs?version=1';\n",
    'src/core/machine/b.mjs': "export * from './c.mjs';\n",
    'src/core/machine/c.mjs': "export * from './a.mjs';\n",
  });
  const cycle = findings.find((finding) => finding.rule === 'import-cycle');
  assert.ok(cycle);
  assert.match(cycle.reason, /a\.mjs.*b\.mjs.*c\.mjs.*a\.mjs/);
  hasRule({ 'src/core/machine/a.mjs': "import './a.mjs';\n" }, 'import-cycle');
});

test('generic modules cannot reach Linux bindings through a facade', () => {
  for (const module of ['machine/isa', 'visual/language']) {
    hasRule(
      {
        [`src/core/${module}.mjs`]: "import '../facade.mjs';\n",
        'src/core/facade.mjs': "export * from './placement/index.mjs';\n",
        'src/core/placement/index.mjs': 'export const adapter = {};\n',
      },
      'generic-boundary',
    );
  }
  hasRule(
    {
      'src/core/machine/grammar.mjs': "import '../placement/index.mjs';\n",
      'src/core/placement/index.mjs': 'export const model = {};\n',
    },
    'generic-boundary',
  );
});

test('nested machine, visual, placement, browser and service directories keep their intended boundaries', () => {
  assert.deepEqual(
    analyze({
      'src/core/machine/isa.mjs': 'export const add = (a,b) => a+b;\n',
      'src/core/visual/compiler.mjs': "import {add} from '../machine/isa.mjs'; export {add};\n",
      'src/core/placement/index.mjs': "export * from '../visual/compiler.mjs';\n",
      'src/ui/editor/index.mjs': "export * from '../../core/placement/index.mjs';\n",
      'src/service/store/index.mjs': "export * from '../../core/placement/index.mjs';\n",
    }),
    [],
  );
  hasRule(
    {
      'src/core/visual/compiler.mjs': "export * from '../machine/bridge.mjs';\n",
      'src/core/machine/bridge.mjs': "export * from '../placement/symbols.mjs';\n",
      'src/core/placement/symbols.mjs': 'export const binding = 1;\n',
    },
    'generic-boundary',
  );
  hasRule(
    {
      'src/ui/editor/index.mjs': "export * from '../../service/store/index.mjs';\n",
      'src/service/store/index.mjs': 'export const store = 1;\n',
    },
    'import-boundary',
  );
});

test('component dependency directions reject reverse and lateral ownership leaks', () => {
  for (const [from, to] of [
    ['core/machine', 'core/visual'],
    ['core/visual', 'core/placement'],
    ['ui/shared', 'ui/shell'],
    ['ui/editor', 'ui/contract'],
    ['ui/contract', 'ui/scene'],
    ['ui/scene', 'ui/editor'],
    ['service/native', 'service/store'],
    ['service/native', 'core/machine'],
    ['service/store', 'service/http'],
    ['service/http', 'service/native'],
    ['service/mcp', 'service/http'],
  ]) {
    const source = `src/${from}/index.mjs`,
      target = `src/${to}/index.mjs`;
    const dependency = posix.relative(posix.dirname(source), target);
    hasRule(
      { [source]: `export * from '${dependency}';\n`, [target]: 'export const value=1;\n' },
      'component-boundary',
    );
  }
});

test('component dependency directions accept the actual outward application wiring', () => {
  for (const [from, to] of [
    ['core/machine', 'core/machine'],
    ['core/visual', 'core/machine'],
    ['core/placement', 'core/visual'],
    ['ui/shared', 'core/placement'],
    ['ui/editor', 'ui/shared'],
    ['ui/contract', 'ui/shared'],
    ['ui/scene', 'ui/shared'],
    ['ui/shell', 'ui/editor'],
    ['ui/shell', 'ui/contract'],
    ['ui/shell', 'ui/scene'],
    ['service/store', 'service/native'],
    ['service/store', 'core/placement'],
    ['service/http', 'service/store'],
    ['service/http', 'core/placement'],
    ['service/mcp', 'service/mcp'],
  ]) {
    const source = `src/${from}/index.mjs`,
      target = `src/${to}/dependency.mjs`;
    const relative = posix.relative(posix.dirname(source), target);
    const dependency = relative.startsWith('.') ? relative : `./${relative}`;
    assert.deepEqual(
      analyze({ [source]: `export * from '${dependency}';\n`, [target]: 'export const value=1;\n' }),
      [],
    );
  }
});

test('new source owners require policy and service packages stay within the Node/SDK boundary', () => {
  for (const path of [
    'src/core/new-owner/math.mjs',
    'src/ui/new-owner/view.mjs',
    'src/service/new-owner/store.mjs',
    'src/app.mjs',
  ])
    hasRule({ [path]: 'export const value=1;\n' }, 'component-unknown');
  assert.deepEqual(
    analyze({
      'src/service/native/runner.mjs': "import 'node:child_process';\n",
      'src/service/mcp/server.mjs': "import '@modelcontextprotocol/sdk/server/index.js';\n",
    }),
    [],
  );
  for (const owner of ['native', 'store', 'http', 'mcp'])
    hasRule({ [`src/service/${owner}/index.mjs`]: "import 'axios';\n" }, 'component-package');
});

test('process execution belongs only to native service and no service may acquire module-loader or VM authority', () => {
  for (const owner of ['store', 'http', 'mcp']) {
    for (const code of [
      "import 'node:child_process';",
      "require('child_process');",
      "import('node:child_process');",
    ])
      hasRule({ [`src/service/${owner}/index.mjs`]: `${code}\n` }, 'component-capability');
  }
  for (const owner of ['native', 'store', 'http', 'mcp']) {
    for (const name of ['module', 'vm'])
      hasRule({ [`src/service/${owner}/index.mjs`]: `import 'node:${name}';\n` }, 'component-capability');
  }
  assert.deepEqual(
    analyze({
      'src/service/native/runner.mjs': "import 'node:child_process';\n",
      'src/service/http/server.mjs': "import 'node:path';\n",
    }),
    [],
  );
});

test('host access is checked as scoped AST references rather than name substrings', () => {
  assert.deepEqual(
    analyze({
      'src/core/machine/math.mjs':
        `
    export function compute(document, process) {
      const object = {document: 1, process: 2};
      return document.value + process.value + object.document;
    }
    export function other({window: local}) { return local; }
  `.trim() + '\n',
    }),
    [],
  );
  for (const expression of [
    'document.body',
    'process.env',
    'globalThis.document',
    "globalThis['doc' + 'ument']",
    'const g = globalThis; g.document',
    'const {document: doc} = globalThis; doc.body',
    'fetch("/data")',
  ])
    hasRule({ 'src/core/machine/math.mjs': `${expression};\n` }, 'core-host-access');
  hasRule({ 'src/ui/shell/view.mjs': 'process.env;\n' }, 'ui-node-access');
  hasRule({ 'src/service/store/index.mjs': 'document.body;\n' }, 'service-dom-access');
  hasRule({ 'src/core/machine/math.mjs': 'globalThis[key];\n' }, 'dynamic-global-access');
});

test('eval, Function aliases and computed constructor escapes fail the gate', () => {
  for (const source of [
    'eval(code);',
    'new Function(code);',
    'const execute = eval; execute(code);',
    "globalThis['Fun' + 'ction'](code);",
    '(0, eval)(code);',
    '(() => {}).constructor(code)();',
    '({}).constructor.constructor(code)();',
    'const {Function: Construct} = globalThis; Construct(code);',
  ])
    hasRule({ 'scripts/run.mjs': `${source}\n` }, 'dynamic-code');
  assert.deepEqual(
    analyze({ 'src/core/machine/math.mjs': 'export function compute(Function) { return Function(1); }\n' }),
    [],
  );
});

test('text checks preserve vendor references and report precise lines elsewhere', () => {
  const findings = analyze({
    'reference/linux/original.S': '<<<<<<< ours\nline  \n=======\n>>>>>>> theirs\n',
    'README.md': '# Title\ntext \n',
    'src/theme.css': 'a {}\n<<<<<<< ours\n=======\n>>>>>>> theirs\n',
  });
  assert.equal(
    findings.some((finding) => finding.file.startsWith('reference/')),
    false,
  );
  assert.equal(findings.find((finding) => finding.rule === 'trailing-whitespace').line, 2);
  assert.equal(findings.filter((finding) => finding.rule === 'conflict-marker').length, 3);
});

test('unfinished markers inspect comments, not fixture strings or documentation', () => {
  const findings = analyze({
    'src/core/machine/math.mjs': 'export const text = "TODO and FIXME";\n// TODO implement this\n',
    'tests/check.test.mjs': 'const fixture = "// HACK placeholder";\n',
    'tests/fixtures/source.mjs': '// TODO example text\nexport const value = 1;\n',
    'README.md': 'TODO: explain the next milestone.\n',
  });
  assert.deepEqual(
    findings.map(({ file, line, rule }) => ({ file, line, rule })),
    [{ file: 'src/core/machine/math.mjs', line: 2, rule: 'unfinished-comment' }],
  );
});

test('inline static and coverage suppressions are rejected even when a reason is supplied', () => {
  for (const comment of [
    'eslint-disable-next-line no-eval -- intentional',
    '@ts-ignore -- reason',
    'c8 ignore next',
    'istanbul ignore file',
  ]) {
    hasRule({ 'scripts/run.mjs': `// ${comment}\nconst value = 1;\n` }, 'inline-suppression');
  }
});

test('test modifiers and literal exclusion options are hard failures, including aliases', () => {
  for (const source of [
    "import test from 'node:test'; test.skip('case', () => {});",
    "import {describe as group} from 'node:test'; group.skip('group', () => {});",
    "import {test as check} from 'node:test'; check['to'+'do']('case');",
    "import test from 'node:test'; test.only('case', () => {});",
    "import test from 'node:test'; test('case', {skip:true}, () => {});",
    "import test from 'node:test'; const disabled=true; test('case', {skip:disabled}, () => {});",
  ])
    hasRule({ 'tests/check.test.mjs': `${source}\n` }, 'test-disabled');
});

test('conditional skip must be provably false in the full native gate', () => {
  const good = `import test from 'node:test';
    const required = process.env.REQUIRE_NATIVE_ENGINE === '1';
    const nativeOptions = {skip: !required && !existsSync(executable)};
    test('case', nativeOptions, () => {});
  `;
  assert.deepEqual(analyze({ 'tests/check.test.mjs': good.trim() + '\n' }), []);
  hasRule(
    { 'tests/check.test.mjs': 'const options = {skip: !existsSync(executable)};\n' },
    'conditional-test-skip',
  );
  hasRule(
    { 'tests/check.test.mjs': "const options = {skip: process.env.REQUIRE_NATIVE_ENGINE === '1'};\n" },
    'test-disabled',
  );
  assert.deepEqual(analyze({ 'tests/check.test.mjs': 'const options = {skip: false, todo: false};\n' }), []);
});

test('syntax errors cannot produce an empty successful finding list', () => {
  const findings = analyze({ 'src/core/machine/math.mjs': 'export const = ;\n' });
  assert.equal(findings[0].rule, 'syntax-error');
  assert.equal(findings[0].severity, 'ERROR');
});

test('large functions require review with explicit thresholds and measured complexity', () => {
  const branches = Array.from({ length: 21 }, (_, index) => `if (x === ${index}) return ${index};`).join(
    '\n',
  );
  const findings = analyze({
    'src/core/machine/math.mjs': `export function compute(x) {\n${branches}\nreturn -1;\n}\n`,
  });
  const complexity = findings.find((finding) => finding.rule === 'function-complexity');
  assert.equal(complexity.severity, 'REVIEW_REQUIRED');
  assert.match(complexity.reason, /cyclomatic=22/);
  assert.match(complexity.reason, /thresholds are 20, 5 and 80/);
});

test('nested function decisions are not incorrectly added to the parent complexity', () => {
  const functions = Array.from(
    { length: 22 },
    (_, index) => `function f${index}(x) { if (x) return 1; return 0; }`,
  ).join('\n');
  assert.equal(
    rules({
      'src/core/machine/math.mjs': `export function compute() {\n${functions}\nreturn 1;\n}\n`,
    }).includes('function-complexity'),
    false,
  );
});

test('substantial identical AST bodies require review while formatting does not conceal them', () => {
  const statements = Array.from({ length: 16 }, (_, index) => `value = value + ${index};`).join('\n');
  const findings = analyze({
    'src/core/machine/a.mjs': `export function first(value) {\n${statements}\nreturn value;\n}\n`,
    'src/core/machine/b.mjs': `export function second(value) { ${statements.replaceAll('\n', ' ')} return value; }\n`,
  });
  const duplicate = findings.find((finding) => finding.rule === 'duplicate-function-body');
  assert.equal(duplicate.severity, 'REVIEW_REQUIRED');
  assert.match(duplicate.reason, /a\.mjs:1/);
});

test('analyzer is deterministic, normalizes separators, and leaves source inputs intact', () => {
  const files = new Map([['src\\core\\machine\\math.mjs', 'document.body;\n']]);
  const before = [...files];
  assert.deepEqual(analyzeSources(files), analyzeSources(files));
  assert.deepEqual([...files], before);
  assert.equal(analyzeSources(files)[0].file, 'src/core/machine/math.mjs');
  assert.throws(() => analyzeSources({}), TypeError);
});

test('recursive computed keys and mixed BigInt expressions do not crash static analysis', () => {
  hasRule({ 'src/core/machine/math.mjs': 'const key = globalThis[key];\n' }, 'dynamic-global-access');
  hasRule({ 'tests/check.test.mjs': 'const options = {skip: 1n + 1};\n' }, 'conditional-test-skip');
});

test('constructor extraction, repeated global aliases and test aliases do not bypass policy', () => {
  hasRule(
    { 'scripts/run.mjs': 'const construct = (() => {}).constructor; construct(code);\n' },
    'dynamic-code',
  );
  hasRule({ 'src/core/machine/math.mjs': 'globalThis.globalThis.document;\n' }, 'core-host-access');
  hasRule(
    {
      'tests/check.test.mjs':
        "import test from 'node:test'; const check = test; check.skip('case',()=>{});\n",
    },
    'test-disabled',
  );
});

test('tests cannot replace the native gate environment flag', () => {
  for (const source of [
    "process.env.REQUIRE_NATIVE_ENGINE='0';",
    'delete process.env.REQUIRE_NATIVE_ENGINE;',
    "const env=process.env; env['REQUIRE_NATIVE_ENGINE']='0';",
    'process.env={};',
  ])
    hasRule({ 'tests/check.test.mjs': `${source}\n` }, 'test-disabled');
  assert.deepEqual(
    analyze({ 'tests/check.test.mjs': 'const options = {skip: !process.env.REQUIRE_NATIVE_ENGINE};\n' }),
    [],
  );
});

test('input paths cannot escape or alias the repository-relative inventory', () => {
  for (const path of [
    '../src/core/machine/math.mjs',
    '/src/core/machine/math.mjs',
    'D:\\src\\core\\machine\\math.mjs',
  ])
    assert.throws(() => analyzeSources(new Map([[path, 'document.body;\n']])), TypeError);
  assert.throws(
    () =>
      analyzeSources(
        new Map([
          ['./a.mjs', ''],
          ['a.mjs', ''],
        ]),
      ),
    TypeError,
  );
  assert.throws(() => analyzeSources(new Map([['a.mjs', null]])), TypeError);
});

test('assigning an exclusion after object construction remains detectable', () => {
  hasRule({ 'tests/check.test.mjs': 'const options={skip:false}; options.skip=true;\n' }, 'test-disabled');
  hasRule(
    { 'tests/check.test.mjs': 'const options={skip:false}; options["skip"]=excluded;\n' },
    'conditional-test-skip',
  );
});
