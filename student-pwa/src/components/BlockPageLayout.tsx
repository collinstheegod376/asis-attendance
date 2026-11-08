import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, ShieldCheck, HelpCircle } from 'lucide-react';
import { AdunLogo } from './AdunLogo';

interface BlockPageLayoutProps {
  title: string;
  reason: string;
  referenceCode: string;
  icon: React.ReactNode;
  iconBgColor?: string;
  badgeText?: string;
}

export const BlockPageLayout: React.FC<BlockPageLayoutProps> = ({
  title,
  reason,
  referenceCode,
  icon,
  iconBgColor = 'bg-red-50 border-red-200 text-red-600',
  badgeText = 'Security Policy Gate',
}) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-4 sm:p-6">
      {/* Top Branding Header */}
      <div className="w-full max-w-sm flex flex-col items-center pt-6 sm:pt-8">
        <AdunLogo size={72} showText />

        {/* Security Block Card */}
        <div className="w-full bg-white rounded-3xl p-6 sm:p-7 mt-6 shadow-sm border border-slate-200/90 text-center relative overflow-hidden">
          {/* Institutional Navy Blue Accent Bar */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-[#1E40AF]" />

          {/* Icon Badge */}
          <div
            className={`w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-4 shadow-xs ${iconBgColor}`}
          >
            {icon}
          </div>

          {/* Reference Code Pill */}
          <div className="mb-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-white font-mono text-xs font-bold shadow-xs">
              <span className="text-slate-400 text-[10px] uppercase tracking-wider">REF:</span>
              <span className="text-amber-400 tracking-wider font-extrabold">{referenceCode}</span>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mb-2 leading-snug">
            {title}
          </h1>

          {/* Policy Badge */}
          <div className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-4">
            <ShieldCheck className="w-3 h-3 text-[#1E40AF]" />
            <span>{badgeText}</span>
          </div>

          {/* Reason Box */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-center mb-5">
            <p className="text-xs sm:text-sm font-semibold text-slate-800 leading-relaxed">
              {reason}
            </p>
          </div>

          {/* Mandatory Instruction Box */}
          <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 text-center mb-6">
            <span className="text-[10px] uppercase font-bold text-[#1E40AF] tracking-wider block mb-1">
              Required Next Step
            </span>
            <p className="text-xs font-bold text-slate-900 leading-snug">
              Contact the administrator or your course lecturer to reset your device binding.
            </p>
          </div>

          {/* Academic Policy Citation */}
          <div className="text-[11px] text-slate-500 mb-6 px-1 text-center leading-normal">
            Admiralty University of Nigeria policy requires each student to use their own registered personal device for attendance verification.
          </div>

          {/* STRICTLY NO SELF-SERVICE OTP OR BYPASS BUTTON */}
          <div className="pt-2 border-t border-slate-100">
            <button
              onClick={() => navigate('/')}
              type="button"
              className="w-full flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-colors"
            >
              <Home className="w-4 h-4" />
              Return to Home
            </button>
          </div>
        </div>
      </div>

      {/* Footer Support */}
      <div className="w-full max-w-sm text-center py-4">
        <a
          href="mailto:ict@adun.edu.ng"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#1E40AF] transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" /> Admiralty University ICT Directorate
        </a>
        <p className="text-[10px] text-slate-400 mt-1">
          Device Binding & Anti-Proxy Enforcement · ADUN Option 2
        </p>
      </div>
    </div>
  );
};
