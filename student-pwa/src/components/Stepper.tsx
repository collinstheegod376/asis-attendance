import React from 'react';
import { Check } from 'lucide-react';

export type StepKey = 'identity' | 'selfie' | 'submit';

interface StepperProps {
  currentStep: StepKey;
}

export const Stepper: React.FC<StepperProps> = ({ currentStep }) => {
  const steps: { key: StepKey; label: string; num: number }[] = [
    { key: 'identity', label: 'Details', num: 1 },
    { key: 'selfie', label: 'Selfie', num: 2 },
    { key: 'submit', label: 'Submit', num: 3 },
  ];

  const getStepIndex = (key: StepKey) => {
    switch (key) {
      case 'identity':
        return 0;
      case 'selfie':
        return 1;
      case 'submit':
        return 2;
    }
  };

  const currentIndex = getStepIndex(currentStep);

  return (
    <div className="w-full flex items-center justify-between px-2 py-3 mb-4">
      {steps.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = idx < currentIndex;

        return (
          <React.Fragment key={step.key}>
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${
                isActive
                  ? 'bg-blue-800 text-white shadow-sm shadow-blue-900/20 ring-2 ring-blue-600/30'
                  : isCompleted
                  ? 'bg-blue-100 text-blue-900'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  isActive
                    ? 'bg-white text-blue-900'
                    : isCompleted
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-300 text-white'
                }`}
              >
                {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : step.num}
              </div>
              <span className="tracking-tight">{step.label}</span>
            </div>

            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1.5 transition-colors duration-300 ${
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
