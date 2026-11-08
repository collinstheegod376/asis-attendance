import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { AdunLogo } from './AdunLogo';
import { Stepper } from './Stepper';
import type { StepKey } from './Stepper';

interface HeaderProps {
  currentStep?: StepKey;
  showStepper?: boolean;
  courseTitle?: string;
  courseCode?: string;
  onClose?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep = 'identity',
  showStepper = true,
  courseTitle,
  courseCode,
  onClose,
}) => {
  const navigate = useNavigate();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate('/');
    }
  };

  return (
    <div className="w-full bg-white border-b border-slate-100 px-4 pt-3 pb-2 sticky top-0 z-30 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
      {/* Top action row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <AdunLogo size={38} />
          <div>
            <div className="text-[10px] uppercase tracking-wider font-extrabold text-[#1E40AF] leading-none">
              Admiralty University
            </div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 leading-tight">
              Attendance Verification
            </div>
          </div>
        </div>

        <button
          onClick={handleClose}
          type="button"
          aria-label="Exit attendance session"
          className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Page Title */}
      <div className="px-1 mb-2">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
          Sign your attendance
        </h1>
        <p className="text-xs text-slate-500 font-medium">
          {courseCode ? (
            <span className="text-blue-800 font-semibold">{courseCode} · {courseTitle}</span>
          ) : (
            'Complete all steps to record your presence'
          )}
        </p>
      </div>

      {/* Stepper */}
      {showStepper && <Stepper currentStep={currentStep} />}
    </div>
  );
};
