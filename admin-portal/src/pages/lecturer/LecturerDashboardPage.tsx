import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Plus,
  Users,
  Calendar,
  Presentation,
  Archive,
  RefreshCw,
  Clock,
  Sparkles,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  FolderArchive,
  ChevronRight,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LecturerService } from '../../services/lecturerService';
import { Course, LectureSession } from '../../types';
import { EmptyState } from '../../components/common/EmptyState';

export const LecturerDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeCourses, setActiveCourses] = useState<Course[]>([]);
  const [archivedCourses, setArchivedCourses] = useState<Course[]>([]);
  const [recentSessions, setRecentSessions] = useState<LectureSession[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxQuota, setMaxQuota] = useState(9);
  const [canCreateCourse, setCanCreateCourse] = useState(true);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tab for active vs archived
  const [courseViewTab, setCourseViewTab] = useState<'active' | 'archived'>('active');

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const quotaInfo = await LecturerService.getLecturerCourses(user.id);
      setActiveCourses(quotaInfo.activeCourses);
      setArchivedCourses(quotaInfo.archivedCourses);
      setActiveCount(quotaInfo.activeCount);
      setMaxQuota(quotaInfo.maxQuota);
      setCanCreateCourse(quotaInfo.canCreateCourse);

      // Get recent sessions across this lecturer's courses direct from LecturerService
      const recent = await LecturerService.getLecturerRecentSessions(user.id, 6);
      setRecentSessions(recent);
    } catch (err) {
      console.error('Failed to load lecturer dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError('');

    if (!code.trim()) {
      setFormError('Course code is required (e.g. CSC 401).');
      return;
    }
    if (!title.trim()) {
      setFormError('Course title is required.');
      return;
    }

    setIsSubmitting(true);
    const res = await LecturerService.createCourse(
      user.id,
      {
        code: code.trim(),
        title: title.trim(),
        department: department.trim() || undefined,
      },
      { id: user.id, name: user.name }
    );
    setIsSubmitting(false);

    if (!res.success) {
      setFormError(res.error || 'Failed to create course.');
    } else {
      setCode('');
      setTitle('');
      setDepartment('');
      setCreateModalOpen(false);
      await loadData();
    }
  };

  const handleArchiveCourse = async (courseId: string) => {
    if (!user) return;
    if (window.confirm('Are you sure you want to archive this course? It will be deactivated and will no longer count against your 9-course limit.')) {
      const res = await LecturerService.archiveCourse(courseId, { id: user.id, name: user.name });
      if (res.success) {
        await loadData();
      } else {
        alert(res.error || 'Could not archive course.');
      }
    }
  };

  const handleUnarchiveCourse = async (courseId: string) => {
    if (!user) return;
    const res = await LecturerService.unarchiveCourse(courseId, user.id, { id: user.id, name: user.name });
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || 'Could not unarchive course.');
    }
  };

  const quotaPercent = Math.min(100, Math.round((activeCount / maxQuota) * 100));

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Top Welcome & Quota Tracker */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-blue-700/50">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-blue-200 text-xs font-semibold backdrop-blur-xs mb-3 border border-white/15">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Lecturer Portal Active &bull; Africa/Lagos</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Welcome, {user?.name || 'Lecturer'}
            </h1>
            <p className="text-blue-100/80 text-sm max-w-2xl mt-1 leading-relaxed">
              Manage your semester courses, upload enrolled student rosters, launch lecture projector QR codes, and monitor verified attendance.
            </p>
          </div>

          {/* 9-Course Quota Badge & New Course Button */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-white/15 min-w-[260px] flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-blue-200 uppercase tracking-wider">Active Course Slots</span>
              <span className="font-mono text-white text-sm font-bold">
                {activeCount} / {maxQuota}
              </span>
            </div>

            {/* Quota Progress Bar */}
            <div className="w-full bg-white/20 h-2.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  activeCount >= maxQuota
                    ? 'bg-rose-400'
                    : activeCount >= 7
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-blue-200">
                {activeCount >= maxQuota ? 'All 9 active slots occupied' : `${maxQuota - activeCount} slots remaining`}
              </span>
              <button
                onClick={() => setCreateModalOpen(true)}
                disabled={!canCreateCourse}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs transition shadow-sm ${
                  canCreateCourse
                    ? 'bg-white text-blue-900 hover:bg-blue-50 active:scale-95'
                    : 'bg-white/30 text-white/50 cursor-not-allowed'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Course</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quota Exceeded Warning Banner if at 9 courses */}
      {!canCreateCourse && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3 text-amber-900 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Active Course Limit Reached ({maxQuota} Courses)</span>
            <p className="text-xs text-amber-700 mt-0.5">
              Per university policy, each lecturer can manage up to 9 active courses. You must archive an existing course below to free an active slot before creating a new one. Archived courses retain all past attendance history.
            </p>
          </div>
        </div>
      )}

      {/* Courses Section with Tabs */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-700" />
              <span>Assigned Courses</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a course to manage its student roster, lecture sessions, and Excel exports.
            </p>
          </div>

          {/* Active vs Archived Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setCourseViewTab('active')}
              className={`px-3 py-1.5 rounded-lg transition ${
                courseViewTab === 'active'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active Courses ({activeCourses.length})
            </button>
            <button
              onClick={() => setCourseViewTab('archived')}
              className={`px-3 py-1.5 rounded-lg transition ${
                courseViewTab === 'archived'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Archived ({archivedCourses.length})
            </button>
          </div>
        </div>

        {/* Active Courses Grid */}
        {courseViewTab === 'active' && (
          <div>
            {activeCourses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No Active Courses Found"
                description="You currently have no active courses registered. Create your first course to begin setting up student rosters and lecture sessions."
                actionText="Create Course"
                onAction={() => setCreateModalOpen(true)}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeCourses.map(course => (
                  <div
                    key={course.id}
                    className="bg-white rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition flex flex-col p-5 group relative"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-mono font-bold text-xs border border-blue-100">
                          {course.code}
                        </span>
                        {course.department && (
                          <span className="text-[11px] text-slate-400 block mt-1 font-medium">
                            {course.department}
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200 uppercase tracking-wide">
                        Active
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="text-base font-bold text-slate-900 mb-4 line-clamp-2 leading-snug group-hover:text-blue-700 transition">
                      {course.title}
                    </h3>

                    {/* Stats pills */}
                    <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 mb-5 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span>
                          <strong className="text-slate-900 font-bold">{course.enrolled_count || 0}</strong> students
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span>
                          <strong className="text-slate-900 font-bold">{course.sessions_count || 0}</strong> sessions
                        </span>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link
                        to={`/lecturer/courses/${course.id}`}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        <span>Manage Course</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>

                      <button
                        onClick={() => handleArchiveCourse(course.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition"
                        title="Archive course to free up 1 of your 9 active slots"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Archived Courses Grid */}
        {courseViewTab === 'archived' && (
          <div>
            {archivedCourses.length === 0 ? (
              <EmptyState
                icon={FolderArchive}
                title="No Archived Courses"
                description="You do not have any archived courses. When you archive completed semester courses, they will appear here and do not count toward your 9-course active quota."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {archivedCourses.map(course => (
                  <div
                    key={course.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col opacity-90 hover:opacity-100 transition"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-mono font-bold text-xs">
                        {course.code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">
                        Archived
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-800 mb-3 line-clamp-2">
                      {course.title}
                    </h3>

                    <p className="text-xs text-slate-500 mb-4">
                      Archived courses are read-only and do not consume an active slot.
                    </p>

                    <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Link
                        to={`/lecturer/courses/${course.id}`}
                        className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                      >
                        View History
                      </Link>

                      <button
                        onClick={() => handleUnarchiveCourse(course.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Unarchive</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Recent Lecture Sessions Section */}
      <section className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Presentation className="w-5 h-5 text-blue-700" />
              <span>Recent Lecture Sessions</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sessions across your courses with one-click Classroom Projector mode launch.
            </p>
          </div>
        </div>

        {recentSessions.length === 0 ? (
          <EmptyState
            icon={Presentation}
            title="No Lecture Sessions Scheduled"
            description="You have not created any lecture sessions yet. Open any of your active courses above to generate a static QR code session."
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Course</th>
                    <th className="px-5 py-3.5">Session Title</th>
                    <th className="px-5 py-3.5">Scheduled (WAT)</th>
                    <th className="px-5 py-3.5">Duration</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5">Attendees</th>
                    <th className="px-5 py-3.5 text-right">Projector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentSessions.map(session => {
                    const d = new Date(session.starts_at);
                    const formattedDate = d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
                    const formattedTime = d.toLocaleTimeString('en-GB', { 
                      timeZone: 'Africa/Lagos', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    });

                    return (
                      <tr key={session.id} className="hover:bg-blue-50/40 transition">
                        <td className="px-5 py-4 font-mono font-bold text-blue-900">
                          {session.course_code || 'N/A'}
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {session.title}
                        </td>
                        <td className="px-5 py-4 text-slate-600 font-medium whitespace-nowrap">
                          {formattedDate} at {formattedTime}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {session.duration_minutes} mins (Grace: {session.grace_minutes}m)
                        </td>
                        <td className="px-5 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                            session.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : session.status === 'closed'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}>
                            {session.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-800">
                          {session.attendance_count || 0} students
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            to={`/lecturer/projector/${session.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-medium text-xs transition shadow-xs"
                          >
                            <Presentation className="w-3.5 h-3.5" />
                            <span>Projector</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Create Course Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
              Create New Course
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Active slot {activeCount + 1} of {maxQuota} will be utilized upon creation.
            </p>

            {formError && (
              <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCourse} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Course Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CSC 401"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Course Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed Operating Systems"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Department / Faculty (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Computer Science"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 text-sm"
                />
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
                  {isSubmitting ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
