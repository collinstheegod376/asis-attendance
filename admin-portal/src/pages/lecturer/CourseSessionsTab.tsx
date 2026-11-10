import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Presentation,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  PowerOff,
  Users,
  Calendar,
  Play,
  Ban,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { Course, LectureSession } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/common/EmptyState';
import {
  formatWATDate,
  formatWATTime,
  parseDateTimeLocalAsWAT,
  formatToDateTimeLocalWAT,
} from '../../lib/dateUtils';
import { AdminService } from '../../services/adminService';
import { getStudentPwaUrl } from '../../lib/studentPwaUrl';

interface CourseSessionsTabProps {
  course: Course;
  onSessionUpdated: () => void;
}

export const CourseSessionsTab: React.FC<CourseSessionsTabProps> = ({ course, onSessionUpdated }) => {
  const { user } = useAuth();

  const [sessions, setSessions] = useState<LectureSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newSessionCreated, setNewSessionCreated] = useState<LectureSession | null>(null);

  // Classroom Geofence state
  const [useGeofence, setUseGeofence] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [sessionLat, setSessionLat] = useState<number | ''>('');
  const [sessionLng, setSessionLng] = useState<number | ''>('');
  const [radiusM, setRadiusM] = useState<number>(50);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [detectingLocation, setDetectingLocation] = useState(false);

  const handleCaptureLocation = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setDetectingLocation(true);
    try {
      const readings: GeolocationPosition[] = [];
      // Sample 3 readings to obtain the most accurate GPS fix
      for (let i = 0; i < 3; i++) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 0,
            });
          });
          readings.push(pos);
          if (pos.coords.accuracy <= 5) break; // High accuracy fix obtained early
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          if (readings.length === 0) throw err;
          break;
        }
      }

      readings.sort((a, b) => a.coords.accuracy - b.coords.accuracy);
      const best = readings[0];
      setSessionLat(parseFloat(best.coords.latitude.toFixed(6)));
      setSessionLng(parseFloat(best.coords.longitude.toFixed(6)));
      setLocationAccuracy(Math.round(best.coords.accuracy * 10) / 10);
      setRadiusM(50);
      if (!locationName) setLocationName('Classroom Lecture Hall');
      setUseGeofence(true);
    } catch (err: any) {
      alert('Could not capture location: ' + (err?.message || 'GPS fix timed out'));
    } finally {
      setDetectingLocation(false);
    }
  };

  const [maxDuration, setMaxDuration] = useState(180);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const list = await LecturerService.getCourseSessions(course.id);
      setSessions(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();

    AdminService.getSettings().then(settings => {
      setMaxDuration(settings.max_session_duration_minutes || 180);
      setDurationMinutes(settings.default_session_duration_minutes || 60);
      setGraceMinutes(settings.grace_minutes || 10);
    });

    // Default startsAt to current Africa/Lagos datetime in datetime-local format
    setStartsAt(formatToDateTimeLocalWAT(new Date()));
  }, [course.id]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError('');

    if (!title.trim()) {
      setFormError('Session title or topic is required.');
      return;
    }
    if (!startsAt) {
      setFormError('Start date & time is required.');
      return;
    }

    // Fix QA-22: Reject (never silently clamp) duration > max
    if (durationMinutes > maxDuration) {
      setFormError(
        `Duration of ${durationMinutes} minutes exceeds the institutional limit of ${maxDuration} minutes. Please enter an allowed duration.`
      );
      return;
    }
    if (durationMinutes <= 0) {
      setFormError('Duration must be greater than 0 minutes.');
      return;
    }

    // Parse startsAt explicitly as Africa/Lagos (WAT, UTC+1)
    const isoStartsAt = parseDateTimeLocalAsWAT(startsAt);

    setIsSubmitting(true);
    const res = await LecturerService.createLectureSession(
      course.id,
      {
        title: title.trim(),
        starts_at: isoStartsAt,
        duration_minutes: durationMinutes,
        grace_minutes: graceMinutes,
        latitude: useGeofence && typeof sessionLat === 'number' ? sessionLat : null,
        longitude: useGeofence && typeof sessionLng === 'number' ? sessionLng : null,
        radius_m: useGeofence ? radiusM : 50,
        location_name: useGeofence ? locationName.trim() : null,
      },
      { id: user.id, name: user.name }
    );
    setIsSubmitting(false);

    if (!res.success || !res.session) {
      setFormError(res.error || 'Failed to create session.');
    } else {
      setNewSessionCreated(res.session);
      await loadSessions();
      onSessionUpdated();
    }
  };

  const handleStartNow = async (sessionId: string) => {
    if (!user) return;
    if (window.confirm('Start this lecture session now? It will immediately become live for attendance.')) {
      const res = await LecturerService.startScheduledSessionNow(sessionId, { id: user.id, name: user.name });
      if (res.success) {
        await loadSessions();
        onSessionUpdated();
      } else {
        alert(res.error || 'Failed to start session.');
      }
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    if (!user) return;
    if (window.confirm('Close this lecture session now? Students will no longer be able to submit attendance.')) {
      const res = await LecturerService.closeLectureSession(sessionId, { id: user.id, name: user.name });
      if (res.success) {
        await loadSessions();
        onSessionUpdated();
      } else {
        alert(res.error || 'Failed to close session.');
      }
    }
  };

  // Fix QA-17: Revoke Lecture Session action
  const handleRevokeSession = async (sessionId: string) => {
    if (!user) return;
    if (
      window.confirm(
        'Are you sure you want to REVOKE this lecture session? The session will be permanently locked and flagged as revoked.'
      )
    ) {
      const res = await LecturerService.revokeLectureSession(sessionId, { id: user.id, name: user.name });
      if (res.success) {
        await loadSessions();
        onSessionUpdated();
      } else {
        alert(res.error || 'Failed to revoke session.');
      }
    }
  };

  const handleCopyLink = (session: LectureSession) => {
    const host = getStudentPwaUrl();
    const token = session.raw_token || session.id;
    const joinUrl = `${host}/join/${token}`;
    navigator.clipboard.writeText(joinUrl);
    setCopiedId(session.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Session Action Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Presentation className="w-5 h-5 text-blue-700" />
            <span>Lecture Sessions &amp; Classroom QR Codes</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Create attendance sessions with static high-entropy QR codes. Open Projector Mode on the classroom screen.
          </p>
        </div>

        <button
          onClick={() => {
            setNewSessionCreated(null);
            setCreateModalOpen(true);
          }}
          disabled={course.status === 'archived'}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition shadow-xs cursor-pointer ${
            course.status === 'archived'
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-700 hover:bg-blue-800 text-white active:scale-95'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>New Lecture Session</span>
        </button>
      </div>

      {/* Sessions List */}
      {loading ? (
        <div className="p-12 text-center text-slate-500">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs">Loading sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Presentation}
          title="No Sessions Created for this Course"
          description="Create your first lecture session above to generate an attendance QR code and open Classroom Projector Mode."
          actionText={course.status !== 'archived' ? 'Create Session' : undefined}
          onAction={() => setCreateModalOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sessions.map(session => {
            const nowTime = Date.now();
            const startTime = new Date(session.starts_at).getTime();
            const expireTime = new Date(session.expires_at).getTime();

            // Fix QA-17: Accurate lifecycle state computation
            const isRevoked = session.status === 'revoked';
            const isClosed = session.status === 'closed';
            const isScheduled = !isRevoked && !isClosed && startTime > nowTime;
            const isLive = !isRevoked && !isClosed && nowTime >= startTime && nowTime <= expireTime;
            const isExpired = !isRevoked && !isClosed && nowTime > expireTime;

            return (
              <div
                key={session.id}
                className={`bg-white rounded-2xl border p-5 shadow-xs flex flex-col transition ${
                  isLive
                    ? 'border-emerald-400 ring-2 ring-emerald-500/15'
                    : isRevoked
                    ? 'border-rose-300 bg-rose-50/20'
                    : isScheduled
                    ? 'border-blue-300'
                    : 'border-slate-200 opacity-95'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                      {course.code}
                    </span>
                    <h4 className="text-base font-bold text-slate-900 mt-1 line-clamp-1">
                      {session.title}
                    </h4>
                  </div>

                  {/* Fix QA-17: Standardized lifecycle badges */}
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${
                      isLive
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse'
                        : isScheduled
                        ? 'bg-blue-100 text-blue-800 border border-blue-200'
                        : isRevoked
                        ? 'bg-rose-100 text-rose-800 border border-rose-300'
                        : isClosed
                        ? 'bg-slate-800 text-slate-100 border border-slate-900'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {isLive
                      ? 'Active Live'
                      : isScheduled
                      ? 'Scheduled'
                      : isRevoked
                      ? 'Revoked'
                      : isClosed
                      ? 'Closed'
                      : 'Expired'}
                  </span>
                </div>

                {/* Session Timings & Metadata */}
                <div className="space-y-1.5 my-3 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      Starts (WAT):
                    </span>
                    <span className="font-semibold text-slate-800">
                      {formatWATDate(session.starts_at)} at {formatWATTime(session.starts_at)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      Duration &amp; Grace:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {session.duration_minutes} min &bull; {session.grace_minutes}m grace
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      Attendance:
                    </span>
                    <span className="font-bold text-blue-900">
                      {session.attendance_count || 0} students recorded
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      Classroom Geofence:
                    </span>
                    {session.latitude && session.longitude ? (
                      <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px]">
                        {session.location_name || 'Classroom'} (&plusmn;{session.radius_m || 50}m)
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[11px]">
                        Campus Boundary (Fallback)
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions per state (Fix QA-17) */}
                <div className="mt-auto pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {/* Projector View (always available unless revoked) */}
                    {!isRevoked && (
                      <Link
                        to={`/lecturer/projector/${session.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs transition shadow-2xs"
                      >
                        <Presentation className="w-3.5 h-3.5" />
                        <span>Projector Mode</span>
                      </Link>
                    )}

                    {!isRevoked && !isClosed && (
                      <button
                        onClick={() => handleCopyLink(session)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                        title="Copy student join link"
                      >
                        {copiedId === session.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Link</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Scheduled actions: Start Now + Cancel/Close */}
                    {isScheduled && (
                      <>
                        <button
                          onClick={() => handleStartNow(session.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition cursor-pointer"
                          title="Start session now"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Start Now</span>
                        </button>

                        <button
                          onClick={() => handleCloseSession(session.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer"
                          title="Cancel session"
                        >
                          <span>Cancel</span>
                        </button>
                      </>
                    )}

                    {/* Active actions: End + Revoke */}
                    {isLive && (
                      <>
                        <button
                          onClick={() => handleCloseSession(session.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-amber-700 hover:bg-amber-50 text-xs font-semibold transition cursor-pointer"
                          title="End session"
                        >
                          <PowerOff className="w-3.5 h-3.5" />
                          <span>End</span>
                        </button>

                        <button
                          onClick={() => handleRevokeSession(session.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                          title="Revoke session"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Session Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            {!newSessionCreated ? (
              <>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
                  Create Lecture Session
                </h3>
                <p className="text-xs text-slate-500 mb-5">
                  Set up a lecture session for <span className="font-bold text-blue-900">{course.code}</span>. A high-entropy static QR code and join link will be created.
                </p>

                {formError && (
                  <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleCreateSession} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Lecture Topic / Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Week 4: Symmetric Encryption & Public Key Infra"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Session Starts At (WAT / Lagos) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={startsAt}
                      onChange={e => setStartsAt(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm font-medium"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Time is interpreted in West Africa Time (WAT, UTC+1). Setting a future time marks the session as Scheduled.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Duration (Minutes)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={maxDuration}
                        required
                        value={durationMinutes}
                        onChange={e => setDurationMinutes(parseInt(e.target.value, 10) || 0)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm font-semibold"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Max allowed: {maxDuration} mins
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Late Grace Period (Mins)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={durationMinutes}
                        required
                        value={graceMinutes}
                        onChange={e => setGraceMinutes(parseInt(e.target.value, 10) || 0)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm font-semibold"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Signed after this: marked Late
                      </span>
                    </div>
                  </div>

                  {/* Classroom Location Geofence Section */}
                  <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-700 shrink-0" />
                        <div>
                          <span className="text-xs font-bold text-slate-900 block">Classroom Location Geofence</span>
                          <span className="text-[11px] text-slate-500 block">Enforce 50m classroom boundary for student check-in</span>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useGeofence}
                          onChange={e => setUseGeofence(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {useGeofence && (
                      <div className="space-y-3 pt-2 border-t border-blue-100">
                        {/* Capture Location Button & Accuracy Badge */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={handleCaptureLocation}
                            disabled={detectingLocation}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>{detectingLocation ? 'Sampling 3 GPS Readings...' : 'Capture My Current Location'}</span>
                          </button>

                          {sessionLat !== '' && sessionLng !== '' && (
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>
                                Lat: {sessionLat}, Lng: {sessionLng}
                                {locationAccuracy !== null ? ` (±${locationAccuracy}m accuracy)` : ''}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Optional Classroom / Hall Name */}
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Classroom / Hall Name (Optional)
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. Science Complex Lecture Theatre 2"
                            value={locationName}
                            onChange={e => setLocationName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        {/* Radius Selector & Manual PC Coordinates */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                              Radius Selector
                            </label>
                            <select
                              value={radiusM}
                              onChange={e => setRadiusM(parseInt(e.target.value, 10) || 50)}
                              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                            >
                              <option value={30}>30 meters (Tight Room)</option>
                              <option value={50}>50 meters (Default Classroom)</option>
                              <option value={75}>75 meters (Auditorium)</option>
                              <option value={100}>100 meters (Amphitheater)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                              Latitude (Manual)
                            </label>
                            <input
                              type="number"
                              step="any"
                              placeholder="e.g. 6.111800"
                              value={sessionLat}
                              onChange={e => setSessionLat(e.target.value === '' ? '' : parseFloat(e.target.value))}
                              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                              Longitude (Manual)
                            </label>
                            <input
                              type="number"
                              step="any"
                              placeholder="e.g. 6.601100"
                              value={sessionLng}
                              onChange={e => setSessionLng(e.target.value === '' ? '' : parseFloat(e.target.value))}
                              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                            />
                          </div>
                        </div>

                        <p className="text-[10px] text-slate-500 italic">
                          If creating a session on a desktop PC without GPS, enter the classroom coordinates manually above.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3">
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(false)}
                      className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmitting ? 'Creating...' : 'Create Lecture Session'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-1">
                  Session Ready!
                </h3>
                <p className="text-xs text-slate-500 mb-6 max-w-sm mx-auto">
                  Static high-entropy token generated. Launch Classroom Projector view to display the QR code.
                </p>

                <div className="flex flex-col gap-3">
                  <Link
                    to={`/lecturer/projector/${newSessionCreated.id}`}
                    className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center justify-center gap-2"
                  >
                    <Presentation className="w-4 h-4" />
                    <span>Open Classroom Projector View</span>
                  </Link>
                  <button
                    onClick={() => {
                      setCreateModalOpen(false);
                      setNewSessionCreated(null);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer py-1"
                  >
                    Close Dialog
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
