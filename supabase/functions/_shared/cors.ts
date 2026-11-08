/**
 * ADUN Attendance - CORS Headers & Response Helpers
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-attempt-token, x-idempotency-key, x-trusted-device-token, x-fingerprint',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin');
  if (origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type, x-attempt-token, x-idempotency-key, x-trusted-device-token, x-fingerprint',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Set-Cookie',
    };
  }
  return {
    ...corsHeaders,
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  return null;
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  req?: Request
): Response {
  const baseHeaders = req ? getCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/json',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  error: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
  req?: Request
): Response {
  return jsonResponse({ success: false, error, message, ...extra }, status, {}, req);
}
