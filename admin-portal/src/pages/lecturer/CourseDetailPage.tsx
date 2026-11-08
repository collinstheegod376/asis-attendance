import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
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
import { AppStorage } from '../../lib/storage';
import { Course } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { CourseRosterTab } from './CourseRosterTab';
import { CourseSessionsTab } from './CourseSessionsTab';
import { CourseStudentsTab } from './CourseStudentsTab';

export const CourseDetailPage: React.FC = () => {
  const { id: courseId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [activeTab, setActiveTab] = useState<'sessions' | 'roster' | 'students'>(
    (searchParams.get('tab') as any) || 'sessions'
  );
  const [isExporting, setIsExporting] = useState(false);

  const loadCourse = () => {
    if (!courseId) return;
    const c = AppStorage.getCourse(courseId);
    setCourse(c || null);
  };

  useEffect(() => {
    loadCourse();
  }, [courseId]);

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

  const handleArchiveToggle = () => {
    if (!course || !user) return;
    if (course.status === 'active') {
      if (window.confirm('Archive this course? It will become read-only and free up an active course slot.')) {
        LecturerService.archiveCourse(course.id, { id: user.id, name: user.name });
        loadCourse();
      }
    } else {
      const res = LecturerService.unarchiveCourse(course.id, user.id, { id: user.id, name: user.name });
      if (!res.success) {
        alert(res.error || 'Cannot unarchive course.');
      } else {
        loadCourse();
      }
    }
  };

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
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase tracking-wider ${
              course.status === 'active'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {course.status}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {course.title}
          </h1>

          <p className="text-xs text-slate-500 mt-1 font-medium">
            Lecturer in Charge: <strong className="text-slate-800">{course.lecturer_name || user?.name}</strong>
            {course.department && <span> &bull; {course.department}</span>}
          </p>
        </div>

        {/* Action Buttons: 2-Sheet Export & Archive */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-xs transition shadow-xs"
            title="Download formatted 2-Sheet Excel file (Summary Sheet + Session Detail Sheet)"
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Generating XLSX...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export Excel (2-Sheet)</span>
              </>
            )}
          </button>

          <button
            onClick={handleArchiveToggle}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition ${
              course.status === 'active'
                ? 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200'
                : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>{course.status === 'active' ? 'Archive Course' : 'Unarchive Course'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto">
        <button
          onClick={() => handleTabChange('sessions')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-xs border-b-2 transition whitespace-nowrap ${
            activeTab === 'sessions'
              ? 'border-blue-700 text-blue-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Presentation className="w-4 h-4" />
          <span>Sessions & Projector</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px]">
            {course.sessions_count || 0}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('roster')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-xs border-b-2 transition whitespace-nowrap ${
            activeTab === 'roster'
              ? 'border-blue-700 text-blue-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Course Roster Upload</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px]">
            {course.enrolled_count || 0}
          </span>
        </button>

        <button
          onClick={() => handleTabChange('students')}
          className={`flex items-center gap-2 px-4 py-3 font-bold text-xs border-b-2 transition whitespace-nowrap ${
            activeTab === 'students'
              ? 'border-blue-700 text-blue-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Student Attendance</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div>
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
    </div>
  );
};
