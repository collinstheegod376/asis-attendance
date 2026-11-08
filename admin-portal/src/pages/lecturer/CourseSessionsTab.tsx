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
  ShieldCheck,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { AppStorage } from '../../lib/storage';
import { Course, LectureSession } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/common/EmptyState';

interface CourseSessionsTabProps {
  course: Course;
  onSessionUpdated: () => void;
}

export const CourseSessionsTab: React.FC<CourseSessionsTabProps> = ({ course, onSessionUpdated }) => {
  const { user } = useAuth();

  const [sessions, setSessions] = useState<LectureSession[]>([]);
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

  const settings = AppStorage.getSettings();
  const maxDuration = settings.max_session_duration_minutes || 180;
  const defaultDuration = settings.default_session_duration_minutes || 60;
  const defaultGrace = settings.grace_minutes || 10;

  const loadSessions = () => {
    const list = LecturerService.getCourseSessions(course.id);
    setSessions(list);
  };

  useEffect(() => {
    loadSessions();
    // Default startsAt to current local datetime
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setStartsAt(now.toISOString().slice(0, 16));
    setDurationMinutes(defaultDuration);
    setGraceMinutes(defaultGrace);
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
    if (durationMinutes <= 0 || durationMinutes > maxDuration) {
      setFormError(`Duration must be between 1 and ${maxDuration} minutes.`);
      return;
    }

    setIsSubmitting(true);
    const res = await LecturerService.createLectureSession(
      course.id,
      {
        title: title.trim(),
        starts_at: new Date(startsAt).toISOString(),
        duration_minutes: durationMinutes,
        grace_minutes: graceMinutes,
      },
      { id: user.id, name: user.name }
    );
    setIsSubmitting(false);

    if (!res.success || !res.session) {
      setFormError(res.error || 'Failed to create session.');
    } else {
      setNewSessionCreated(res.session);
      loadSessions();
      onSessionUpdated();
    }
  };

  const handleCloseSession = (sessionId: string) => {
    if (!user) return;
    if (window.confirm('Close this lecture session now? Students will no longer be able to submit attendance.')) {
      const res = LecturerService.closeLectureSession(sessionId, { id: user.id, name: user.name });
      if (res.success) {
        loadSessions();
        onSessionUpdated();
      }
    }
  };

  const handleCopyLink = (session: LectureSession) => {
    const host = window.location.origin.includes('localhost') 
      ? window.location.origin.replace(':5174', ':5173')
      : window.location.origin;
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
            <span>Lecture Sessions & Classroom QR Codes</span>
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
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition shadow-xs ${
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
      {sessions.length === 0 ? (
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
            const startDate = new Date(session.starts_at);
            const lagosDate = startDate.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
            const lagosTime = startDate.toLocaleTimeString('en-GB', { 
              timeZone: 'Africa/Lagos', 
              hour: '2-digit', 
              minute: '2-digit' 
            });

            const isExpired = new Date().getTime() > new Date(session.expires_at).getTime();
            const isActive = session.status === 'active' && !isExpired;

            return (
              <div
                key={session.id}
                className={`bg-white rounded-2xl border p-5 shadow-xs flex flex-col transition ${
                  isActive ? 'border-blue-400 ring-2 ring-blue-500/10' : 'border-slate-200 opacity-95'
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

                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse'
                      : session.status === 'closed'
                      ? 'bg-slate-100 text-slate-500 border border-slate-200'
                      : 'bg-rose-50 text-rose-600 border border-rose-200'
                  }`}>
                    {isActive ? 'Active Live' : session.status === 'closed' ? 'Closed' : 'Expired'}
                  </span>
                </div>

                {/* Session Timings & Metadata */}
                <div className="space-y-1.5 my-3 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      Scheduled:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {lagosDate} at {lagosTime} (WAT)
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      Duration & Grace:
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
                </div>

                {/* Actions */}
                <div className="mt-auto pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/lecturer/projector/${session.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs transition shadow-2xs"
                    >
                      <Presentation className="w-3.5 h-3.5" />
                      <span>Projector Mode</span>
                    </Link>

                    <button
                      onClick={() => handleCopyLink(session)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
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
                  </div>

                  {isActive && (
                    <button
                      onClick={() => handleCloseSession(session.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition"
                      title="Close and end session early"
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      <span>End</span>
                    </button>
                  )}
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
                        value={durationMinutes}
                        onChange={e => setDurationMinutes(parseInt(e.target.value) || 60)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Admin maximum: {maxDuration} mins
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Grace Period (Mins)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={graceMinutes}
                        onChange={e => setGraceMinutes(parseInt(e.target.value) || 10)}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        After grace: marked Late
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 flex items-start gap-2 text-[11px] text-blue-900">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <span>
                      High-entropy cryptographic token generated server-side. Static QR code does not rotate during class.
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3">
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(false)}
                      className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition shadow-xs flex items-center gap-1.5"
                    >
                      {isSubmitting ? 'Creating...' : 'Create & Generate QR'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              /* Success & Launch Projector Dialog */
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight mb-1">
                  Session Created Successfully!
                </h3>
                <p className="text-xs text-slate-500 mb-6 max-w-sm mx-auto">
                  "{newSessionCreated.title}" is now active. Launch Classroom Projector Mode to project the scannable code on the lecture hall screen.
                </p>

                <div className="flex flex-col gap-3">
                  <Link
                    to={`/lecturer/projector/${newSessionCreated.id}`}
                    className="w-full py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm transition shadow-md flex items-center justify-center gap-2"
                  >
                    <Presentation className="w-4 h-4" />
                    <span>Launch Classroom Projector Mode</span>
                  </Link>

                  <button
                    onClick={() => {
                      setNewSessionCreated(null);
                      setCreateModalOpen(false);
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
                  >
                    View Sessions List
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
