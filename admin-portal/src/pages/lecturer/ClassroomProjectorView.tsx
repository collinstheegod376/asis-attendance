import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Copy,
  Check,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { LectureSession, AttendanceRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { formatWATTime } from '../../lib/dateUtils';
import { getStudentPwaUrl } from '../../lib/studentPwaUrl';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

export const ClassroomProjectorView: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [session, setSession] = useState<LectureSession | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Subtle check-in chime using Web Audio API
  const playCheckinChime = useCallback(() => {
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
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {
      // Audio autoplay may be constrained until user interaction
    }
  }, [soundEnabled]);

  // Load session metadata ONCE (and verify ownership)
  useEffect(() => {
    if (!sessionId) return;
    let isMounted = true;

    LecturerService.getSessionById(sessionId).then(s => {
      if (!isMounted) return;
      if (!s) {
        setLoading(false);
        return;
      }

      if (user && user.role === 'lecturer' && s.lecturer_id && s.lecturer_id !== user.id) {
        alert('You do not have access to this lecture session.');
        navigate('/lecturer/dashboard', { replace: true });
        return;
      }

      setSession(s);
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [sessionId, user, navigate]);

  // Generate QR only when the token changes
  useEffect(() => {
    if (!session) return;

    const host = getStudentPwaUrl();
    const token = session.raw_token || session.id;
    const hasLoc = session.latitude != null && session.longitude != null;
    const joinUrl = `${host}/join/${token}?loc=${hasLoc ? '1' : '0'}`;

    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 12,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Failed to generate QR code:', err));
  }, [session?.raw_token, session?.id, session?.latitude, session?.longitude]);

  // Poll attendance records every 5s and subscribe via Supabase Realtime
  useEffect(() => {
    if (!sessionId) return;
    let isMounted = true;

    const fetchAttendees = async () => {
      const records = await LecturerService.getSessionAttendanceRecords(sessionId);
      if (!isMounted) return;

      if (records.length > previousCountRef.current && previousCountRef.current !== 0) {
        playCheckinChime();
      }
      previousCountRef.current = records.length;
      setAttendees(records);
    };

    fetchAttendees();
    const interval = setInterval(fetchAttendees, 5000);

    let channel: any = null;
    if (isSupabaseConfigured && supabase) {
      try {
        channel = supabase
          .channel(`projector:${sessionId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'attendance_records',
              filter: `session_id=eq.${sessionId}`,
            },
            () => {
              fetchAttendees();
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('Realtime subscription warning:', e);
      }
    }

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [sessionId, playCheckinChime]);

  // Lagos WAT Clock & Countdown timer
  useEffect(() => {
    const updateTime = () => {
      try {
        setLagosClock(formatWATTime(new Date()));

        if (!session) return;

        if (session.status === 'closed' || session.status === 'revoked') {
          setSessionState('closed');
          setTimeRemaining(session.status === 'revoked' ? 'Revoked' : 'Closed');
          return;
        }

        const now = new Date();
        const nowMs = now.getTime();
        const startMs = new Date(session.starts_at).getTime();
        const expiresMs = new Date(session.expires_at).getTime();
        const graceEndMs = startMs + (session.grace_minutes || 10) * 60 * 1000;

        if (nowMs >= expiresMs) {
          setSessionState('expired');
          setTimeRemaining('00:00:00');
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
      } catch {}
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
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
    const host = getStudentPwaUrl();
    const token = session.raw_token || session.id;
    const hasLoc = session.latitude != null && session.longitude != null;
    const joinUrl = `${host}/join/${token}?loc=${hasLoc ? '1' : '0'}`;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseSession = async () => {
    if (!session || !user) return;
    if (
      window.confirm(
        'End this lecture session early? Students will no longer be able to scan or submit attendance.'
      )
    ) {
      const res = await LecturerService.closeLectureSession(session.id, {
        id: user.id,
        name: user.name,
      });
      if (res.success) {
        setSession(prev => (prev ? { ...prev, status: 'closed' } : null));
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200 text-center">
        <div className="w-8 h-8 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-slate-400">Loading session display...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-100 text-center">
        <h2 className="text-xl font-semibold mb-2">Lecture session not found</h2>
        <p className="text-sm text-slate-400 mb-6 max-w-md">
          The requested session does not exist or may have been removed.
        </p>
        <button
          onClick={() => navigate('/lecturer/dashboard')}
          className="px-5 py-2.5 bg-slate-100 hover:bg-white text-slate-950 text-sm font-medium rounded-lg transition-colors cursor-pointer"
        >
          Return to dashboard
        </button>
      </div>
    );
  }

  const joinHost = getStudentPwaUrl();
  const token = session.raw_token || session.id;
  const hasLoc = session.latitude != null && session.longitude != null;
  const joinUrl = `${joinHost}/join/${token}?loc=${hasLoc ? '1' : '0'}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* Compact Responsive Header — Zero Overflow */}
      <header className="w-full px-4 sm:px-8 py-3 bg-slate-900 border-b border-white/[0.08] sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-3">
          {/* Left: Back button, Logo, Course Title */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Link
              to={`/lecturer/courses/${session.course_id}`}
              className="w-9 h-9 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-white/[0.08] flex items-center justify-center text-slate-300 transition-colors shrink-0"
              title="Back to course"
            >
              <ArrowLeft className="w-4 h-4 stroke-[1.75]" />
            </Link>

            <img
              src="/adun-logo.png"
              alt="ADUN"
              className="w-8 h-8 sm:w-9 sm:h-9 object-contain shrink-0"
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-base sm:text-lg font-semibold text-white shrink-0">
                  {session.course_code || 'Course'}
                </span>
                <span className="text-xs sm:text-sm text-slate-400 truncate">
                  {session.course_title}
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate">
                {session.lecturer_name || user?.name || 'Lecturer'}
              </p>
            </div>
          </div>

          {/* Right: Countdown, Controls, End Session */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden lg:flex flex-col items-end pr-2 border-r border-white/[0.08]">
              <span className="text-[11px] text-slate-500">Lagos (WAT)</span>
              <span className="font-mono text-xs tabular-nums text-slate-300">{lagosClock}</span>
            </div>

            {/* Countdown */}
            <div className="px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-slate-800/70 border border-white/[0.08] flex flex-col items-end">
              <span className="text-[10px] text-slate-400 leading-none mb-1">
                {sessionState === 'grace'
                  ? 'Grace period'
                  : sessionState === 'expired'
                  ? 'Expired'
                  : sessionState === 'closed'
                  ? 'Status'
                  : 'Remaining'}
              </span>
              <span
                className={`font-mono text-xs sm:text-sm font-semibold tabular-nums leading-none ${
                  sessionState === 'expired' || sessionState === 'closed'
                    ? 'text-rose-400'
                    : sessionState === 'grace'
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {timeRemaining}
              </span>
            </div>

            {/* Sound Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                soundEnabled
                  ? 'bg-slate-800 border-white/[0.12] text-slate-200 hover:bg-slate-700'
                  : 'bg-slate-900 border-white/[0.06] text-slate-500 hover:text-slate-300'
              }`}
              title={soundEnabled ? 'Mute check-in sound' : 'Unmute check-in sound'}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 stroke-[1.75]" />
              ) : (
                <VolumeX className="w-4 h-4 stroke-[1.75]" />
              )}
            </button>

            {/* Fullscreen Toggle (Desktop / Tablet) */}
            <button
              onClick={toggleFullscreen}
              className="hidden sm:flex w-9 h-9 rounded-lg bg-slate-800 border border-white/[0.08] hover:bg-slate-700 text-slate-300 items-center justify-center transition-colors cursor-pointer"
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 stroke-[1.75]" />
              ) : (
                <Maximize2 className="w-4 h-4 stroke-[1.75]" />
              )}
            </button>

            {/* End Session */}
            {session.status === 'active' && (
              <button
                onClick={handleCloseSession}
                className="px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/25 text-xs font-medium transition-colors cursor-pointer"
              >
                <span className="sm:hidden">End</span>
                <span className="hidden sm:inline">End session</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-8 py-5 sm:py-8 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 items-start">
        {/* Left Column: High-Contrast QR Sheet */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div className="w-full max-w-lg bg-white text-slate-900 rounded-2xl p-5 sm:p-8 border border-slate-200">
            {/* Institution & Session Title */}
            <div className="flex items-center justify-between gap-3 pb-4 mb-5 border-b border-slate-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <img src="/adun-logo.png" alt="ADUN" className="w-9 h-9 object-contain shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">
                    Admiralty University of Nigeria
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {hasLoc
                      ? `${session.location_name || 'Classroom location'} (${session.radius_m || 50}m boundary)`
                      : 'Attendance check-in'}
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-slate-500 shrink-0">
                {session.course_code}
              </span>
            </div>

            <div className="text-center mb-4">
              <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight break-words">
                {session.title}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Scan with your phone camera or open the link below
              </p>
            </div>

            {/* QR Code */}
            <div className="relative w-full max-w-[240px] sm:max-w-[320px] aspect-square mx-auto my-2 p-2.5 bg-white rounded-xl border border-slate-200/80 flex items-center justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Attendance QR Code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400 rounded-lg">
                  <RefreshCw className="w-7 h-7 animate-spin text-slate-400" />
                </div>
              )}

              {/* Expired / Closed Overlay */}
              {(sessionState === 'expired' || sessionState === 'closed') && (
                <div className="absolute inset-0 bg-slate-950/85 rounded-xl flex flex-col items-center justify-center text-white p-5 text-center">
                  <span className="text-lg font-semibold">
                    {sessionState === 'expired'
                      ? 'Session expired'
                      : session.status === 'revoked'
                      ? 'Session revoked'
                      : 'Session closed'}
                  </span>
                  <p className="text-xs text-slate-300 mt-1 max-w-[220px]">
                    Attendance submissions are no longer accepted for this session.
                  </p>
                </div>
              )}
            </div>

            {/* Direct Link & Copy Control */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-xl p-1.5 pl-3">
                <span className="text-xs font-mono text-slate-600 truncate flex-1 select-all">
                  {joinUrl}
                </span>
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[2]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 stroke-[1.75]" />
                  )}
                  <span>{copied ? 'Copied' : 'Copy link'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Attendance Count & Check-in Ledger */}
        <div className="lg:col-span-5 flex flex-col gap-4 w-full">
          {/* Attendance Count Card */}
          <div className="bg-slate-900 rounded-2xl p-5 border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Attendance count</span>
              <span className="text-xs text-slate-500">
                {sessionState === 'active' || sessionState === 'grace' ? 'Live' : 'Final'}
              </span>
            </div>

            <div className="flex items-baseline gap-2.5 mt-2">
              <span className="text-4xl sm:text-5xl font-semibold text-white tracking-tight tabular-nums">
                {attendees.length}
              </span>
              <span className="text-xs text-slate-400">
                {attendees.length === 1 ? 'student recorded' : 'students recorded'}
              </span>
            </div>
          </div>

          {/* Check-in Ledger */}
          <div className="bg-slate-900 rounded-2xl p-5 border border-white/[0.08] flex flex-col min-h-[300px] max-h-[480px]">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h2 className="text-sm font-medium text-slate-200">Recent check-ins</h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {attendees.length} total
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06] pt-1">
              {attendees.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-center px-4">
                  <p className="text-sm text-slate-400">No check-ins recorded yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Students appear here as soon as verification completes
                  </p>
                </div>
              ) : (
                attendees.map((item, index) => (
                  <div
                    key={item.id || index}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-100 truncate">
                        {item.student_name}
                      </p>
                      <p className="text-xs font-mono text-slate-400 truncate mt-0.5">
                        {item.matric_no}
                      </p>
                    </div>

                    <div className="flex flex-col items-end shrink-0">
                      <span
                        className={`text-xs font-medium ${
                          item.status === 'present' ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {item.status === 'present' ? 'Present' : 'Late'}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                        {formatWATTime(item.signed_at)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 sm:px-8 py-3 bg-slate-900/60 border-t border-white/[0.06] text-center text-xs text-slate-500">
        Admiralty University of Nigeria &bull; Africa/Lagos (WAT)
      </footer>
    </div>
  );
};
