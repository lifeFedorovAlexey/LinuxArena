import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_ASM,
  CONTRACT,
  parseAssembly,
  serializeAssembly,
  executeProgram,
  referenceResult,
  inferProgramEffects,
  buildControlFlow,
} from '../../../src/core/placement/index.mjs';
import { ISA_REGISTERS } from '../../../src/core/machine/isa.mjs';

const run = (source, inputs) => executeProgram(parseAssembly(source), inputs);
const lastFlags = (result) => result.trace.at(-1).flags;

test('generic instructions retain validated operands and canonical real AT&T assembly', () => {
  const source =
    'movabsq $18446744073709551615, %r8\nmovq %r8, %r15\nmovl $0x2, %ebp\naddl %ebp, %r15d\nmovq %r15, %rbp';
  const model = parseAssembly(source);
  assert.ok(model.instructions.every((item) => item.op === 'generic'));
  assert.deepEqual(model.instructions[0].operands, [
    { kind: 'immediate', value: '18446744073709551615' },
    { kind: 'register', name: 'r8' },
  ]);
  assert.deepEqual(model.instructions[3].operands, [
    { kind: 'register', name: 'rbp' },
    { kind: 'register', name: 'r15' },
  ]);
  assert.equal(model.instructions[3].width, 32);
  const assembly = serializeAssembly(model);
  assert.match(assembly, /movq \$18446744073709551615, %r8/);
  assert.equal(serializeAssembly(parseAssembly(assembly)), assembly);
  assert.equal(run(assembly).output, '0x1');
  assert.equal(buildControlFlow(model).nodes.find((item) => item.op === 'generic').mnemonic, 'mov');
});

test('all supported full and 32-bit register aliases execute with zero-extension', () => {
  for (const name of ISA_REGISTERS) {
    const alias = name === 'rax' ? 'eax' : name === 'rbp' ? 'ebp' : `${name}d`;
    const result = run(
      `movq $0xffffffffffffffff, %${name}\nmovl $0x80000000, %${alias}\nmovq %${name}, %rbp`,
    );
    assert.equal(result.output, '0x80000000');
    assert.equal(result.registers[name], '0x80000000');
  }
});

test('32-bit add and subtract wrap with carry/borrow and zero flags', () => {
  const sum = run('movl $0xffffffff, %r8d\naddl $1, %r8d\nmovq %r8, %rbp');
  assert.equal(sum.output, '0x0');
  assert.deepEqual(lastFlags(sum), { carry: true, zero: true });
  const difference = run('movl $0, %r9d\nsubl $1, %r9d\nmovq %r9, %rbp');
  assert.equal(difference.output, '0xffffffff');
  assert.deepEqual(lastFlags(difference), { carry: true, zero: false });
});

test('64-bit arithmetic handles full-width register constants and exact unsigned boundaries', () => {
  const sum = run('movq $0xffffffffffffffff, %r8\nmovq $1, %r9\naddq %r9, %r8\nmovq %r8, %rbp');
  assert.equal(sum.output, '0x0');
  assert.deepEqual(lastFlags(sum), { carry: true, zero: true });
  const difference = run('movq $0, %r8\nsubq $0xffffffffffffffff, %r8\nmovq %r8, %rbp');
  assert.equal(difference.output, '0x1');
  assert.deepEqual(lastFlags(difference), { carry: true, zero: false });
  const self = run('movq $0x8000000000000000, %r8\naddq %r8, %r8\nmovq %r8, %rbp');
  assert.equal(self.output, '0x0');
  assert.deepEqual(lastFlags(self), { carry: true, zero: true });
});

test('NOT and MOV preserve flags while INC/DEC preserve carry and update zero', () => {
  const result = run('movq $0, %r8\nsubq $1, %r8\nincl %r8d\ndecl %r8d\nnotl %r8d\nmovq %r8, %rbp');
  const inc = result.trace.find((item) => item.assembly === 'incl %r8d');
  const dec = result.trace.find((item) => item.assembly === 'decl %r8d');
  const not = result.trace.find((item) => item.assembly === 'notl %r8d');
  assert.deepEqual(inc.flags, { carry: true, zero: true });
  assert.equal(inc.registers.r8, '0x0');
  assert.deepEqual(dec.flags, { carry: true, zero: false });
  assert.equal(dec.registers.r8, '0xffffffff');
  assert.deepEqual(not.flags, dec.flags);
  assert.equal(not.registers.r8, '0x0');
  assert.deepEqual(lastFlags(result), dec.flags);
});

test('bitwise operations clear carry and set zero from the result at their declared width', () => {
  for (const [op, initial, operand, expected, zero] of [
    ['andl', '0xffffffffffffffff', '0x80000000', '0x80000000', false],
    ['orl', '0xffffffff00000000', '0x80', '0x80', false],
    ['xorl', '0x8000000080000000', '0x80000000', '0x0', true],
    ['andq', '0xffffffffffffffff', '0xffffffff80000000', '0xffffffff80000000', false],
    ['orq', '0x0', '0x7fffffff', '0x7fffffff', false],
    ['xorq', '0xffffffffffffffff', '0xffffffffffffffff', '0x0', true],
  ]) {
    const alias = op.endsWith('l') ? 'r8d' : 'r8';
    const result = run(
      `movq $0, %r9\nsubq $1, %r9\nmovq $${initial}, %r8\n${op} $${operand}, %${alias}\nmovq %r8, %rbp`,
    );
    assert.equal(result.output, expected);
    assert.deepEqual(lastFlags(result), { carry: false, zero });
  }
});

