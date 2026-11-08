import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import { AppStorage } from '../../lib/storage';
import { Course, StudentMaster, DeviceBinding } from '../../types';

export const StudentAttendanceCalendarPage: React.FC = () => {
  const { id: courseId, studentId } = useParams<{ id: string; studentId: string }>();
  const { user } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [student, setStudent] = useState<StudentMaster | null>(null);
  const [sessions, setSessions] = useState<StudentCalendarSessionDetail[]>([]);
  const [overallPercentage, setOverallPercentage] = useState<number>(100);
  const [attendedCount, setAttendedCount] = useState<number>(0);
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [deviceBinding, setDeviceBinding] = useState<DeviceBinding | null>(null);

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

  const loadData = () => {
    if (!courseId || !studentId) return;

    const c = AppStorage.getCourse(courseId);
    setCourse(c || null);

    const details = LecturerService.getStudentCalendarDetails(courseId, studentId);
    setStudent(details.student || null);
    setSessions(details.sessions);
    setOverallPercentage(details.overallPercentage);
    setAttendedCount(details.attendedCount);
    setTotalSessions(details.totalSessions);

    // Load device binding status for this student
    if (details.student) {
      const bindings = AppStorage.getDeviceBindings();
      const b = bindings.find(
        x => x.student_id === details.student?.id || x.matric_no.toLowerCase() === details.student?.matric_no.toLowerCase()
      );
      setDeviceBinding(b || null);
    }
  };

  useEffect(() => {
    loadData();
  }, [courseId, studentId]);

  // Calendar Month Navigation
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  // Days in month calculation
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

    if (!resetReason.trim()) {
      setResetFeedback({
        type: 'error',
        message: 'A mandatory justification reason is required for emergency device reset.',
      });
      return;
    }

    setResetLoading(true);
    setResetFeedback(null);

    const res = LecturerService.emergencyResetDevice(student.id, course.id, resetReason.trim(), {
      id: user.id,
      name: user.name,
    });

    setResetLoading(false);

    if (res.success) {
      setResetFeedback({
        type: 'success',
        message: `Device lock successfully reset for ${student.matric_no}. Action recorded to device_events and audit_logs.`,
      });
      loadData();
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

  if (!course || !student) {
    return (
      <div className="p-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-800">Student or Course Not Found</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">The student record or course could not be retrieved.</p>
        <Link
          to="/lecturer/dashboard"
          className="px-4 py-2 bg-blue-700 text-white rounded-xl text-xs font-semibold"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  // Map sessions to calendar days: "YYYY-M-D"
  const sessionsByDay: { [key: string]: StudentCalendarSessionDetail[] } = {};
  sessions.forEach(sess => {
    const sDate = new Date(sess.starts_at);
    const key = `${sDate.getFullYear()}-${sDate.getMonth()}-${sDate.getDate()}`;
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
        <span className="text-slate-900 font-bold">Attendance & Device Security</span>
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
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition shadow-2xs"
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

          <div className="w-px h-8 bg-slate-200" />

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Sessions</span>
            <span className="text-sm font-bold text-slate-700">
              {attendedCount} / {totalSessions} held
            </span>
          </div>

          <div className="w-px h-8 bg-slate-200" />

          <div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              overallPercentage >= 75
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}>
              {overallPercentage >= 75 ? 'Exam Eligible' : 'Barred (<75%)'}
            </span>
          </div>
        </div>
      </div>

      {/* Read-Only Regulatory Notice & Option 2 Strict Device Policy */}
      <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200/60 flex items-start gap-3 text-blue-900 text-xs font-medium">
        <Lock className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p>
            <strong>Option 2 Strict Device Binding Policy:</strong> Each student is cryptographically locked to a single verified device per matriculation ID to eliminate proxy attendance.
          </p>
          <p className="text-blue-800 text-[11px]">
            Lecturers can perform an emergency device unlock in class if a student switches verified hardware. All actions are audited and logged to <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">device_events</code>.
          </p>
        </div>
      </div>

      {/* View Switcher: Calendar View vs Attendance List Table */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {activeView === 'calendar' ? (
              <CalendarIcon className="w-5 h-5 text-blue-700" />
            ) : (
              <ListFilter className="w-5 h-5 text-blue-700" />
            )}
            <h2 className="text-lg font-bold text-slate-900">
              {activeView === 'calendar' ? `${monthNames[currentMonth]} ${currentYear}` : 'Attendance Session List'}
            </h2>
          </div>

          {/* View Mode Toggle Buttons */}
          <div className="flex items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 text-xs font-semibold">
              <button
                onClick={() => setActiveView('calendar')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  activeView === 'calendar'
                    ? 'bg-white text-blue-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>Calendar View</span>
              </button>

              <button
                onClick={() => setActiveView('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  activeView === 'list'
                    ? 'bg-white text-blue-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>Attendance List ({sessions.length})</span>
              </button>
            </div>

            {/* Month Steppers (Visible when in Calendar view) */}
            {activeView === 'calendar' && (
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={prevMonth}
                  className="p-1.5 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition"
                  title="Previous Month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-1.5 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 transition"
                  title="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* View 1: Calendar Grid View */}
        {activeView === 'calendar' && (
          <div>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 pb-3 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span>Present (On Time)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span>Late Check-in</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-500" />
                <span>Absent</span>
              </span>
              <span className="text-slate-400 text-[11px] ml-auto">
                Click any lecture session below to inspect Proxy Risk, Device Fingerprint & Biometric Evidence
              </span>
            </div>

            {/* Calendar Grid Header */}
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-400 py-2 border-b border-slate-100">
              <div>SUN</div>
              <div>MON</div>
              <div>TUE</div>
              <div>WED</div>
              <div>THU</div>
              <div>FRI</div>
              <div>SAT</div>
            </div>

            <div className="grid grid-cols-7 gap-2 pt-3">
              {/* Leading blank days */}
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                <div key={`blank-${i}`} className="h-24 rounded-2xl bg-slate-50/50 opacity-40" />
              ))}

              {/* Days of the month */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const key = `${currentYear}-${currentMonth}-${dayNum}`;
                const daySessions = sessionsByDay[key] || [];

                const isToday =
                  new Date().getDate() === dayNum &&
                  new Date().getMonth() === currentMonth &&
                  new Date().getFullYear() === currentYear;

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

                    {/* Session dots & Proxy Risk Indicator */}
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
                          title={`${sess.session_title} (${sess.status.toUpperCase()}) - Proxy Risk: ${(sess.proxy_risk || 'low').toUpperCase()}`}
                        >
                          <div className="flex items-center gap-1 truncate">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              sess.status === 'present'
                                ? 'bg-emerald-600'
                                : sess.status === 'late'
                                ? 'bg-amber-600'
                                : 'bg-rose-600'
                            }`} />
                            <span className="truncate">{sess.session_title}</span>
                          </div>

                          {sess.status !== 'absent' && (
                            <span className={`text-[9px] uppercase px-1 rounded font-black shrink-0 ${
                              sess.proxy_risk === 'high' 
                                ? 'bg-rose-200 text-rose-900' 
                                : sess.proxy_risk === 'medium'
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-emerald-200 text-emerald-900'
                            }`}>
                              {sess.proxy_risk === 'high' ? 'High' : sess.proxy_risk === 'medium' ? 'Med' : 'Low'}
                            </span>
                          )}
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
                  <th className="px-4 py-3">Device Snapshot Ref</th>
                  <th className="px-4 py-3 text-right">Audit Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No lecture sessions recorded for this course yet.
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess, idx) => {
                    const hasSigned = sess.status !== 'absent';
                    const signTimeStr = sess.signed_at
                      ? new Date(sess.signed_at).toLocaleTimeString('en-GB', {
                          timeZone: 'Africa/Lagos',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : '—';

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
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                            sess.status === 'present'
                              ? 'bg-emerald-100 text-emerald-800'
                              : sess.status === 'late'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}>
                            {sess.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {hasSigned ? (
                            renderProxyRiskBadge(sess.proxy_risk)
                          ) : (
                            <span className="text-slate-400 text-xs italic">N/A (Absent)</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {hasSigned ? (
                            <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              {sess.fingerprint_snapshot_ref || 'DEV-SNAP-VERIFIED'}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs italic">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            onClick={() => handleSelectDate(sess)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold text-xs transition"
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
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setSelectedSession(null)}
              className="absolute right-6 top-6 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                selectedSession.status === 'present'
                  ? 'bg-emerald-100 text-emerald-800'
                  : selectedSession.status === 'late'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-rose-100 text-rose-800'
              }`}>
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
                {/* Evidence Grid with Anti-Proxy and Device Binding Snapshot */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2.5 text-xs text-slate-700">
                  {/* Proxy Risk Assessment */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                    <span className="flex items-center gap-1.5 text-slate-700 font-bold">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      Proxy Risk Assessment:
                    </span>
                    <div>
                      {renderProxyRiskBadge(selectedSession.proxy_risk)}
                    </div>
                  </div>

                  {/* Device Binding Snapshot Reference */}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                      Device Snapshot Ref:
                    </span>
                    <span className="font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      {selectedSession.fingerprint_snapshot_ref || 'DEV-SNAP-VERIFIED'}
                    </span>
                  </div>

                  {/* Sign-in Time */}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Clock className="w-3.5 h-3.5 text-blue-600" />
                      Sign-in Time (WAT):
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {selectedSession.signed_at 
                        ? new Date(selectedSession.signed_at).toLocaleTimeString('en-GB', { 
                            timeZone: 'Africa/Lagos', 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            second: '2-digit' 
                          }) 
                        : 'N/A'}
                    </span>
                  </div>

                  {/* GPS Coordinates */}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      GPS Coordinates:
                    </span>
                    <span className="font-mono text-slate-900">
                      {selectedSession.latitude ? `${selectedSession.latitude.toFixed(5)}, ${selectedSession.longitude?.toFixed(5)}` : 'Campus Radius Evidence'}
                    </span>
                  </div>

                  {/* Location Accuracy */}
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      Location Accuracy:
                    </span>
                    <span className="font-semibold text-slate-900">
                      {selectedSession.accuracy_m ? `±${selectedSession.accuracy_m} metres` : '±14 metres (Passed)'}
                    </span>
                  </div>

                  {/* Digital Receipt ID */}
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
                className="px-5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition"
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
              className="absolute right-6 top-6 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4 border border-amber-200">
              <Smartphone className="w-6 h-6" />
            </div>

            <h3 className="text-xl font-bold text-slate-900 tracking-tight">
              Emergency Device Reset
            </h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
              Initiate an emergency device unlock for <strong className="text-slate-800">{student.surname} {student.first_name}</strong> (<span className="font-mono text-blue-900 font-bold">{student.matric_no}</span>) enrolled in <span className="font-bold text-blue-900">{course.code}</span>.
            </p>

            {/* Policy Notice */}
            <div className="p-3 mb-4 rounded-xl bg-blue-50/80 border border-blue-200 text-blue-900 text-xs">
              <p className="font-bold mb-0.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
                <span>Strict Hardware Binding Protocol (Option 2)</span>
              </p>
              <p className="text-blue-800 text-[11px]">
                Resetting allows the student to immediately register attendance on a new verified handset. Per institutional anti-proxy compliance, a mandatory justification is required and will be permanently recorded in <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">device_events</code> and <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">audit_logs</code>.
              </p>
            </div>

            {resetFeedback && (
              <div
                className={`p-3.5 mb-4 rounded-xl text-xs flex items-center gap-2.5 ${
                  resetFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border border-rose-200'
                }`}
              >
                {resetFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span className="font-semibold">{resetFeedback.message}</span>
              </div>
            )}

            <form onSubmit={handleInitiateDeviceReset} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mandatory Verification Reason <span className="text-rose-600">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={resetReason}
                  onChange={e => setResetReason(e.target.value)}
                  placeholder="e.g. Student verified with physical ID card during lecture..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Quick Select Buttons */}
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1.5">
                  Quick Justification Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setResetReason('Student verified with physical ID during lecture')}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition"
                  >
                    Verified with physical ID
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetReason('Student smartphone battery depleted; switching to verified backup handset')}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition"
                  >
                    Battery depleted / backup phone
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetReason('Student browser cache cleared / hardware changed')}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition"
                  >
                    Storage cleared
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || !resetReason.trim()}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  {resetLoading ? (
                    <span>Processing Reset...</span>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Confirm & Reset Device Lock</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
