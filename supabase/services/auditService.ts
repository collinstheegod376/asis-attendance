/**
 * ADUN Attendance - Audit Logging Service
 * Records administrative and critical events for non-repudiation and compliance.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';

export class AuditService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Appends an audit event to the immutable audit_logs table
   */
  async log(params: {
    actorId: string | null;
    actorRole: string;
    action: string;
    entity: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { error } = await this.supabase.from('audit_logs').insert({
      actor_id: params.actorId,
      actor_role: params.actorRole,
      action: params.action,
      entity: params.entity,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? {},
    });

    if (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Queries audit logs (Admins only)
   */
  async queryLogs(params: {
    entity?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = this.supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false });

    if (params.entity) {
      query = query.eq('entity', params.entity);
    }

    if (params.action) {
      query = query.eq('action', params.action);
    }

    if (params.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to query audit logs: ${error.message}`);
    }

    return data;
  }
}
