import React from 'react';

interface AdunLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  onNavy?: boolean;
}

export const AdunLogo: React.FC<AdunLogoProps> = ({
  className = '',
  size = 56,
  showText = false,
  onNavy = false,
}) => {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`relative flex items-center justify-center rounded-2xl p-1.5 transition-all overflow-hidden ${
          onNavy
            ? 'bg-white shadow-md ring-2 ring-white/20 border border-white/40'
            : 'bg-white border border-slate-200/90 shadow-sm'
        }`}
        style={{ width: size, height: size }}
      >
        <img
          src="/adun-logo.png"
          alt="Admiralty University of Nigeria"
          className="w-full h-full object-contain"
          loading="eager"
        />
      </div>

      {showText && (
        <div className="mt-2 text-center select-none">
          <p
            className={`text-xs font-black tracking-widest uppercase leading-tight ${
              onNavy ? 'text-white' : 'text-[#1E40AF]'
            }`}
          >
            Admiralty University
          </p>
          <p
            className={`text-[10px] tracking-wider font-semibold uppercase mt-0.5 leading-none ${
              onNavy ? 'text-blue-100' : 'text-slate-500'
            }`}
          >
            of Nigeria · Ibusa
          </p>
        </div>
      )}
    </div>
  );
};
