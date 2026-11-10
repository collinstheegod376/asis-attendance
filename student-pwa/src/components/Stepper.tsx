import React from 'react';
import { Check } from 'lucide-react';
import { getAttemptState } from '../lib/attemptState';

export type StepKey = 'identity' | 'location' | 'selfie' | 'submit';

interface StepperProps {
  currentStep: StepKey;
}

export const Stepper: React.FC<StepperProps> = ({ currentStep }) => {
  const attempt = getAttemptState();
  const locationEnabled = Boolean(attempt?.session?.location_enabled);

  const rawSteps: { key: StepKey; label: string }[] = locationEnabled
    ? [
        { key: 'identity', label: 'Details' },
        { key: 'location', label: 'Location' },
        { key: 'selfie', label: 'Selfie' },
        { key: 'submit', label: 'Submit' },
      ]
    : [
        { key: 'identity', label: 'Details' },
        { key: 'selfie', label: 'Selfie' },
        { key: 'submit', label: 'Submit' },
      ];

  const steps = rawSteps.map((s, i) => ({ ...s, num: i + 1 }));

  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="w-full flex items-center justify-between px-0.5 sm:px-1 py-2 sm:py-3 mb-2 sm:mb-3 overflow-hidden">
      {steps.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = idx < currentIndex;

        return (
          <React.Fragment key={step.key}>
            <div
              className={`flex items-center gap-1 sm:gap-1.5 px-1.5 min-[360px]:px-2.5 py-1 sm:py-1.5 rounded-full text-[10px] min-[360px]:text-[11px] sm:text-xs font-semibold transition-all duration-300 shrink-0 ${
                isActive
                  ? 'bg-blue-800 text-white shadow-sm shadow-blue-900/20 ring-2 ring-blue-600/30'
                  : isCompleted
                  ? 'bg-blue-100 text-blue-900'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center text-[9px] sm:text-[10px] font-bold shrink-0 ${
                  isActive
                    ? 'bg-white text-blue-900'
                    : isCompleted
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-300 text-white'
                }`}
              >
                {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : step.num}
              </div>
              <span className="tracking-tight whitespace-nowrap">{step.label}</span>
            </div>

            {idx < steps.length - 1 && (
              <div
                className={`flex-1 min-w-1 sm:min-w-2 h-0.5 mx-0.5 min-[360px]:mx-1 transition-colors duration-300 ${
                  idx < currentIndex ? 'bg-blue-500' : 'bg-slate-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
