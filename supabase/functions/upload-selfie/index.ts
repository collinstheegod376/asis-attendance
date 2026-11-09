/**
 * Edge Function: upload-selfie (NEW)
 * Fixes: SEC-13, SEC-14, PERF-08
 *
 * Secure server-side selfie proof upload handler for Agent 2 (Student PWA).
 * Validates attempt token, verifies attempt session state, constructs canonical storage path
 * attendance/<session_id>/<student_id>/<attempt_id>.jpg, and uploads to private 'selfies' bucket
 * using service-role with upsert: false.
 * Fails closed if upload fails; NEVER returns a fake path (Verification Item 15).
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex } from '../_shared/crypto.ts';

declare const Deno: any;

function decodeBase64ToUint8Array(base64Str: string): Uint8Array {
  // Strip data URL scheme prefix if present (e.g., data:image/jpeg;base64,)
  const commaIdx = base64Str.indexOf(',');
  const rawBase64 = commaIdx !== -1 ? base64Str.slice(commaIdx + 1) : base64Str;
  const cleanBase64 = rawBase64.replace(/\s+/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const baseHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const imageBase64 = body?.image_base64 || body?.selfie_base64 || body?.image;

    if (!attemptToken || typeof attemptToken !== 'string') {
      return new Response(JSON.stringify({
        error: 'INVALID_ATTEMPT_TOKEN',
        message: 'attempt_token is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return new Response(JSON.stringify({
        error: 'IMAGE_REQUIRED',
        message: 'image_base64 payload is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    // 1. Verify Attempt and validate step & expiration
    const attemptTokenHash = await sha256Hex(attemptToken);
    const { data: attempt, error: attemptErr } = await supabase
      .from('attendance_attempts')
      .select('id, session_id, student_id, expires_at, completed_at, step')
      .eq('attempt_token_hash', attemptTokenHash)
      .maybeSingle();

    if (attemptErr || !attempt) {
      return new Response(JSON.stringify({
        error: 'INVALID_ATTEMPT',
        message: 'Invalid or expired attempt session.',
      }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (new Date().toISOString() >= attempt.expires_at || attempt.completed_at) {
      return new Response(JSON.stringify({
        error: 'ATTEMPT_EXPIRED',
        message: 'This check-in attempt has expired. Please scan QR again.',
      }), {
        status: 410,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!attempt.student_id) {
      return new Response(JSON.stringify({
        error: 'IDENTITY_MISSING',
        message: 'Student identity has not been verified for this attempt.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Compute canonical storage path (attendance/<session_id>/<student_id>/<attempt_id>.jpg)
    const canonicalPath = `attendance/${attempt.session_id}/${attempt.student_id}/${attempt.id}.jpg`;

    // 3. Decode base64 to binary byte array
    let imageBytes: Uint8Array;
    try {
      imageBytes = decodeBase64ToUint8Array(imageBase64);
      if (imageBytes.length === 0) {
        throw new Error('Image byte length is zero');
      }
    } catch {
      return new Response(JSON.stringify({
        error: 'INVALID_IMAGE_DATA',
        message: 'Could not decode image_base64 payload.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Upload to storage bucket 'selfies' with upsert: false using service role
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('selfies')
      .upload(canonicalPath, imageBytes, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    // 5. Fail closed if storage write fails (never return a fabricated path)
    if (uploadErr || !uploadData) {
      console.error('Storage upload failed:', uploadErr);
      return new Response(JSON.stringify({
        error: 'STORAGE_UPLOAD_FAILED',
        message: uploadErr?.message || 'Failed to save selfie proof to secure storage.',
      }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Update attempt step to 'selfie'
    await supabase
      .from('attendance_attempts')
      .update({ step: 'selfie' })
      .eq('id', attempt.id);

    // 7. Return canonical selfie path contract
    return new Response(JSON.stringify({
      selfie_path: canonicalPath,
    }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
