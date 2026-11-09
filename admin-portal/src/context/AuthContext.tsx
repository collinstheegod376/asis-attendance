import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, UserRole } from '../types';
import { AuthService, AuthLoginResult } from '../services/authService';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLecturer: boolean;
  mustChangePassword: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<AuthLoginResult>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const current = await AuthService.getCurrentUser();
      setUser(current);
    } catch (e) {
      console.warn('Error refreshing user session:', e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial session restore
    refreshUser();

    // Listen to Supabase Auth state changes
    if (isSupabaseConfigured && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session?.user) {
            const current = await AuthService.getCurrentUser();
            setUser(current);
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (usernameOrEmail: string, password: string): Promise<AuthLoginResult> => {
    const result = await AuthService.login(usernameOrEmail, password);
    if (result.success && result.user) {
      setUser(result.user);
    }
    return result;
  };

  const logout = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  const changePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No active session.' };
    const res = await AuthService.changePassword(user.id, newPassword);
    if (res.success) {
      setUser(prev => (prev ? { ...prev, must_change_password: false } : null));
    }
    return res;
  };

  const role = user?.role || null;
  const isAdmin = role === 'admin';
  const isLecturer = role === 'lecturer';
  const isAuthenticated = Boolean(user);
  const mustChangePassword = Boolean(user?.must_change_password);

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        loading,
        isAuthenticated,
        isAdmin,
        isLecturer,
        mustChangePassword,
        login,
        logout,
        changePassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
