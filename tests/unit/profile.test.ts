import { describe, expect, it } from 'vitest';
import { inspectProfile } from '../../src/verification/profile.js';

describe('SPEC-001: admitted source profile excludes unvalidated runtime properties', () => {
  it('does not admit global function metadata as pure scalar logic', () => {
    const source = 'export function check(): boolean { return parseInt.name === "parseInt"; }';
    expect(inspectProfile(source, '/source.ts', 'check').reasons.length).toBeGreaterThan(0);
  });
});
