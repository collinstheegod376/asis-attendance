import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { QrCode, ShieldCheck } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { QRScannerModal } from '../components/QRScannerModal';
import { detectIncognito } from '../lib/deviceFingerprint';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scannerOpen, setScannerOpen] = useState(false);

  // Gate 0: First-pass Incognito deterrent on landing page
  useEffect(() => {
    let active = true;
    async function checkPrivateMode() {
      const isPrivate = await detectIncognito();
      if (active && isPrivate) {
        navigate('/block/incognito?ref=BIND-205', { replace: true });
      }
    }
    checkPrivateMode();
    return () => {
      active = false;
    };
  }, [navigate]);

  const handleScanSuccess = (decodedText: string) => {
    setScannerOpen(false);
    try {
      if (decodedText.includes('/join/')) {
        const parts = decodedText.split('/join/');
        const token = parts[1]?.split('?')[0]?.split('#')[0];
        if (token) {
          navigate(`/join/${token}`);
          return;
        }
      }
      const clean = decodedText.trim();
      if (clean) {
        navigate(`/join/${clean}`);
      }
    } catch (e) {
      console.error('Scan handle error:', e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      {/* Top Branding */}
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={80} showText />

        {/* Hero Card */}
        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200/80 text-[#1E40AF] flex items-center justify-center mb-4">
            <QrCode className="w-8 h-8 text-[#1E40AF]" />
          </div>

          <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-2">
            ADUN Attendance
          </h2>

          <p className="text-sm font-medium text-slate-600 mb-6 max-w-[240px]">
            Scan a lecture code to continue.
          </p>

          {/* Primary Action Button */}
          <button
            onClick={() => setScannerOpen(true)}
            type="button"
            className="w-full flex items-center justify-center gap-2.5 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-sm py-3.5 px-5 rounded-2xl shadow-md transition-all active:scale-[0.99]"
          >
            <QrCode className="w-4 h-4" />
            Scan Classroom Code
          </button>

          <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1E40AF] shrink-0" />
            <span>Official Student Verification Gateway</span>
          </div>
        </div>
      </div>

      {/* Footer strictly with Privacy Notice only */}
      <div className="w-full max-w-sm text-center py-4">
        <Link
          to="/privacy"
          className="text-xs font-semibold text-slate-500 hover:text-[#1E40AF] underline decoration-slate-300 underline-offset-4 transition-colors"
        >
          Attendance Privacy Notice & Terms
        </Link>
        <p className="text-[10px] text-slate-400 mt-1 font-medium">
          Admiralty University of Nigeria · Powered by ICT Directorate
        </p>
      </div>

      {/* In-app QR Scanner Modal */}
      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
};
