import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  GraduationCap,
  BarChart3,
  Sliders,
  Smartphone,
  ShieldCheck,
  LogOut,
  KeyRound,
  Clock,
  Menu,
  X,
  AlertTriangle,
  Presentation,
  CheckCircle2,
} from 'lucide-react';

export const AppLayout: React.FC = () => {
  const { user, isAdmin, isLecturer, logout, mustChangePassword, changePassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lagosTime, setLagosTime] = useState('');
  
  // Force change password modal state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Time in Africa/Lagos
  useEffect(() => {
    const updateClock = () => {
      try {
        const now = new Date();
        const lagosString = now.toLocaleTimeString('en-GB', {
          timeZone: 'Africa/Lagos',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        setLagosTime(lagosString);
      } catch {
        setLagosTime(new Date().toLocaleTimeString());
      }
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');

    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    if (newPassword === 'admin') {
      setPwError('You cannot reuse the default password. Choose a secure new password.');
      return;
    }

    setPwLoading(true);
    const res = await changePassword(newPassword);
    setPwLoading(false);

    if (!res.success) {
      setPwError(res.error || 'Failed to update password.');
    } else {
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const adminNavItems = [
    { label: 'Overview', to: '/admin/home', icon: LayoutDashboard },
    { label: 'Lecturers', to: '/admin/lecturers', icon: Users },
    { label: 'Courses', to: '/admin/courses', icon: BookOpen },
    { label: 'Students Master', to: '/admin/students', icon: GraduationCap },
    { label: 'Analytics', to: '/admin/analytics', icon: BarChart3 },
    { label: 'Device Bindings', to: '/admin/device-bindings', icon: Smartphone },
    { label: 'System Settings', to: '/admin/settings', icon: Sliders },
    { label: 'Audit Logs', to: '/admin/audit', icon: ShieldCheck },
  ];

  const lecturerNavItems = [
    { label: 'Lecturer Dashboard', to: '/lecturer/dashboard', icon: LayoutDashboard },
    { label: 'My Courses', to: '/lecturer/courses', icon: BookOpen },
  ];

  const navItems = isAdmin ? adminNavItems : lecturerNavItems;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Brand / Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2.5">
              <img src="/adun-logo.png" alt="ADUN Logo" className="w-9 h-9 object-contain" />
              <div>
                <span className="font-bold tracking-tight text-blue-900 text-base leading-tight block">
                  ADUN <span className="text-blue-600">ATTENDANCE</span>
                </span>
                <span className="text-[10px] tracking-wider text-slate-500 uppercase font-medium block">
                  Admiralty University of Nigeria
                </span>
              </div>
            </div>
          </div>

          {/* Right: Status, Lagos Time, Profile */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Lagos Time badge */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-800 text-xs font-mono font-medium rounded-full border border-blue-100">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>WAT (Lagos): {lagosTime}</span>
            </div>

            {/* Role pill */}
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full tracking-wide uppercase ${
                isAdmin
                  ? 'bg-amber-100 text-amber-900 border border-amber-200'
                  : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
              }`}
            >
              {user?.role}
            </span>

            {/* User Info & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-semibold text-slate-800 leading-none">{user?.name}</p>
                <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{user?.email}</p>
              </div>

              <button
                onClick={handleLogout}
                title="Sign out"
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-slate-300 border-r border-slate-800 shrink-0 select-none">
          <div className="p-4 space-y-1">
            <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              {isAdmin ? 'Administration Portal' : 'Lecturer Workstation'}
            </div>

            {navItems.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-xs font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          {/* Quick link to Projector Mode for lecturers */}
          {isLecturer && (
            <div className="p-4 mt-auto border-t border-slate-800">
              <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold mb-1">
                  <Presentation className="w-4 h-4" />
                  <span>Classroom Projector</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug mb-2">
                  Launch full-screen QR & live feed for classroom display.
                </p>
                <NavLink
                  to="/lecturer/courses"
                  className="inline-flex items-center text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  Select Active Session &rarr;
                </NavLink>
              </div>
            </div>
          )}

          {/* Footer note */}
          <div className="p-4 mt-auto border-t border-slate-800 text-[11px] text-slate-400 text-center">
            ADUN Attendance &bull; v1.0.0
          </div>
        </aside>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 top-16 z-30 lg:hidden bg-slate-900/50 backdrop-blur-xs flex flex-col">
            <div className="bg-slate-900 text-slate-200 p-4 space-y-1 shadow-xl">
              {navItems.map(item => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                        isActive ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
            <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        {/* Content View */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mandatory Password Change Dialog if must_change_password is true */}
      {mustChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-8">
            <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mb-4">
              <KeyRound className="w-6 h-6" />
            </div>

            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Security Action Required</h2>
            <p className="text-sm text-slate-600 mt-1 mb-5">
              This account was initialized with default credentials. For compliance with ADUN security policy, you must set a new secure password before proceeding.
            </p>

            {pwError && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs mb-4">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{pwError}</span>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Secure Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Retype password"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
              </div>

              <button
                type="submit"
                disabled={pwLoading}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 active:bg-blue-900 rounded-xl transition shadow-xs disabled:opacity-50 mt-2"
              >
                {pwLoading ? (
                  <span>Updating...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Set Secure Password & Enter</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
