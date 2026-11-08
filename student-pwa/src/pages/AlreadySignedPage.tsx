import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldAlert, Home } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { getAttemptState } from '../lib/sessionStorage';

export const AlreadySignedPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const studentName = attempt?.student
    ? `${attempt.student.surname}, ${attempt.student.first_name}`
    : null;
  const matricNo = attempt?.student?.matric_no;
  const courseCode = attempt?.session?.course_code;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between p-6">
      <div className="w-full max-w-sm flex flex-col items-center pt-8">
        <AdunLogo size={64} showText />

        <div className="w-full bg-white rounded-3xl p-6 mt-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>

          <h2 className="text-lg font-bold text-slate-900 mb-1">
            Already Signed In
          </h2>

          <p className="text-xs text-slate-500 mb-5">
            Your attendance for this lecture session has already been recorded.
          </p>

          {/* Student & Course summary */}
          {(studentName || courseCode) && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left mb-6 space-y-2">
              {courseCode && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Course</div>
                  <div className="text-xs font-bold text-slate-800">{courseCode}</div>
                </div>
              )}
              {studentName && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Student</div>
                  <div className="text-xs font-semibold text-slate-800">{studentName}</div>
                </div>
              )}
              {matricNo && (
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Matric No</div>
                  <div className="text-xs font-mono font-medium text-blue-800">{matricNo}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-400">Session Status</div>
                <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Present / Verified
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-left mb-6">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800">
              Each student may only sign once per lecture session. Duplicate attempts are rejected by the server.
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
          >
            <Home className="w-4 h-4" />
            Return to Home
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Admiralty University of Nigeria · Attendance Portal
      </div>
    </div>
  );
};
