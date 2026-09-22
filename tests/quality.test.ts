import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQuality } from '../src/quality.ts';

test('high-end devices keep full pixel ratio and shadow resolution', () => {
  assert.deepEqual(pickQuality({ cores: 8, memoryGB: 8, saveData: false }), { pixelCap: 1.5, shadowMap: 1024, tier: 'high' });
});

test('few cores, little memory or data saver drop to the low tier', () => {
  for (const caps of [
    { cores: 4, memoryGB: 8, saveData: false },
    { cores: 8, memoryGB: 4, saveData: false },
    { cores: 8, memoryGB: 8, saveData: true },
  ]) assert.deepEqual(pickQuality(caps), { pixelCap: 1, shadowMap: 512, tier: 'low' });
});