test('arbitrary-register CMP preserves operands and controls the real forward branch', () => {
  for (const [left, right, expected, flags] of [
    ['0', '18446744073709551615', '0x0', { carry: true, zero: false }],
    ['18446744073709551615', '0', '0x1', { carry: false, zero: false }],
    ['0x8000000000000000', '0x8000000000000000', '0x1', { carry: false, zero: true }],
  ]) {
    const result = run(
      `movq $${left}, %r8\nmovq $${right}, %r9\ncmpq %r9, %r8\njae 3f\nmovq $0, %rbp\njmp 4f\n3:\nmovq $1, %rbp\n4:`,
    );
    const comparison = result.trace.find((item) => item.assembly === 'cmpq %r9, %r8');
    assert.deepEqual(comparison.flags, flags);
    assert.deepEqual(comparison.registers, comparison.before);
    assert.equal(result.output, expected);
  }
});

test('nested expressions using Linux input bindings execute the reference address algorithm', () => {
  const source = `#ifdef CONFIG_RELOCATABLE
leaq startup_32(%rip), %r8
movl BP_kernel_alignment(%rsi), %r9d
decl %r9d
movq %r9, %r10
notq %r10
addq %r9, %r8
andq %r10, %r8
cmpq $LOAD_PHYSICAL_ADDR, %r8
jae 2f
movq $LOAD_PHYSICAL_ADDR, %r8
2:
movq %r8, %rbp
#else
movq $LOAD_PHYSICAL_ADDR, %rbp
#endif`;
  for (const relocatable of [false, true]) {
    for (const loadAddress of ['0x0', '0x1380000', '0x8000000000000000', '0xffffffffffffffff']) {
      const inputs = { relocatable, loadAddress };
      assert.equal(run(source, inputs).output, referenceResult(inputs));
    }
  }
  const fixed = run(source, { relocatable: false });
  assert.deepEqual(fixed.clobbers, ['rbp']);
  assert.deepEqual(fixed.inferredEffects.extraClobbers, ['r8', 'r9', 'r10']);
  assert.equal(fixed.inferredEffects.kernelAbiVerified, false);
  assert.equal(fixed.inferredEffects.kernelPatchEligible, false);
  assert.deepEqual(inferProgramEffects(parseAssembly(source)), fixed.inferredEffects);
  assert.ok(
    CONTRACT.effects.every((effect) => !/r8|r9|r10/.test(effect)),
    'candidate scratch does not silently expand the reference ABI',
  );
});

test('unknown registers, arbitrary memory, invalid widths and non-encodable immediates are rejected', () => {
  for (const source of [
    'movq %rsp, %r8',
    'movq %rdi, %r8',
    'movq %r16, %r8',
    'movq %r8d, %r9',
    'movl %r8, %r9d',
    'movabsq %rax, %rbp',
    'movabsq BP_kernel_alignment(%rsi), %r8',
    'movq (%r8), %r9',
    'movq $1, (%r8)',
    'movq secret(%rip), %r8',
    'leaq (%r8), %r9',
    'movq BP_kernel_alignment(%rsi), %r8',
    'leal startup_32(%rip), %r8d',
    'movq $18446744073709551616, %r8',
    'movq $1e6, %r8',
    'movq $-1, %r8',
    'movq $010, %r8',
    'movq $0008, %r8',
    'movl $0x100000000, %r8d',
    'addq $0x80000000, %r8',
    'subq $0xffffffff, %r8',
    'cmpq $0x100000000, %r8',
    'addq $0xffffffff7fffffff, %r8',
    'movq $1, $2',
    'notq %r8, %r9',
  ])
    assert.throws(() => parseAssembly(source), undefined, source);
  assert.throws(() =>
    serializeAssembly({
      version: 1,
      instructions: [
        {
          op: 'generic',
          mnemonic: 'mov',
          width: 64,
          operands: [
            { kind: 'immediate', value: 1 },
            { kind: 'register', name: 'r8' },
          ],
        },
      ],
    }),
  );
});

test('reading scratch or destination before assignment fails instead of inventing a value', () => {
  for (const source of ['movq %r8, %rbp', 'addq $1, %r9', 'xorl %r10d, %r10d', 'cmpq $0, %rbp']) {
    assert.throws(() => run(source), /до присвоения/);
  }
  assert.throws(
    () =>
      run('movq $0, %r8\ncmpq $LOAD_PHYSICAL_ADDR, %r8\nmovq %r8, %rbp', { minimumAddress: '0x80000000' }),
    /imm32/,
  );
});

test('legacy reference operations retain their exact identities and source bindings', () => {
  const model = parseAssembly(REFERENCE_ASM);
  assert.deepEqual(
    model.instructions.map((item) => item.op),
    [
      'config_begin',
      'load_base',
      'load_alignment',
      'decrement32',
      'add64',
      'invert64',
      'and64',
      'compare_minimum',
      'branch_ge',
      'config_end',
      'load_minimum',
      'label',
    ],
  );
  assert.deepEqual(inferProgramEffects(model).extraClobbers, []);
  assert.equal(run(REFERENCE_ASM).output, referenceResult());
  assert.equal(serializeAssembly(parseAssembly(serializeAssembly(model))), serializeAssembly(model));
});
