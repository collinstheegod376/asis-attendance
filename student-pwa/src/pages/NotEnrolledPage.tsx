import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UserX, HelpCircle, ArrowLeft } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { getAttemptState } from '../lib/sessionStorage';

export const NotEnrolledPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();
  const courseCode = attempt?.session?.course_code;

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-between p-3 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-sm flex flex-col items-center pt-4 sm:pt-8 min-w-0">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 mt-4 sm:mt-8 shadow-sm border border-slate-200/80 text-center min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <UserX className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-1">
            Not Enrolled in Course Roster
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-5 sm:mb-6 break-words">
            Your matriculation number is not on the official roster for {courseCode ? <strong>{courseCode}</strong> : 'this course'}. Only approved students enrolled by the lecturer can sign attendance.
          </p>

          <div className="bg-blue-50/70 border border-blue-100 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-left mb-4 sm:mb-6 flex items-start gap-2.5 sm:gap-3 min-w-0">
            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-700 shrink-0 mt-0.5" />
            <div className="text-[11px] text-blue-900 leading-snug min-w-0">
              <strong className="block font-semibold mb-0.5">What should you do?</strong>
              <span className="break-words">Inform your course lecturer immediately so they can update the roster spreadsheet or verify your registration status.</span>
            </div>
          </div>

          <button
            onClick={() => navigate('/attend/identity')}
            type="button"
            className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Re-enter Matric Number
          </button>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full min-h-[38px] text-xs font-semibold text-slate-500 hover:text-slate-700 py-2"
          >
            Exit to Home
          </button>
        </div>
      </div>

      <div className="text-[10px] sm:text-[11px] text-slate-400 text-center py-3">
        Admiralty University of Nigeria · Academic Affairs
      </div>
    </div>
  );
};
