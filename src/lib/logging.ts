type DiagnosticInput = {
  consequence: string;
  moduleProcess: string;
  cause: string;
};

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1[redacted]$2')
    .replace(/([?&](?:password|token|secret|key)=)[^&\s]+/gi, '$1[redacted]');
}

export function diagnosticMessage({ consequence, moduleProcess, cause }: DiagnosticInput): string {
  return sanitizeDiagnostic(`${consequence}: ${moduleProcess} - ${cause}`);
}

export function errorCause(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeDiagnostic(`${error.name}: ${error.message || 'no message'}`);
  }

  if (typeof error === 'string') {
    return sanitizeDiagnostic(error);
  }

  return 'unknown non-error exception';
}

export function logError(input: DiagnosticInput & { error?: unknown }) {
  const cause = input.error ? `${input.cause}; ${errorCause(input.error)}` : input.cause;
  console.error(diagnosticMessage({ ...input, cause }));
}
