import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupportedNodeVersion, MINIMUM_NODE_VERSION } from '../src/infrastructure/runtimeVersion.js';

test('runtime version gate accepts Node 24.4 and future majors', () => {
  assert.equal(assertSupportedNodeVersion('24.4.0'), true);
  assert.equal(assertSupportedNodeVersion('24.4.1'), true);
  assert.equal(assertSupportedNodeVersion('26.0.0'), true);
  assert.deepEqual(MINIMUM_NODE_VERSION, { major: 24, minor: 4, patch: 0 });
});

test('runtime version gate rejects versions that cannot satisfy the SQLite API contract', () => {
  for (const version of ['20.0.0', '24.3.99', '23.99.99', 'unknown']) {
    assert.throws(() => assertSupportedNodeVersion(version), { code: 'unsupported_runtime' });
  }
});
