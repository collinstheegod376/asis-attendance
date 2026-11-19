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
      .select('id, session_id, student_id, expires_at, completed_at, step, latitude, longitude')
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

    // Step Guard: Look up lecture session to verify whether location is required
    const { data: sessionData } = await supabase
      .from('lecture_sessions')
      .select('latitude, longitude')
      .eq('id', attempt.session_id)
      .maybeSingle();

    const isLocationRequired = Boolean(sessionData?.latitude != null && sessionData?.longitude != null);

    if (isLocationRequired) {
      if (attempt.latitude == null || attempt.longitude == null || (attempt.step !== 'selfie' && attempt.step !== 'video')) {
        return new Response(JSON.stringify({
          error: 'LOCATION_REQUIRED',
          message: 'Student location must be verified before uploading selfie proof.',
        }), {
          status: 403,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      if (attempt.step !== 'identity' && attempt.step !== 'selfie' && attempt.step !== 'video') {
        return new Response(JSON.stringify({
          error: 'INVALID_STEP',
          message: 'Student identity must be verified before uploading selfie proof.',
        }), {
          status: 403,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }
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

    // Size limit check (max 5 MB, min 1 KB)
    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    const MIN_SIZE = 1024; // 1 KB
    if (imageBytes.length > MAX_SIZE) {
      return new Response(JSON.stringify({
        error: 'FILE_TOO_LARGE',
        message: `Selfie image exceeds maximum allowed size of 5 MB (actual: ${Math.round(imageBytes.length / 1024)} KB).`,
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (imageBytes.length < MIN_SIZE) {
      return new Response(JSON.stringify({
        error: 'FILE_TOO_SMALL',
        message: 'Selfie image payload is too small or corrupt.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Format validation via magic bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47, WebP: RIFF...WEBP)
    let contentType = 'image/jpeg';
    const isJpeg = imageBytes.length >= 3 && imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
    const isPng = imageBytes.length >= 8 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
    const isWebP = imageBytes.length >= 12 &&
      imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x46 &&
      imageBytes[8] === 0x57 && imageBytes[9] === 0x45 && imageBytes[10] === 0x42 && imageBytes[11] === 0x50;

    if (isJpeg) {
      contentType = 'image/jpeg';
    } else if (isPng) {
      contentType = 'image/png';
    } else if (isWebP) {
      contentType = 'image/webp';
    } else {
      return new Response(JSON.stringify({
        error: 'INVALID_IMAGE_FORMAT',
        message: 'Unsupported image format. Allowed formats are JPEG, PNG, or WebP.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Upload to storage bucket ('selfies' primary with fallback to 'attendance')
    let uploadData: any = null;
    let uploadErr: any = null;

    const primaryUpload = await supabase.storage
      .from('selfies')
      .upload(canonicalPath, imageBytes, {
        contentType,
        upsert: false,
      });

    if (primaryUpload.error && primaryUpload.error.message?.toLowerCase().includes('bucket not found')) {
      const fallbackUpload = await supabase.storage
        .from('attendance')
        .upload(canonicalPath, imageBytes, {
          contentType,
          upsert: false,
        });
      uploadData = fallbackUpload.data;
      uploadErr = fallbackUpload.error;
    } else {
      uploadData = primaryUpload.data;
      uploadErr = primaryUpload.error;
    }

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

    // 6. Update attempt step to 'selfie' and persist selfie_path on attempt row
    await supabase
      .from('attendance_attempts')
      .update({
        step: 'selfie',
        selfie_path: canonicalPath,
      })
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
