/**
 * ADUN Attendance System - Error Sanitizer & Reference Code Generator
 * Never leaks raw database structure, SQL syntax, or internal table names to client UI.
 * Fixes: PERF-19 client portion
 */

export function sanitizeErrorMessage(err: unknown, fallbackMessage = 'An unexpected server error occurred.'): string {
  if (!err) return fallbackMessage;

  const rawMessage = typeof err === 'string' ? err : (err as any)?.message || String(err);

  // If already a clean user-facing error message
  const isSafeMessage =
    rawMessage.startsWith('Invalid') ||
    rawMessage.startsWith('Please') ||
    rawMessage.startsWith('Duration') ||
    rawMessage.startsWith('Session') ||
    rawMessage.startsWith('Rate limit') ||
    rawMessage.startsWith('Active course limit') ||
    rawMessage.startsWith('Course') ||
    rawMessage.startsWith('You do not have access');

  if (isSafeMessage && !rawMessage.includes('PGRST') && !rawMessage.includes('violates')) {
    return rawMessage;
  }

  // Detect sensitive database/SQL or server syntax
  const isTechnicalError =
    /relation|syntax error|violates|duplicate key|foreign key|constraint|column|pgrst|jwt|schema|stack|eval/i.test(
      rawMessage
    );

  if (isTechnicalError) {
    const errorRef = `SEC-ERR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    console.error(`[${errorRef}] Internal server detail:`, rawMessage);
    return `An internal database or service error occurred [Reference: ${errorRef}]. Please contact the ICT Administrator if this persists.`;
  }

  return rawMessage || fallbackMessage;
}
