import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Search,
  Calendar,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Download,
  Smartphone,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LecturerService, StudentAttendanceSummary } from '../../services/lecturerService';
import { Course } from '../../types';
import { EmptyState } from '../../components/common/EmptyState';

interface CourseStudentsTabProps {
  course: Course;
}

export const CourseStudentsTab: React.FC<CourseStudentsTabProps> = ({ course }) => {
  const { user } = useAuth();
  const [summaries, setSummaries] = useState<StudentAttendanceSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterThreshold, setFilterThreshold] = useState<'all' | 'good' | 'at_risk' | 'critical'>('all');

  // Emergency Reset Modal State
  const [resetModalStudent, setResetModalStudent] = useState<StudentAttendanceSummary | null>(null);
  const [resetReason, setResetReason] = useState('Student verified with physical ID during lecture');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');
  const [resetErrorMsg, setResetErrorMsg] = useState('');

  const loadData = () => {
    const list = LecturerService.getCourseAttendanceSummary(course.id);
    setSummaries(list);
  };

  useEffect(() => {
    loadData();
  }, [course.id]);

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalStudent || !user) return;
    setResetLoading(true);
    setResetSuccessMsg('');
    setResetErrorMsg('');

    const res = LecturerService.emergencyResetDevice(
      resetModalStudent.student_id,
      course.id,
      resetReason.trim(),
      { id: user.id, name: user.name }
    );
    setResetLoading(false);

    if (res.success) {
      setResetSuccessMsg(`Device lock reset successfully for ${resetModalStudent.matric_no}. Action recorded to device_events and audit_logs.`);
      setTimeout(() => {
        setResetModalStudent(null);
        setResetSuccessMsg('');
      }, 1800);
    } else {
      setResetErrorMsg(res.error || 'Failed to reset device lock.');
    }
  };

  const filteredSummaries = summaries.filter(item => {
    const matchesSearch =
      item.matric_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.student_name.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (filterThreshold === 'good') return item.attendance_percentage >= 75;
    if (filterThreshold === 'at_risk') return item.attendance_percentage >= 60 && item.attendance_percentage < 75;
    if (filterThreshold === 'critical') return item.attendance_percentage < 60;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Overview Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-700" />
            <span>Student Attendance Performance</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time attendance percentage based on sessions held. Admiralty University requires $\ge 75\%$ attendance for exam eligibility.
          </p>
        </div>

        {/* Quick Filter Badges */}
        <div className="flex items-center gap-2 text-xs font-semibold self-start sm:self-auto">
          <button
            onClick={() => setFilterThreshold('all')}
            className={`px-3 py-1.5 rounded-xl border transition ${
              filterThreshold === 'all'
                ? 'bg-blue-50 text-blue-800 border-blue-200 font-bold'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All ({summaries.length})
          </button>
          <button
            onClick={() => setFilterThreshold('good')}
            className={`px-3 py-1.5 rounded-xl border transition ${
              filterThreshold === 'good'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            &ge; 75% Good ({summaries.filter(s => s.attendance_percentage >= 75).length})
          </button>
          <button
            onClick={() => setFilterThreshold('critical')}
            className={`px-3 py-1.5 rounded-xl border transition ${
              filterThreshold === 'critical'
                ? 'bg-rose-50 text-rose-800 border-rose-200 font-bold'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            &lt; 60% Critical ({summaries.filter(s => s.attendance_percentage < 60).length})
          </button>
        </div>
      </div>

      {/* Student List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {/* Search */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by matric no or name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <span className="text-xs text-slate-500 font-medium">
            Showing {filteredSummaries.length} of {summaries.length} students
          </span>
        </div>

        {summaries.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Users}
              title="No Enrolled Students"
              description="No students are enrolled in this course roster. Upload a roster spreadsheet in the 'Course Roster' tab to begin tracking student attendance."
            />
          </div>
        ) : filteredSummaries.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No students found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Matric Number</th>
                  <th className="px-5 py-3.5">Student Name</th>
                  <th className="px-5 py-3.5">Program & Level</th>
                  <th className="px-5 py-3.5">Sessions Attended</th>
                  <th className="px-5 py-3.5">Attendance Rate</th>
                  <th className="px-5 py-3.5">Last Signed (WAT)</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSummaries.map(item => {
                  const pct = item.attendance_percentage;
                  const isGood = pct >= 75;
                  const isAtRisk = pct >= 60 && pct < 75;

                  return (
                    <tr key={item.student_id} className="hover:bg-blue-50/30 transition">
                      <td className="px-5 py-4 font-mono font-bold text-blue-900">
                        {item.matric_no}
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-800">
                        {item.student_name}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {item.program} <span className="text-slate-400">({item.level}L)</span>
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-800">
                        {item.attended_sessions} / {item.total_sessions}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden shrink-0">
                            <div
                              className={`h-full rounded-full ${
                                isGood ? 'bg-emerald-500' : isAtRisk ? 'bg-amber-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`font-mono font-bold text-xs ${
                            isGood ? 'text-emerald-700' : isAtRisk ? 'text-amber-700' : 'text-rose-700'
                          }`}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-500 text-xs">
                        {item.last_signed_date ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-700">{item.last_signed_date}</span>
                            <span className="text-[11px] text-slate-400">{item.last_signed_time} &bull; {item.last_status?.toUpperCase()}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Never signed</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setResetSuccessMsg('');
                              setResetErrorMsg('');
                              setResetReason('Student verified with physical ID during lecture');
                              setResetModalStudent(item);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold text-xs transition"
                            title="Emergency in-class device unlock for this student"
                          >
                            <Smartphone className="w-3.5 h-3.5 text-amber-700" />
                            <span className="hidden sm:inline">Reset Device</span>
                          </button>

                          <Link
                            to={`/lecturer/courses/${course.id}/students/${item.student_id}/calendar`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold text-xs transition"
                            title="View student interactive attendance calendar and biometric details"
                          >
                            <Calendar className="w-3.5 h-3.5 text-blue-700" />
                            <span>Calendar</span>
                            <ChevronRight className="w-3 h-3 text-blue-600" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Emergency Device Reset Modal */}
      {resetModalStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setResetModalStudent(null)}
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
              Initiate an emergency device unlock for <strong className="text-slate-800">{resetModalStudent.student_name}</strong> (<span className="font-mono text-blue-900 font-bold">{resetModalStudent.matric_no}</span>) enrolled in <span className="font-bold text-blue-900">{course.code}</span>.
            </p>

            <div className="p-3 mb-4 rounded-xl bg-blue-50/80 border border-blue-200 text-blue-900 text-xs">
              <p className="font-bold mb-0.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
                <span>Strict Hardware Binding Protocol (Option 2)</span>
              </p>
              <p className="text-blue-800 text-[11px]">
                Resetting allows the student to immediately register attendance on a new verified handset. Per institutional anti-proxy regulations, a mandatory justification is required and will be permanently logged to <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">device_events</code> and <code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">audit_logs</code>.
              </p>
            </div>

            {resetSuccessMsg && (
              <div className="p-3.5 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-semibold">{resetSuccessMsg}</span>
              </div>
            )}

            {resetErrorMsg && (
              <div className="p-3.5 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="font-semibold">{resetErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mandatory Verification Reason <span className="text-rose-600">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={resetReason}
                  onChange={e => setResetReason(e.target.value)}
                  placeholder="e.g. Student verified with physical ID during lecture..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

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
                    onClick={() => setResetReason('Student phone battery depleted; switching to verified backup handset')}
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
                  onClick={() => setResetModalStudent(null)}
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
