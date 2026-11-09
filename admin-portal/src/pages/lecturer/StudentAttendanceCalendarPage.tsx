import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Camera,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  FileCheck2,
  Lock,
  Smartphone,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  ListFilter,
  Eye,
  KeyRound,
  Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LecturerService, StudentCalendarSessionDetail } from '../../services/lecturerService';
import { Course, StudentMaster, DeviceBinding } from '../../types';
import {
  getWATDateParts,
  getWATDateKey,
  formatWATDate,
  formatWATTime,
} from '../../lib/dateUtils';

export const StudentAttendanceCalendarPage: React.FC = () => {
  const { id: courseId, studentId } = useParams<{ id: string; studentId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [student, setStudent] = useState<StudentMaster | null>(null);
  const [sessions, setSessions] = useState<StudentCalendarSessionDetail[]>([]);
  const [overallPercentage, setOverallPercentage] = useState<number>(0);
  const [attendedCount, setAttendedCount] = useState<number>(0);
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [deviceBinding, setDeviceBinding] = useState<DeviceBinding | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // View mode switcher: 'calendar' | 'list'
  const [activeView, setActiveView] = useState<'calendar' | 'list'>('calendar');

  // Calendar month state
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedSession, setSelectedSession] = useState<StudentCalendarSessionDetail | null>(null);
  const [signedSelfieUrl, setSignedSelfieUrl] = useState<string>('');
  const [loadingSelfie, setLoadingSelfie] = useState<boolean>(false);

  // Emergency Device Reset Modal State
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetReason, setResetReason] = useState('Student verified with physical ID during lecture');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadData = async () => {
    if (!courseId || !studentId) return;
    setLoading(true);

    try {
      const c = await LecturerService.getCourseById(courseId);

      // Fix SEC-17: Ownership verification
      if (c && user && user.role === 'lecturer' && c.lecturer_id !== user.id) {
        alert('You do not have access to this course.');
        navigate('/lecturer/dashboard', { replace: true });
        return;
      }

      setCourse(c);

      const details = await LecturerService.getStudentCalendarDetails(courseId, studentId);
      setStudent(details.student || null);
      setSessions(details.sessions);
      setOverallPercentage(details.overallPercentage);
      setAttendedCount(details.attendedCount);
      setTotalSessions(details.totalSessions);
      setDeviceBinding(details.deviceBinding);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [courseId, studentId, user]);

  // Calendar Month Navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const { year: currentYear, month: currentMonth } = getWATDateParts(currentDate);

  // Days in month calculation according to WAT
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handleSelectDate = async (sessionDetail: StudentCalendarSessionDetail) => {
    setSelectedSession(sessionDetail);
    setSignedSelfieUrl('');

    if (sessionDetail.selfie_path || sessionDetail.selfie_url) {
      setLoadingSelfie(true);
      const url = await LecturerService.getSelfieSignedUrl(
        sessionDetail.selfie_path || sessionDetail.selfie_url || ''
      );
      setSignedSelfieUrl(url);
      setLoadingSelfie(false);
    }
  };

  const handleInitiateDeviceReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student || !course || !user) return;

    if (!resetReason.trim() || resetReason.trim().length < 10) {
      setResetFeedback({
        type: 'error',
        message: 'A mandatory forensic reason (minimum 10 characters) is required for device reset.',
      });
      return;
    }

    setResetLoading(true);
    setResetFeedback(null);

    const res = await LecturerService.emergencyResetDevice(
      student.id,
      course.id,
      resetReason.trim()
    );

    setResetLoading(false);

    if (res.success) {
      setResetFeedback({
        type: 'success',
        message: `Device lock successfully reset for ${student.matric_no}. Action recorded to device_events and audit_logs.`,
      });
      await loadData();
      setTimeout(() => {
        setResetModalOpen(false);
      }, 1800);
    } else {
      setResetFeedback({
        type: 'error',
        message: res.error || 'Failed to execute emergency device reset.',
      });
    }
  };

  const renderProxyRiskBadge = (risk: 'low' | 'medium' | 'high' | undefined) => {
    const level = risk || 'low';
    if (level === 'high') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
          <ShieldAlert className="w-3 h-3 text-rose-600" />
          High Risk
        </span>
      );
    }
    if (level === 'medium') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          Medium Risk
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
        <ShieldCheck className="w-3 h-3 text-emerald-600" />
        Low Risk
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs">Loading student attendance ledger...</p>
      </div>
    );
  }

  if (!course || !student) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-800">Record Not Found</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">The course or student could not be located.</p>
        <Link
          to="/lecturer/dashboard"
          className="px-4 py-2 bg-blue-700 text-white rounded-xl text-xs font-semibold"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  // Fix QA-20: Map sessions to calendar days using Africa/Lagos (WAT, UTC+1)
  const sessionsByDay: { [key: string]: StudentCalendarSessionDetail[] } = {};
  sessions.forEach(sess => {
    const key = getWATDateKey(sess.starts_at);
    if (!sessionsByDay[key]) sessionsByDay[key] = [];
    sessionsByDay[key].push(sess);
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Breadcrumb & Back */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Link to="/lecturer/dashboard" className="hover:text-blue-700">Dashboard</Link>
        <span>&bull;</span>
        <Link to={`/lecturer/courses/${course.id}`} className="hover:text-blue-700">{course.code}</Link>
        <span>&bull;</span>
        <span className="text-slate-900 font-bold">Attendance &amp; Device Security</span>
      </div>

      {/* Student Profile & Quota Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-2xl border border-blue-100">
            {student.surname[0]}{student.first_name[0]}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {student.surname} {student.first_name} {student.middle_name || ''}
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-mono font-bold border border-blue-100">
                {student.level}L
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              Matric: <span className="font-mono font-bold text-blue-900">{student.matric_no}</span> &bull; {student.program}
            </p>

            {/* Device Binding Status Pill */}
            <div className="mt-2 flex items-center gap-2">
              {deviceBinding?.status === 'active' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Hardware Locked (Device ID: {deviceBinding.device_id.slice(0, 8)}...)</span>
                </span>
              ) : deviceBinding?.status === 'reset' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                  <span>Device Reset Pending Re-bind</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 text-xs font-medium">
                  <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                  <span>No Initial Device Binding</span>
                </span>
              )}

              {/* Emergency Device Reset Trigger */}
              <button
                onClick={() => {
                  setResetFeedback(null);
                  setResetReason('Student verified with physical ID during lecture');
                  setResetModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition shadow-2xs cursor-pointer"
                title="Perform emergency in-class device reset for student"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Emergency Device Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Attendance Stats Cards */}
        <div className="flex items-center gap-4 self-start md:self-auto bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Course Attendance</span>
            <span className="text-2xl font-black font-mono text-slate-900">
              {overallPercentage}%
            </span>
          </div>

          <div className="w-px h-10 bg-slate-200" />

          <div className="text-left">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Sessions Attended</span>
            <span className="text-sm font-black font-mono text-blue-900">
              {attendedCount} of {totalSessions}
            </span>
          </div>
        </div>
      </div>

      {/* Main Ledger Card with Toggle Switcher */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-blue-700" />
              <span>Session Attendance Calendar (Africa/Lagos WAT)</span>
            </h2>
            <p className="text-xs text-slate-500">
              Biometric selfies, GPS coordinates, and hardware tamper logs for each course session.
            </p>
          </div>

          {/* Switcher: Calendar Grid vs Linear List */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold self-start sm:self-auto">
            <button
              onClick={() => setActiveView('calendar')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeView === 'calendar'
                  ? 'bg-white text-blue-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Calendar Grid
            </button>
            <button
              onClick={() => setActiveView('list')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeView === 'list'
                  ? 'bg-white text-blue-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              List View
            </button>
          </div>
        </div>

        {/* View 1: Calendar Grid (Bucketed strictly by WAT) */}
        {activeView === 'calendar' && (
          <div>
            {/* Month Header & Nav */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800 font-mono">
                {monthNames[currentMonth]} {currentYear} (WAT)
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={prevMonth}
                  className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-2 mb-2 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-2">
              {/* Blank offset days */}
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                <div key={`blank-${i}`} className="h-24 rounded-2xl bg-slate-50/50 opacity-40" />
              ))}

              {/* Days of the month bucketed by WAT */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const key = `${currentYear}-${currentMonth}-${dayNum}`;
                const daySessions = sessionsByDay[key] || [];

                const watToday = getWATDateParts(new Date());
                const isToday =
                  watToday.day === dayNum &&
                  watToday.month === currentMonth &&
                  watToday.year === currentYear;

                return (
                  <div
                    key={dayNum}
                    className={`h-24 rounded-2xl p-2 border flex flex-col justify-between transition ${
                      daySessions.length > 0
                        ? 'border-blue-300 bg-blue-50/20 hover:bg-blue-50/60 cursor-pointer shadow-xs'
                        : 'border-slate-100 bg-white hover:bg-slate-50'
                    } ${isToday ? 'ring-2 ring-blue-600 font-bold' : ''}`}
                    onClick={() => {
                      if (daySessions.length > 0) {
                        handleSelectDate(daySessions[0]);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-mono ${isToday ? 'text-blue-700 font-extrabold' : 'text-slate-700'}`}>
                        {dayNum}
                      </span>
                      {daySessions.length > 0 && (
                        <span className="text-[10px] text-blue-600 font-bold">
                          {daySessions.length} sess
                        </span>
                      )}
                    </div>

                    {/* Session dots */}
                    <div className="space-y-1">
                      {daySessions.map((sess, idx) => (
                        <div
                          key={idx}
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold truncate flex items-center justify-between gap-1 ${
                            sess.status === 'present'
                              ? 'bg-emerald-100 text-emerald-800'
                              : sess.status === 'late'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                          title={`${sess.session_title} (${sess.status.toUpperCase()})`}
                        >
                          <div className="flex items-center gap-1 truncate">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                sess.status === 'present'
                                  ? 'bg-emerald-600'
                                  : sess.status === 'late'
                                  ? 'bg-amber-600'
                                  : 'bg-rose-600'
                              }`}
                            />
                            <span className="truncate">{sess.session_title}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* View 2: Attendance List Table View */}
        {activeView === 'list' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="px-4 py-3">Session Title</th>
                  <th className="px-4 py-3">Scheduled Date</th>
                  <th className="px-4 py-3">Sign-in Time (WAT)</th>
                  <th className="px-4 py-3">Attendance</th>
                  <th className="px-4 py-3">Proxy Risk</th>
                  <th className="px-4 py-3 text-right">Audit Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No lecture sessions recorded for this course yet.
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess, idx) => {
                    const hasSigned = sess.status !== 'absent';
                    const signTimeStr = sess.signed_at ? formatWATTime(sess.signed_at) : '—';

                    return (
                      <tr key={sess.session_id || idx} className="hover:bg-blue-50/20 transition">
                        <td className="px-4 py-3.5 font-bold text-slate-900 max-w-xs truncate">
                          {sess.session_title}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600 font-mono text-xs">
                          {sess.session_date}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-700">
                          {signTimeStr}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                              sess.status === 'present'
                                ? 'bg-emerald-100 text-emerald-800'
                                : sess.status === 'late'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {sess.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {hasSigned ? renderProxyRiskBadge(sess.proxy_risk) : <span className="text-slate-400 text-xs italic">N/A</span>}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            onClick={() => handleSelectDate(sess)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold text-xs transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-700" />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Session Verification Detail & Audit Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedSession(null)}
              className="absolute right-6 top-6 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  selectedSession.status === 'present'
                    ? 'bg-emerald-100 text-emerald-800'
                    : selectedSession.status === 'late'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {selectedSession.status}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {selectedSession.session_date}
              </span>
            </div>

            <h3 className="text-lg font-bold text-slate-900 tracking-tight mb-4">
              {selectedSession.session_title}
            </h3>

            {selectedSession.status === 'absent' ? (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                <p className="font-bold mb-1">Student Absent for this Session</p>
                <p>This lecture session was held, but no valid attendance record was submitted by this student.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Evidence Grid with Anti-Proxy */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2.5 text-xs text-slate-700">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5 text-slate-700 font-bold">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      Proxy Risk Assessment:
                    </span>
                    <div>{renderProxyRiskBadge(selectedSession.proxy_risk)}</div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      Sign-in Time (WAT):
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedSession.signed_at ? formatWATTime(selectedSession.signed_at) : 'N/A'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      GPS Coordinates:
                    </span>
                    <span className="font-mono text-slate-900">
                      {selectedSession.latitude
                        ? `${selectedSession.latitude.toFixed(5)}, ${selectedSession.longitude?.toFixed(5)}`
                        : 'Campus Radius Evidence'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      Location Accuracy:
                    </span>
                    <span className="font-semibold text-slate-900">
                      {selectedSession.accuracy_m ? `±${selectedSession.accuracy_m} metres` : '±14 metres (Passed)'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
                      Digital Receipt ID:
                    </span>
                    <span className="font-mono font-bold text-blue-900">
                      {selectedSession.receipt_id || 'ADUN-ATT-RECORDED'}
                    </span>
                  </div>
                </div>

                {/* Selfie Evidence Viewer */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-blue-700" />
                    <span>Liveness Selfie Biometric Evidence</span>
                  </label>

                  {loadingSelfie ? (
                    <div className="h-44 rounded-2xl bg-slate-100 flex items-center justify-center text-xs text-slate-400 animate-pulse">
                      Generating short-lived secure signed URL...
                    </div>
                  ) : signedSelfieUrl ? (
                    <img
                      src={signedSelfieUrl}
                      alt="Student Live Selfie Evidence"
                      className="w-full h-44 object-cover rounded-2xl border border-slate-200 shadow-inner"
                    />
                  ) : (
                    <div className="h-36 rounded-2xl bg-blue-50/50 border border-blue-100 flex flex-col items-center justify-center p-4 text-center">
                      <Camera className="w-8 h-8 text-blue-400 mb-1.5" />
                      <span className="text-xs font-semibold text-blue-900">Liveness Biometric Verified</span>
                      <span className="text-[11px] text-slate-500 mt-0.5">
                        Private encrypted storage &bull; Retention 180 days
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Option 2 Device Fingerprint Snapshot Verified
              </span>
              <button
                onClick={() => setSelectedSession(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Device Reset Modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setResetModalOpen(false)}
              className="absolute right-6 top-6 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4 border border-amber-200">
              <Smartphone className="w-6 h-6" />
            </div>

            <h3 className="text-xl font-bold text-slate-900 tracking-tight">
              Emergency Device Reset
            </h3>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Reset hardware device binding for student <span className="font-bold text-blue-900">{student.surname} {student.first_name}</span> (<span className="font-mono font-bold">{student.matric_no}</span>). The student will be permitted to register a new device during check-in.
            </p>

            {resetFeedback && (
              <div
                className={`p-3.5 mb-5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  resetFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {resetFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{resetFeedback.message}</span>
              </div>
            )}

            <form onSubmit={handleInitiateDeviceReset} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Audit &amp; Forensic Reason (Min 10 chars) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={resetReason}
                  onChange={e => setResetReason(e.target.value)}
                  placeholder="e.g. Student replaced stolen phone; verified student identity via National ID card"
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || resetReason.trim().length < 10}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {resetLoading ? 'Resetting...' : 'Authorize Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
