import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Clock, Camera, MapPin, Database } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';

export const PrivacyPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center p-3 sm:p-6 overflow-x-hidden">
      <div className="w-full max-w-md bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm border border-slate-200/80 my-2 sm:my-4 min-w-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 hover:text-blue-950 mb-3 sm:mb-4 py-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-center gap-3 mb-4">
          <AdunLogo size={44} />
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">
              Attendance Privacy Notice
            </h1>
            <p className="text-[11px] text-slate-500">
              Admiralty University of Nigeria (ADUN)
            </p>
          </div>
        </div>

        <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
          <section className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-100">
            <div className="flex items-center gap-2 text-blue-900 font-bold mb-1">
              <Shield className="w-4 h-4 text-blue-700" />
              Institutional Authority
            </div>
            <p className="text-[11px] text-blue-950/80">
              Pursuant to the ADUN Academic Regulations, student attendance records are collected to verify lecture presence, maintain course accreditation standards, and uphold academic integrity.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-blue-800 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-[12px]">Location Verification</h4>
                <p className="text-[11px] text-slate-500">
                  Your device geolocation is checked at the instant of check-in to confirm physical presence within the designated lecture venue or campus perimeter. Continuous tracking is never performed.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-blue-800 shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-[12px]">Selfie & Biometric Liveness</h4>
                <p className="text-[11px] text-slate-500">
                  A front camera photo is taken to prevent proxy sign-ins. Selfies are encrypted and retained for 180 days in restricted cloud storage, accessible exclusively by authorized university lecturers and administrators.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-blue-800 shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-[12px]">Device Binding</h4>
                <p className="text-[11px] text-slate-500">
                  To protect students against unauthorized use of their student credentials by others, an anonymous device token is bound to your matric number.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-blue-800 shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-[12px]">Audit & Retention</h4>
                <p className="text-[11px] text-slate-500">
                  All attendance timestamps are synchronized with Africa/Lagos official time. Records are securely stored in the university database for academic transcripts and examination qualification.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400">
            For privacy inquiries or device unbinding requests, contact the Directorate of ICT at ict@adun.edu.ng.
          </p>
        </div>
      </div>
    </div>
  );
};
