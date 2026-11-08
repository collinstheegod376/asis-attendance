import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ShieldCheck, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const UnsupportedPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Device or Browser Unsupported
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            ADUN Attendance requires a modern mobile browser with secure HTTPS, Front Camera, and Geolocation access enabled.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left mb-6 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Use Safari (iOS) or Chrome (Android)</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Ensure connection is over HTTPS</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Allow camera & location permissions</span>
            </div>
          </div>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <Home className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Directorate of ICT
      </div>
    </div>
  );
};
