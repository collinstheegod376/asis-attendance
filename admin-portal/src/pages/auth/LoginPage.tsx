import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Lock, User as UserIcon, ShieldAlert, ArrowRight, Eye, EyeOff } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please provide your username/email and password.');
      return;
    }

    setLoading(true);
    const result = await login(username.trim(), password);
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Authentication failed.');
      return;
    }

    // Role-based redirect
    const userRole = username.trim().toLowerCase() === 'admin' ? 'admin' : undefined;
    if (userRole === 'admin') {
      navigate('/admin/home');
    } else {
      // Default to admin or lecturer home based on session check
      navigate('/admin/home');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8">
      {/* Background ambient accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* University Crest & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl mb-4">
            <img src="/adun-logo.png" alt="ADUN Crest" className="w-14 h-14 object-contain" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            ADUN <span className="text-blue-400">ATTENDANCE</span>
          </h1>
          <p className="text-xs sm:text-sm text-blue-200/80 font-medium mt-1">
            Admiralty University of Nigeria &bull; Delta State
          </p>
          <div className="inline-block mt-2 px-3 py-0.5 rounded-full bg-blue-900/60 border border-blue-700/50 text-[11px] font-mono tracking-wide text-blue-200">
            SECURE PORTAL ACCESS (ADMIN &amp; LECTURER)
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">Sign in to your account</h2>
            <p className="text-xs text-slate-500 mt-1">
              Enter your credentials to access the administrative or lecturer workbench.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mb-5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username or Official Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. admin or lecturer username"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 active:bg-blue-900 rounded-xl transition shadow-xs disabled:opacity-50"
            >
              {loading ? (
                <span>Verifying...</span>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Seed admin helper hint */}
          <div className="mt-6 pt-5 border-t border-slate-100 bg-blue-50/50 rounded-xl p-3 border border-blue-100">
            <p className="text-[11px] font-semibold text-blue-900 mb-0.5">Initial System Setup:</p>
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Default administrator account: <code className="bg-white px-1.5 py-0.5 rounded text-blue-950 font-mono font-semibold">admin</code> / <code className="bg-white px-1.5 py-0.5 rounded text-blue-950 font-mono font-semibold">admin</code>. You will be prompted to set a new password on your first sign in.
            </p>
          </div>
        </div>

        {/* Security / Subdomain note */}
        <p className="text-center text-slate-400 text-xs mt-6">
          Admiralty University of Nigeria &bull; Attendance Verification System
        </p>
      </div>
    </div>
  );
};
