import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { AppStorage } from '../lib/storage';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLecturer: boolean;
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'adun_portal_session_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      // Verify against current users in storage
      const existing = AppStorage.getUser(parsed.id);
      return existing && existing.status === 'active' ? existing : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    AppStorage.init();
  }, []);

  const refreshUser = () => {
    if (user) {
      const fresh = AppStorage.getUser(user.id);
      if (fresh) {
        setUser(fresh);
        localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
      } else {
        logout();
      }
    }
  };

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const target = AppStorage.findUserByUsername(username);

    if (!target) {
      return { success: false, error: 'Invalid username or password.' };
    }

    if (target.status === 'soft_deleted') {
      return {
        success: false,
        error: 'Your account has been deactivated. Please contact the ICT Administrator.',
      };
    }

    // Password verification
    if (target.password !== password) {
      return { success: false, error: 'Invalid username or password.' };
    }

    // Success
    setUser(target);
    localStorage.setItem(SESSION_KEY, JSON.stringify(target));

    AppStorage.logAudit(
      target.id,
      target.name,
      target.role,
      'USER_LOGIN',
      'auth',
      target.id,
      { username: target.username, role: target.role }
    );

    return { success: true };
  };

  const logout = () => {
    if (user) {
      AppStorage.logAudit(
        user.id,
        user.name,
        user.role,
        'USER_LOGOUT',
        'auth',
        user.id
      );
    }
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const changePassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'No active session.' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const res = AppStorage.updateUser(user.id, {
      password: newPassword,
      must_change_password: false,
    });

    if (!res.success) return res;

    const fresh = AppStorage.getUser(user.id);
    if (fresh) {
      setUser(fresh);
      localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
    }

    AppStorage.logAudit(
      user.id,
      user.name,
      user.role,
      'PASSWORD_CHANGED',
      'auth',
      user.id,
      { reason: 'mandatory_or_voluntary_update' }
    );

    return { success: true };
  };

  const isAdmin = user?.role === 'admin';
  const isLecturer = user?.role === 'lecturer';
  const isAuthenticated = Boolean(user);
  const mustChangePassword = Boolean(user?.must_change_password);

  return (
    <AuthContext.Provider
      value={{
        user,
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
