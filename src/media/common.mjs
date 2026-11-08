/** Errors from the offline media layer are safe to surface as user-facing diagnostics. */
export function mediaError(code, message) {
  const error = new Error(message);
  error.name = 'MediaError';
  error.code = code;
  return error;
}

export function requireValue(condition, code, message) {
  if (!condition) throw mediaError(code, message);
}

export function integer(value, min, max, name) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max,
    'INVALID_MEDIA_VALUE', `${name} must be an integer between ${min} and ${max}.`);
  return value;
}

export function finite(value, min, max, name) {
  requireValue(Number.isFinite(value) && value >= min && value <= max,
    'INVALID_MEDIA_VALUE', `${name} must be finite and between ${min} and ${max}.`);
  return value;
}

export function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw mediaError('INVALID_BINARY_INPUT', 'Expected an ArrayBuffer or a binary typed-array view.');
}

export function ascii(bytes, offset, count) {
  return String.fromCharCode(...bytes.subarray(offset, offset + count));
}
