import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Users,
  Presentation,
  Calendar,
  FileSpreadsheet,
  Download,
  Archive,
  RefreshCw,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { Course } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { CourseRosterTab } from './CourseRosterTab';
import { CourseSessionsTab } from './CourseSessionsTab';
import { CourseStudentsTab } from './CourseStudentsTab';

export const CourseDetailPage: React.FC = () => {
  const { id: courseId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'sessions' | 'roster' | 'students'>(
    (searchParams.get('tab') as any) || 'sessions'
  );
  const [isExporting, setIsExporting] = useState(false);

  const loadCourse = async () => {
    if (!courseId) return;
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourse();
  }, [courseId, user]);

  const handleTabChange = (tab: 'sessions' | 'roster' | 'students') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const handleExportExcel = async () => {
    if (!course) return;
    try {
      setIsExporting(true);
      await LecturerService.exportTwoSheetExcel(course.id);
    } catch (err: any) {
      alert('Failed to export Excel file: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!course || !user) return;
    if (course.status === 'active') {
      if (window.confirm('Archive this course? It will become read-only, close active sessions, and free up an active course slot.')) {
        await LecturerService.archiveCourse(course.id, { id: user.id, name: user.name });
        await loadCourse();
      }
    } else {
      const res = await LecturerService.unarchiveCourse(course.id, user.id, { id: user.id, name: user.name });
      if (!res.success) {
        alert(res.error || 'Cannot unarchive course.');
      } else {
        await loadCourse();
      }
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs">Loading course details...</p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-800">Course Not Found</h3>
        <p className="text-xs text-slate-500 mt-1 mb-4">The course ID does not exist or may have been deleted.</p>
        <Link
          to="/lecturer/dashboard"
          className="px-4 py-2 bg-blue-700 text-white rounded-xl text-xs font-semibold"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Link to="/lecturer/dashboard" className="hover:text-blue-700">Dashboard</Link>
        <span>&bull;</span>
        <span className="text-slate-900 font-bold">{course.code}</span>
      </div>

      {/* Course Header Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="px-3 py-1 rounded-xl bg-blue-50 text-blue-800 font-mono font-black text-sm border border-blue-100">
              {course.code}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                course.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              {course.status}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {course.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Department of Computer Science &bull; Faculty of Natural & Applied Sciences
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Download full 2-sheet attendance ledger"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>{isExporting ? 'Generating Excel...' : 'Export Attendance (XLSX)'}</span>
          </button>

          <button
            onClick={handleArchiveToggle}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition shadow-xs cursor-pointer ${
              course.status === 'active'
                ? 'border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
                : 'border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800'
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>{course.status === 'active' ? 'Archive Course' : 'Activate Course'}</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-8">
        <button
          onClick={() => handleTabChange('sessions')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'sessions'
              ? 'text-blue-700 border-b-2 border-blue-700'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Presentation className="w-4 h-4" />
          <span>Lecture Sessions &amp; QR</span>
        </button>

        <button
          onClick={() => handleTabChange('roster')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'roster'
              ? 'text-blue-700 border-b-2 border-blue-700'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Course Roster</span>
        </button>

        <button
          onClick={() => handleTabChange('students')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'students'
              ? 'text-blue-700 border-b-2 border-blue-700'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Student Attendance Ledgers</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'sessions' && (
        <CourseSessionsTab course={course} onSessionUpdated={loadCourse} />
      )}

      {activeTab === 'roster' && (
        <CourseRosterTab course={course} onRosterUpdated={loadCourse} />
      )}

      {activeTab === 'students' && (
        <CourseStudentsTab course={course} />
      )}
    </div>
  );
};
