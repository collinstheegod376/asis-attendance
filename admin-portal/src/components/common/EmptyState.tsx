import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  secondaryActionText?: string;
  onSecondaryAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  actionText,
  onAction,
  secondaryActionText,
  onSecondaryAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-white border border-dashed border-slate-200 rounded-2xl shadow-xs">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-700 mb-4 ring-8 ring-blue-50/50">
        <Icon className="w-8 h-8 stroke-[1.75]" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 max-w-md leading-relaxed mb-6">{description}</p>
      
      {(actionText || secondaryActionText) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actionText && onAction && (
            <button
              onClick={onAction}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 active:bg-blue-900 rounded-xl transition shadow-xs"
            >
              {actionText}
            </button>
          )}
          {secondaryActionText && onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-xl transition"
            >
              {secondaryActionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
