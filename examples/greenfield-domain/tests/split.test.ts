import { describe, expect, it } from 'vitest';
import { split } from '../src/domain/split.js';
import { splitDecimal } from '../src/app.js';

describe('SPLIT-001: greenfield allocation', () => {
  // Lost units, negative remainders and missing clamping each break a literal case.
  it.each([
    { label: 'zero total and request', total: 0n, requested: 0n, first: 0n, second: 0n },
    { label: 'empty request', total: 10n, requested: 0n, first: 0n, second: 10n },
    { label: 'partial request', total: 10n, requested: 3n, first: 3n, second: 7n },
    { label: 'exact request', total: 10n, requested: 10n, first: 10n, second: 0n },
    { label: 'overlarge request', total: 10n, requested: 11n, first: 10n, second: 0n },
    { label: 'request against zero', total: 0n, requested: 1n, first: 0n, second: 0n },
    { label: 'beyond number precision', total: 9007199254740993n, requested: 9007199254740992n, first: 9007199254740992n, second: 1n },
  ])('T1: $label', ({ total, requested, first, second }) => {
    const shares = split(total, requested);
    expect(shares).toEqual({ first, second });
    expect(shares.first + shares.second).toBe(total);
    expect(shares.first >= 0n && shares.second >= 0n).toBe(true);
  });

  // Number-based conversion, swapped arguments and missing clamping break these outputs.
  it.each([
    { label: 'zero', total: '0', requested: '0', first: '0', second: '0' },
    { label: 'partial request', total: '10', requested: '3', first: '3', second: '7' },
    { label: 'clamping', total: '10', requested: '11', first: '10', second: '0' },
    { label: 'leading zeros', total: '0010', requested: '0003', first: '3', second: '7' },
    { label: 'beyond number precision', total: '9007199254740993', requested: '9007199254740992', first: '9007199254740992', second: '1' },
    { label: 'maximum digit length', total: '9'.repeat(256), requested: '1', first: '1', second: '9'.repeat(255) + '8' },
  ])('T2: decimal facade $label', ({ total, requested, first, second }) => {
    expect(splitDecimal({ total, requested })).toEqual({ ok: true, shares: { first, second } });
  });

  // Missing parsing, coercion or an unbounded BigInt conversion would accept invalid input.
  it.each([
    { label: 'missing object', input: undefined },
    { label: 'null object', input: null },
    { label: 'array', input: ['10', '3'] },
    { label: 'missing total', input: { requested: '3' } },
    { label: 'missing request', input: { total: '10' } },
    { label: 'negative total', input: { total: '-1', requested: '0' } },
    { label: 'negative request', input: { total: '10', requested: '-1' } },
    { label: 'numeric total', input: { total: 10, requested: '3' } },
    { label: 'numeric request', input: { total: '10', requested: 3 } },
    { label: 'bigint total', input: { total: 10n, requested: '3' } },
    { label: 'empty total', input: { total: '', requested: '0' } },
    { label: 'decimal fraction', input: { total: '1.5', requested: '0' } },
    { label: 'exponent', input: { total: '1e3', requested: '0' } },
    { label: 'hexadecimal', input: { total: '0xff', requested: '0' } },
    { label: 'leading plus', input: { total: '+10', requested: '0' } },
    { label: 'whitespace', input: { total: ' 10', requested: '0' } },
    { label: 'trailing newline', input: { total: '10\n', requested: '0' } },
    { label: 'unicode digits', input: { total: '１０', requested: '0' } },
    { label: 'oversized total', input: { total: '9'.repeat(257), requested: '0' } },
    { label: 'oversized request', input: { total: '10', requested: '9'.repeat(257) } },
    { label: 'unexpected field', input: { total: '10', requested: '3', extra: true } },
  ])('T3: reject $label', ({ input }) => {
    expect(splitDecimal(input)).toEqual({ ok: false });
  });
});
