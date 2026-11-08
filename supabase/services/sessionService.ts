/**
 * ADUN Attendance - Lecture Session Service
 * Manages creation of lecture sessions, high-entropy token hashing,
 * session lifecycle (active, expired, closed, revoked), and QR data payloads.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';
import { sha256Hex } from '../functions/_shared/crypto.ts';

export class SessionService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Generates a cryptographically strong 256-bit random raw token
   */
  private generateRawToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Creates a new lecture session for a course
   */
  async createSession(params: {
    courseId: string;
    lecturerId: string;
    title: string;
    startsAt: Date;
    durationMinutes: number;
    graceMinutes?: number;
  }): Promise<{ sessionId: string; rawToken: string; tokenHash: string; expiresAt: string }> {
    // 1. Fetch settings for max duration and grace minutes
    const { data: settings } = await this.supabase
      .from('settings')
      .select('default_session_duration_minutes, max_session_duration_minutes, grace_minutes')
      .eq('id', 1)
      .single();

    const maxDuration = settings?.max_session_duration_minutes || 180;
    const effectiveGrace = params.graceMinutes ?? settings?.grace_minutes ?? 10;

    if (params.durationMinutes > maxDuration) {
      throw new Error(`Requested duration (${params.durationMinutes} min) exceeds system maximum (${maxDuration} min).`);
    }

    if (params.durationMinutes <= 0) {
      throw new Error('Duration must be greater than 0 minutes.');
    }

    // 2. Generate token and hash
    const rawToken = this.generateRawToken();
    const tokenHash = await sha256Hex(rawToken);

    const startsAt = params.startsAt;
    const expiresAt = new Date(startsAt.getTime() + params.durationMinutes * 60 * 1000);

    // 3. Insert lecture session
    const { data, error } = await this.supabase
      .from('lecture_sessions')
      .insert({
        course_id: params.courseId,
        title: params.title.trim(),
        token_hash: tokenHash,
        starts_at: startsAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        grace_minutes: effectiveGrace,
        status: 'active',
        created_by: params.lecturerId,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create lecture session: ${error.message}`);
    }

    return {
      sessionId: data.id,
      rawToken,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Closes or revokes an active session immediately
   */
  async closeSession(sessionId: string, lecturerId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('lecture_sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('created_by', lecturerId);

    if (error) {
      throw new Error(`Failed to close session: ${error.message}`);
    }

    return true;
  }

  /**
   * Revokes a session (invalidates immediately for security reasons)
   */
  async revokeSession(sessionId: string, lecturerId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('lecture_sessions')
      .update({
        status: 'revoked',
        closed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('created_by', lecturerId);

    if (error) {
      throw new Error(`Failed to revoke session: ${error.message}`);
    }

    return true;
  }

  /**
   * Generates QR payload URL for student PWA
   */
  getJoinUrl(pwaHostUrl: string, rawToken: string): string {
    const cleanHost = pwaHostUrl.replace(/\/$/, '');
    return `${cleanHost}/join/${rawToken}`;
  }
}
