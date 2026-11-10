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
  AlertCircle,
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterThreshold, setFilterThreshold] = useState<'all' | 'good' | 'at_risk' | 'critical'>('all');

  // Emergency Reset Modal State
  const [resetModalStudent, setResetModalStudent] = useState<StudentAttendanceSummary | null>(null);
  const [resetReason, setResetReason] = useState('Student verified with physical ID during lecture');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');
  const [resetErrorMsg, setResetErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await LecturerService.getCourseAttendanceSummary(course.id);
      setSummaries(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [course.id]);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalStudent || !user) return;
    setResetLoading(true);
    setResetSuccessMsg('');
    setResetErrorMsg('');

    const res = await LecturerService.emergencyResetDevice(
      resetModalStudent.student_id,
      course.id,
      resetReason.trim()
    );
    setResetLoading(false);

    if (res.success) {
      setResetSuccessMsg(
        `Device lock reset successfully for ${resetModalStudent.matric_no}. Action recorded to device_events and audit_logs.`
      );
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
            Real-time attendance percentage based on sessions held. Admiralty University requires &ge; 75% attendance for exam eligibility.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Search */}
          <div className="relative w-full sm:w-auto">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search student or matric..."
              className="pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 w-full sm:w-60"
            />
          </div>

          {/* Filter Threshold */}
          <select
            value={filterThreshold}
            onChange={e => setFilterThreshold(e.target.value as any)}
            className="w-full sm:w-auto py-1.5 px-3 text-xs rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Attendance Rates</option>
            <option value="good">Good Standing (&ge; 75%)</option>
            <option value="at_risk">At Risk (60% - 74%)</option>
            <option value="critical">Debarred / Low (&lt; 60%)</option>
          </select>
        </div>
      </div>

      {/* Students Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading student records...</p>
          </div>
        ) : filteredSummaries.length === 0 ? (
          <div className="p-10">
            <EmptyState
              icon={Users}
              title="No Enrolled Students Match"
              description="Upload your course roster or adjust filter criteria above to review student attendance status."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Matric Number</th>
                  <th className="px-5 py-3.5">Student Name</th>
                  <th className="px-5 py-3.5">Program / Level</th>
                  <th className="px-5 py-3.5 text-center">Attended / Total</th>
                  <th className="px-5 py-3.5">Attendance Rate</th>
                  <th className="px-5 py-3.5">Last Signed</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSummaries.map(s => {
                  const isGood = s.attendance_percentage >= 75;
                  const isAtRisk = s.attendance_percentage >= 60 && s.attendance_percentage < 75;

                  return (
                    <tr key={s.student_id} className="hover:bg-blue-50/30 transition">
                      <td className="px-5 py-3.5 font-mono font-bold text-blue-900">
                        {s.matric_no}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">
                        {s.student_name}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {s.program} <span className="text-slate-400 font-mono">({s.level}L)</span>
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono font-semibold text-slate-700">
                        {s.attended_sessions} / {s.total_sessions}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isGood ? 'bg-emerald-500' : isAtRisk ? 'bg-amber-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${s.attendance_percentage}%` }}
                            />
                          </div>
                          <span
                            className={`font-mono text-xs font-bold ${
                              isGood
                                ? 'text-emerald-700'
                                : isAtRisk
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {s.attendance_percentage}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                        {s.last_signed_date ? (
                          <div className="text-xs">
                            <span className="font-semibold text-slate-700">{s.last_signed_date}</span>
                            <span className="text-[11px] text-slate-400 block">{s.last_signed_time}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Never signed</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Calendar & Forensic View */}
                          <Link
                            to={`/lecturer/courses/${course.id}/students/${s.student_id}/calendar`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition"
                            title="Open detailed attendance calendar and selfie evidence"
                          >
                            <Calendar className="w-3.5 h-3.5 text-blue-600" />
                            <span>Ledger</span>
                          </Link>

                          {/* Emergency Device Reset Button */}
                          <button
                            onClick={() => {
                              setResetModalStudent(s);
                              setResetReason('Student verified with physical ID during lecture');
                              setResetErrorMsg('');
                              setResetSuccessMsg('');
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition cursor-pointer"
                            title="Reset device lock for this student"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
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
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setResetModalStudent(null)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-amber-50 text-amber-700 rounded-2xl flex items-center justify-center mb-4 border border-amber-200">
              <RotateCcw className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Reset Device Lock
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Authorize hardware device reset for student{' '}
              <span className="font-bold text-blue-900">{resetModalStudent.student_name}</span> (
              <span className="font-mono font-bold">{resetModalStudent.matric_no}</span>). The student will be allowed to bind a new device on their next check-in.
            </p>

            {resetErrorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resetErrorMsg}</span>
              </div>
            )}

            {resetSuccessMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{resetSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Audit &amp; Forensic Reason (Minimum 10 characters) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  value={resetReason}
                  onChange={e => setResetReason(e.target.value)}
                  placeholder="Explain why this student device lock is being cleared..."
                  className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalStudent(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading || resetReason.trim().length < 10}
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 rounded-xl transition shadow-xs disabled:opacity-50"
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
