export const MAX_JSON_BODY_BYTES = 32 * 1024;

export async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw codedError('unsupported_media_type', 'Content-Type must be application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw codedError('body_too_large', 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JSON body must be an object.');
    }
    return value;
  } catch {
    throw codedError('invalid_json', 'Request body must be a JSON object.');
  }
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
