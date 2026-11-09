/**
 * ADUN Attendance System - Real Supabase Authentication Service
 * Fixes: SEC-16, QA-03, QA-21
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User, UserRole } from '../types';
import { sanitizeErrorMessage } from '../lib/errorHandler';

export interface AuthLoginResult {
  success: boolean;
  user?: User;
  role?: UserRole;
  mustChangePassword?: boolean;
  error?: string;
}

export class AuthService {
  /**
   * Resolves username or email to an authenticated Supabase session.
   * If input does not contain '@', normalizes to official institutional email username@adun.edu.ng.
   */
  static async login(usernameOrEmail: string, password: string): Promise<AuthLoginResult> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        success: false,
        error: 'Backend authentication server is not configured. Please check environment variables.',
      };
    }

    const cleanInput = usernameOrEmail.trim().toLowerCase();
    const email = cleanInput.includes('@') ? cleanInput : `${cleanInput}@adun.edu.ng`;

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !authData.user) {
        return {
          success: false,
          error: 'Invalid username/email or password.',
        };
      }

      const authUser = authData.user;

      // Query public.users profile by auth_id, user id, or email
      let { data: profile, error: profileErr } = await supabase
        .from('users')
        .select('*')
        .or(`auth_id.eq.${authUser.id},id.eq.${authUser.id},email.eq.${authUser.email}`)
        .maybeSingle();

      if (profileErr || !profile) {
        await supabase.auth.signOut();
        return {
          success: false,
          error: 'User profile not found or access denied.',
        };
      }

      if (profile.status === 'soft_deleted') {
        await supabase.auth.signOut();
        return {
          success: false,
          error: 'Your account has been deactivated. Please contact the ICT Administrator.',
        };
      }

      // Link auth_id if it was not already populated in public.users
      if (!profile.auth_id && profile.id) {
        await supabase
          .from('users')
          .update({ auth_id: authUser.id })
          .eq('id', profile.id);
        profile.auth_id = authUser.id;
      }

      const mappedUser: User = {
        id: profile.id,
        role: profile.role,
        username: profile.username || cleanInput,
        email: profile.email || authUser.email || '',
        name:
          profile.name ||
          (profile.role === 'admin'
            ? 'System Administrator'
            : profile.username === 'tega'
            ? 'Mr Tega'
            : profile.username),
        department: profile.department || (profile.role === 'admin' ? 'ICT & Academic Affairs' : 'Computer Science'),
        staff_id: profile.staff_id || `ADUN/${profile.role === 'admin' ? 'ADM' : 'LEC'}/001`,
        status: profile.status,
        must_change_password: Boolean(profile.must_change_password),
        created_at: profile.created_at,
        deleted_at: profile.deleted_at,
      };

      return {
        success: true,
        user: mappedUser,
        role: mappedUser.role,
        mustChangePassword: mappedUser.must_change_password,
      };
    } catch (err) {
      return {
        success: false,
        error: sanitizeErrorMessage(err, 'Authentication service failed.'),
      };
    }
  }

  /**
   * Fetches profile for active session on app load.
   */
  static async getCurrentUser(): Promise<User | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session?.user) return null;

      const authUser = session.user;

      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .or(`auth_id.eq.${authUser.id},id.eq.${authUser.id},email.eq.${authUser.email}`)
        .eq('status', 'active')
        .maybeSingle();

      if (error || !profile) return null;

      // Link auth_id if missing
      if (!profile.auth_id) {
        await supabase.from('users').update({ auth_id: authUser.id }).eq('id', profile.id);
        profile.auth_id = authUser.id;
      }

      return {
        id: profile.id,
        role: profile.role,
        username: profile.username,
        email: profile.email || authUser.email || '',
        name:
          profile.name ||
          (profile.role === 'admin'
            ? 'System Administrator'
            : profile.username === 'tega'
            ? 'Mr Tega'
            : profile.username),
        department: profile.department || (profile.role === 'admin' ? 'ICT & Academic Affairs' : 'Computer Science'),
        staff_id: profile.staff_id || `ADUN/${profile.role === 'admin' ? 'ADM' : 'LEC'}/001`,
        status: profile.status,
        must_change_password: Boolean(profile.must_change_password),
        created_at: profile.created_at,
        deleted_at: profile.deleted_at,
      };
    } catch (e) {
      console.warn('Failed to restore Supabase Auth session:', e);
      return null;
    }
  }

  /**
   * Changes the authenticated user's password in Supabase Auth AND
   * clears must_change_password in public.users.
   */
  static async changePassword(
    userId: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    try {
      // 1. Update password in Supabase Auth
      const { error: authErr } = await supabase.auth.updateUser({ password: newPassword });
      if (authErr) {
        return { success: false, error: sanitizeErrorMessage(authErr) };
      }

      // 2. Persist must_change_password = false in public.users
      const { error: dbErr } = await supabase
        .from('users')
        .update({ must_change_password: false })
        .eq('id', userId);

      if (dbErr) {
        return { success: false, error: sanitizeErrorMessage(dbErr) };
      }

      // 3. Log audit event
      await supabase.from('audit_logs').insert({
        actor_id: userId,
        actor_role: 'system',
        action: 'PASSWORD_CHANGED',
        entity: 'users',
        entity_id: userId,
        metadata: { reason: 'mandatory_password_update' },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err, 'Failed to update password.') };
    }
  }

  /**
   * Signs out of Supabase Auth.
   */
  static async signOut(): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Sign out warning:', e);
      }
    }
  }
}
