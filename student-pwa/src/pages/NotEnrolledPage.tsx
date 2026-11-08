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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto mb-4">
            <UserX className="w-7 h-7" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-1">
            Not Enrolled in Course Roster
          </h2>

          <p className="text-xs text-slate-600 leading-relaxed mb-6">
            Your matriculation number is not on the official roster for {courseCode ? <strong>{courseCode}</strong> : 'this course'}. Only approved students enrolled by the lecturer can sign attendance.
          </p>

          <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-4 text-left mb-6 flex items-start gap-3">
            <HelpCircle className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
            <div className="text-[11px] text-blue-900 leading-snug">
              <strong className="block font-semibold mb-0.5">What should you do?</strong>
              Inform your course lecturer immediately so they can update the roster spreadsheet or verify your registration status.
            </div>
          </div>

          <button
            onClick={() => navigate('/attend/identity')}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Re-enter Matric Number
          </button>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full text-xs font-semibold text-slate-500 hover:text-slate-700 py-2"
          >
            Exit to Home
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Academic Affairs
      </div>
    </div>
  );
};
