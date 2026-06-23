import { diagnosticMessage } from '@/lib/logging';

type ResponseContext = {
  consequence: string;
  moduleProcess: string;
  fallbackCause: string;
};

export async function readJsonResponse(response: Response, context: ResponseContext) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  await response.text().catch(() => '');

  return {
    error: diagnosticMessage({
      consequence: context.consequence,
      moduleProcess: context.moduleProcess,
      cause: `${context.fallbackCause}; server returned ${response.status} ${response.statusText || 'without status text'} as ${contentType || 'unknown content type'}`,
    }),
    code: 'NON_JSON_RESPONSE',
  };
}
