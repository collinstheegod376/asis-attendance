import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { CheckCircle2, Download, Home, HelpCircle, ShieldCheck, Clock } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { getAttemptState, clearAttemptState } from '../lib/attemptState';
import { formatToLagosTime } from '../lib/crypto';

export const AttendConfirmationPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  // Route Guard: Strictly requires confirmed receipt and student (Fixes QA-07)
  useEffect(() => {
    if (!attempt?.receipt?.receipt_id || !attempt?.student) {
      navigate('/', { replace: true });
      return;
    }

    // Fire celebratory confetti on mount
    try {
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.65 },
        colors: ['#1E40AF', '#3B82F6', '#60A5FA', '#10B981', '#F59E0B'],
      });
    } catch {}
  }, [attempt, navigate]);

  if (!attempt?.receipt?.receipt_id || !attempt?.student) {
    return null;
  }

  const receipt = attempt.receipt;

  const handleFinish = () => {
    clearAttemptState();
    navigate('/', { replace: true });
  };

  const handleDownload = () => {
    window.print();
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center p-3 sm:p-6 print:p-0 print:bg-white overflow-x-hidden">
      <div className="w-full max-w-sm flex flex-col items-center min-w-0">
        {/* Top Branding (Hidden on print) */}
        <div className="mb-3 sm:mb-4 print:hidden">
          <AdunLogo size={64} showText />
        </div>

        {/* Digital Receipt Card */}
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-md border border-slate-200/90 text-center relative overflow-hidden min-w-0 print:shadow-none print:border-slate-300">
          {/* Top Navy Blue Decorative Bar */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-[#1E40AF]" />

          {/* Receipt Official Seal */}
          <div className="flex items-center justify-center gap-2 mb-3 pt-1">
            <img
              src="/adun-logo.png"
              alt="Official Seal"
              className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow-xs shrink-0"
            />
            <div className="text-left min-w-0">
              <span className="text-[10px] uppercase font-black tracking-widest text-[#1E40AF] block leading-tight truncate">
                Admiralty University of Nigeria
              </span>
              <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 block leading-tight truncate">
                Official Digital Attendance Verification
              </span>
            </div>
          </div>

          {/* Success Check Icon */}
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-50 border-2 border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto mb-2.5 sm:mb-3 shadow-xs">
            <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.5]" />
          </div>

          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
            Attendance recorded!
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5 mb-4 sm:mb-5">
            Verified Academic Attendance Confirmation
          </p>

          {/* Selfie Thumbnail */}
          {receipt.selfie_preview && (
            <div className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-full mx-auto mb-4 p-1 border-2 border-blue-500/40 bg-blue-50 shadow-inner">
              <img
                src={receipt.selfie_preview}
                alt="Student verified selfie"
                className="w-full h-full rounded-full object-cover"
              />
              <div className="absolute bottom-0 right-0 bg-emerald-600 text-white rounded-full p-1 shadow-sm">
                <ShieldCheck className="w-3 h-3" />
              </div>
            </div>
          )}

          {/* Receipt Data Table — NO FAKE FALLBACK STRINGS (Fixes QA-07) */}
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-3.5 sm:p-4 text-left space-y-2.5 text-xs mb-4 sm:mb-5 min-w-0">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Student Name
              </span>
              <span className="font-extrabold text-slate-900 text-xs sm:text-sm break-words">
                {receipt.student_name}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60">
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Matric No
                </span>
                <span className="font-mono font-bold text-[#1E40AF] text-[11px] sm:text-xs break-all">
                  {receipt.matric_no}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  Status
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-bold text-[11px] sm:text-xs uppercase px-2 py-0.5 rounded-md ${
                    receipt.status === 'late'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  <Clock className="w-3 h-3 shrink-0" /> {receipt.status}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60 min-w-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Course
              </span>
              <span className="font-semibold text-slate-800 break-words">
                {receipt.course_code} — {receipt.course_title}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200/60 min-w-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Timestamp (Africa/Lagos)
              </span>
              <span className="font-medium text-slate-700 break-words">
                {formatToLagosTime(receipt.signed_at)}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200/60 bg-blue-50/50 p-2 sm:p-2.5 rounded-xl min-w-0">
              <span className="text-[9px] uppercase font-bold text-blue-900/60 block tracking-wider">
                Receipt Verification ID
              </span>
              <span className="font-mono font-extrabold text-[#1E40AF] text-[11px] sm:text-xs tracking-wider break-all block">
                {receipt.receipt_id}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 print:hidden">
            <button
              onClick={handleDownload}
              type="button"
              className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 font-semibold text-xs py-3.5 px-4 rounded-xl transition-colors"
            >
              <Download className="w-4 h-4" />
              Save / Print Receipt
            </button>

            <button
              onClick={handleFinish}
              type="button"
              className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-colors"
            >
              <Home className="w-4 h-4" />
              Done · Return to Home
            </button>
          </div>
        </div>

        {/* Support Help Link */}
        <div className="mt-4 sm:mt-5 text-center print:hidden">
          <a
            href="mailto:ict@adun.edu.ng"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#1E40AF] transition-colors py-1"
          >
            <HelpCircle className="w-3.5 h-3.5" /> Need IT Help? Contact ADUN ICT
          </a>
        </div>
      </div>
    </div>
  );
};
