import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Users,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ArrowLeft,
  RefreshCw,
  PowerOff,
  Sparkles,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { AppStorage } from '../../lib/storage';
import { LectureSession, AttendanceRecord } from '../../types';

export const ClassroomProjectorView: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<LectureSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [attendees, setAttendees] = useState<AttendanceRecord[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('--:--:--');
  const [sessionState, setSessionState] = useState<'active' | 'grace' | 'expired' | 'closed'>('active');
  const [lagosClock, setLagosClock] = useState<string>('');

  const previousCountRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Play pleasant check-in chime using Web Audio API
  const playCheckinChime = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {
      // Audio autoplay may be constrained until user interaction
    }
  };

  // Load session data
  const loadData = () => {
    if (!sessionId) return;
    const s = LecturerService.getSessionById(sessionId);
    if (!s) {
      return;
    }
    setSession(s);

    const records = LecturerService.getSessionAttendanceRecords(sessionId);
    // If attendee count increased, chime
    if (records.length > previousCountRef.current && previousCountRef.current !== 0) {
      playCheckinChime();
    }
    previousCountRef.current = records.length;
    setAttendees(records);

    // Compute session join link (Static QR does not rotate)
    const host = window.location.origin.includes('localhost') 
      ? window.location.origin.replace(':5174', ':5173') // Pointing to student PWA default port
      : window.location.origin;
    const token = s.raw_token || s.id;
    const joinUrl = `${host}/join/${token}`;

    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 12,
      color: {
        dark: '#0f172a', // Deep Navy
        light: '#ffffff', // Pure White
      },
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Failed to generate QR code:', err));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2500); // Polling for live attendance records
    return () => clearInterval(interval);
  }, [sessionId, soundEnabled]);

  // Clock & Countdown timer
  useEffect(() => {
    const updateTime = () => {
      // Lagos time clock
      try {
        const now = new Date();
        const lagosStr = now.toLocaleTimeString('en-GB', {
          timeZone: 'Africa/Lagos',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        setLagosClock(lagosStr);

        if (!session) return;

        if (session.status === 'closed' || session.status === 'revoked') {
          setSessionState('closed');
          setTimeRemaining('SESSION CLOSED');
          return;
        }

        const nowMs = now.getTime();
        const startMs = new Date(session.starts_at).getTime();
        const expiresMs = new Date(session.expires_at).getTime();
        const graceEndMs = startMs + (session.grace_minutes || 10) * 60 * 1000;

        if (nowMs >= expiresMs) {
          setSessionState('expired');
          setTimeRemaining('00:00:00 (EXPIRED)');
        } else {
          if (nowMs <= graceEndMs) {
            setSessionState('grace');
          } else {
            setSessionState('active');
          }

          const diffSec = Math.floor((expiresMs - nowMs) / 1000);
          const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
          const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
          const secs = String(diffSec % 60).padStart(2, '0');
          setTimeRemaining(`${hrs}:${mins}:${secs}`);
        }
      } catch {
        // Fallback
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [session]);

  // Fullscreen handlers
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  };

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleCopyLink = () => {
    if (!session) return;
    const host = window.location.origin.includes('localhost') 
      ? window.location.origin.replace(':5174', ':5173')
      : window.location.origin;
    const token = session.raw_token || session.id;
    const joinUrl = `${host}/join/${token}`;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseSession = () => {
    if (!session) return;
    if (window.confirm('Are you sure you want to end and close this lecture session early? Students will no longer be able to scan or submit attendance.')) {
      const res = LecturerService.closeLectureSession(session.id, {
        id: session.lecturer_id || 'lecturer',
        name: session.lecturer_name || 'Course Lecturer',
      });
      if (res.success) {
        loadData();
      }
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white text-center">
        <AlertCircle className="w-16 h-16 text-rose-400 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Lecture Session Not Found</h2>
        <p className="text-slate-400 mb-6 max-w-md">
          The requested session ID does not exist or may have been deleted.
        </p>
        <button
          onClick={() => navigate('/lecturer/dashboard')}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const joinHost = window.location.origin.includes('localhost') 
    ? window.location.origin.replace(':5174', ':5173')
    : window.location.origin;
  const token = session.raw_token || session.id;
  const joinUrl = `${joinHost}/join/${token}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* Top Bar for Projector */}
      <header className="px-6 sm:px-10 py-4 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between gap-4 sticky top-0 z-50">
        {/* Course & Institution Info */}
        <div className="flex items-center gap-4">
          <Link
            to={`/lecturer/courses/${session.course_id}`}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title="Exit Projector Mode"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <img src="/adun-logo.png" alt="ADUN Logo" className="w-12 h-12 object-contain drop-shadow-md rounded-xl bg-white/10 p-1 border border-white/10" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {session.course_code || 'COURSE'}
              </span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                CLASSROOM PROJECTOR MODE
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 font-medium truncate max-w-md sm:max-w-xl">
              {session.course_title} &bull; Lecturer: <span className="text-white font-semibold">{session.lecturer_name || 'Lecturer in Charge'}</span>
            </p>
          </div>
        </div>

        {/* Live Status, Clock & Action Controls */}
        <div className="flex items-center gap-3 sm:gap-5">
          {/* Lagos Time */}
          <div className="hidden lg:flex flex-col items-end">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">WAT (Lagos Time)</span>
            <span className="font-mono text-base font-bold text-slate-200">{lagosClock}</span>
          </div>

          {/* Time Countdown Pill */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700">
            <Clock className={`w-4 h-4 ${sessionState === 'expired' ? 'text-rose-400' : 'text-blue-400'}`} />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                {sessionState === 'grace' ? 'Grace Period Active' : 'Time Remaining'}
              </span>
              <span className={`font-mono text-sm sm:text-base font-extrabold ${sessionState === 'expired' ? 'text-rose-400' : sessionState === 'grace' ? 'text-amber-300' : 'text-emerald-400'}`}>
                {timeRemaining}
              </span>
            </div>
          </div>

          {/* Sound Chime Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl border transition ${
              soundEnabled
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300 hover:bg-blue-600/30'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}
            title={soundEnabled ? 'Chime sound enabled on check-in' : 'Chime sound muted'}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2.5 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 transition"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen (F11)'}
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          {/* End Session Button */}
          {session.status === 'active' && (
            <button
              onClick={handleCloseSession}
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition"
            >
              <PowerOff className="w-4 h-4" />
              <span>End Session</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Presentation Stage */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 sm:p-10 max-w-[1600px] mx-auto w-full items-center">
        {/* Left Column: QR Code Display Card (8 cols) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col items-center justify-center text-center">
          <div className="w-full max-w-xl bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-blue-600/40 relative">
            {/* Institutional Header with Official ADUN Logo */}
            <div className="flex items-center justify-center gap-3 pb-3 mb-3 border-b border-slate-100">
              <img src="/adun-logo.png" alt="ADUN Logo" className="w-12 h-12 object-contain" />
              <div className="text-left">
                <span className="text-xs font-black tracking-wide text-blue-950 uppercase block">
                  Admiralty University of Nigeria
                </span>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Classroom Attendance Terminal &bull; Option 2 Strict Device Lock
                </span>
              </div>
            </div>

            {/* Session Title Header */}
            <div className="mb-4">
              <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-900 text-xs font-bold tracking-wide uppercase mb-2">
                Scan With Phone Camera
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-tight">
                {session.title}
              </h3>
            </div>

            {/* High-Contrast Static QR Code */}
            <div className="relative inline-block my-2 p-3 bg-white rounded-2xl shadow-inner border border-slate-100">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Session Static QR Code"
                  className="w-72 h-72 sm:w-96 sm:h-96 object-contain rounded-xl"
                />
              ) : (
                <div className="w-72 h-72 sm:w-96 sm:h-96 flex items-center justify-center bg-slate-50 text-slate-400">
                  <RefreshCw className="w-10 h-10 animate-spin text-blue-600" />
                </div>
              )}

              {/* Status Overlay if Expired/Closed */}
              {sessionState === 'expired' && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center text-white p-6">
                  <AlertCircle className="w-16 h-16 text-rose-500 mb-3" />
                  <span className="text-2xl font-black tracking-tight">SESSION EXPIRED</span>
                  <p className="text-xs text-slate-300 mt-1 max-w-xs">
                    This attendance code has expired by duration limit.
                  </p>
                </div>
              )}

              {sessionState === 'closed' && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center text-white p-6">
                  <PowerOff className="w-16 h-16 text-rose-500 mb-3" />
                  <span className="text-2xl font-black tracking-tight">SESSION CLOSED</span>
                  <p className="text-xs text-slate-300 mt-1 max-w-xs">
                    The lecturer has concluded this session.
                  </p>
                </div>
              )}
            </div>

            {/* Join URL and Copy Action */}
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
              <div className="truncate text-xs font-mono text-slate-600 bg-slate-100 px-3 py-2 rounded-xl flex-1 w-full">
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Direct Link:</span>
                <span className="truncate block font-semibold text-blue-700">{joinUrl}</span>
              </div>
              <button
                onClick={handleCopyLink}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied' : 'Copy Link'}</span>
              </button>
            </div>

            {/* Security note */}
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-600 font-medium bg-slate-50 py-2 px-3 rounded-xl border border-slate-100">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Option 2 Strict Device Binding Enforced &bull; Static Token &bull; Live WAT Verified</span>
            </div>
          </div>
        </div>

        {/* Right Column: Live Attendees Counter & Stream Feed (4 cols) */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col h-full space-y-4">
          {/* Big Live Attendee Counter Card */}
          <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 relative z-10">
              <div className="flex items-center gap-2">
                <img src="/adun-logo.png" alt="ADUN Logo" className="w-6 h-6 object-contain rounded-md bg-white/10 p-0.5" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Live Attendance Count
                </span>
              </div>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Real-Time
              </span>
            </div>

            <div className="flex items-baseline gap-3 my-2 relative z-10">
              <span className="text-5xl sm:text-6xl font-black text-white tracking-tight">
                {attendees.length}
              </span>
              <span className="text-slate-400 font-medium text-sm">students recorded</span>
            </div>

            <p className="text-xs text-slate-400 relative z-10">
              Students in the lecture hall are automatically displayed below as their verification passes.
            </p>
          </div>

          {/* Live Feed Container */}
          <div className="bg-slate-900/80 rounded-3xl p-6 border border-slate-800 shadow-xl flex-1 flex flex-col min-h-[360px] max-h-[500px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Recent Check-ins
              </h4>
              <span className="text-xs text-slate-500 font-mono">
                {attendees.length} check-in{attendees.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Scrollable Feed List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pt-3 pr-1">
              {attendees.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 mb-3 animate-pulse">
                    <Users className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">Waiting for check-ins...</p>
                  <p className="text-xs text-slate-500 max-w-xs mt-1">
                    Ask students to scan the QR code centered on the screen.
                  </p>
                </div>
              ) : (
                attendees.map((item, index) => {
                  const d = new Date(item.signed_at);
                  const timeStr = d.toLocaleTimeString('en-GB', {
                    timeZone: 'Africa/Lagos',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  });

                  return (
                    <div
                      key={item.id || index}
                      className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-between gap-3 hover:bg-slate-800 transition"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          item.status === 'present' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-bold text-white truncate">
                            {item.student_name}
                          </p>
                          <p className="text-xs font-mono text-blue-300 font-medium">
                            {item.matric_no}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          item.status === 'present' 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {item.status}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 mt-1">
                          {timeStr}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer Banner */}
      <footer className="px-6 py-3 bg-slate-900 border-t border-slate-800 text-center text-xs text-slate-500">
        Admiralty University of Nigeria Attendance System &bull; Static QR Protection &bull; Africa/Lagos Timezone
      </footer>
    </div>
  );
};
