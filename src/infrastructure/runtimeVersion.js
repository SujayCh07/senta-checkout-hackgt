export const MINIMUM_NODE_VERSION = Object.freeze({ major: 24, minor: 4, patch: 0 });

export function assertSupportedNodeVersion(version = process.versions.node) {
  const match = typeof version === 'string' && version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw codedError('unsupported_runtime', 'Could not determine the Node.js runtime version.');
  const actual = match.slice(1).map(Number);
  const minimum = [MINIMUM_NODE_VERSION.major, MINIMUM_NODE_VERSION.minor, MINIMUM_NODE_VERSION.patch];
  const older = actual.some((value, index) => value < minimum[index] && actual.slice(0, index).every((part, prior) => part === minimum[prior]));
  if (older) throw codedError('unsupported_runtime', `Node.js 24.4.0 or newer is required; found ${version}.`);
  return true;
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
