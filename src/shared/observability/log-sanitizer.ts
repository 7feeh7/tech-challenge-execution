const SENSITIVE_KEYS =
  /authorization|jwt|senha|password|secret|token|api[_-]?key|cpf|cnpj|email|body|cookie/i;

export function sanitizeString(value: string): string {
  return value.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
}

export function sanitizeObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof val === 'string') {
      out[key] = sanitizeString(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = sanitizeObject(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}
