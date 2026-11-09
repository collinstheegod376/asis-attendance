import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2,
  Users,
  Search,
  Filter,
  Check,
  RefreshCw,
  Info,
} from 'lucide-react';
import { LecturerService } from '../../services/lecturerService';
import { RosterService } from '../../services/rosterService';
import { Course, CourseRoster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/common/EmptyState';
import { formatWATDate } from '../../lib/dateUtils';

interface CourseRosterTabProps {
  course: Course;
  onRosterUpdated: () => void;
}

export const CourseRosterTab: React.FC<CourseRosterTabProps> = ({ course, onRosterUpdated }) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [roster, setRoster] = useState<CourseRoster[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  // Upload & validation states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [validationSummary, setValidationSummary] = useState<{
    total: number;
    accepted: string[];
    rejected: Array<{ row: number; matric?: string; reason: string }>;
  } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const loadRoster = async () => {
    setLoading(true);
    try {
      const list = await LecturerService.getCourseRoster(course.id);
      setRoster(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoster();
  }, [course.id]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setUploadFileName(file.name);
    setIsUploading(true);

    try {
      const rows = await RosterService.parseSpreadsheetFile(file);
      if (!rows || rows.length === 0) {
        setUploadError('The selected spreadsheet appears to be empty or has no data rows.');
        setIsUploading(false);
        return;
      }

      // Fix QA-12 / PERF-16: Call server Edge Function /api/import-roster with JWT
      const result = await RosterService.importCourseRoster(course.id, rows, importMode);

      if (!result.success && result.error) {
        setUploadError(result.error);
        setIsUploading(false);
        return;
      }

      setValidationSummary({
        total: rows.length,
        accepted: result.accepted,
        rejected: result.rejected,
      });

      setShowSummaryModal(true);
      await loadRoster();
      onRosterUpdated();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to process roster upload.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadRejections = () => {
    if (!validationSummary || validationSummary.rejected.length === 0) return;
    RosterService.downloadRejectedRowsFile(course.code, validationSummary.rejected);
  };

  const handleRemoveStudent = async (rosterId: string, studentName: string) => {
    if (!user) return;
    if (window.confirm(`Are you sure you want to remove ${studentName} from this course roster?`)) {
      const res = await LecturerService.removeStudentFromRoster(rosterId, { id: user.id, name: user.name });
      if (res.success) {
        await loadRoster();
        onRosterUpdated();
      } else {
        alert(res.error || 'Failed to remove student.');
      }
    }
  };

  const filteredRoster = roster.filter(student => {
    const matchesSearch =
      student.matric_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      student.student_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === 'all' || String(student.level) === levelFilter;
    return matchesSearch && matchesLevel;
  });

  return (
    <div className="space-y-6">
      {/* Upload Zone & Mode Selector Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-blue-700" />
              <span>Import Official Course Roster</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload class list (.xlsx, .xls, .csv). Unknown matric numbers not in students_master are strictly rejected.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Import Mode Radio Switcher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setImportMode('append')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  importMode === 'append'
                    ? 'bg-white text-blue-900 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Append to Roster
              </button>
              <button
                type="button"
                onClick={() => setImportMode('replace')}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  importMode === 'replace'
                    ? 'bg-rose-600 text-white shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Replace Entire Roster
              </button>
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Drag/Drop Clickable Container */}
        <div
          onClick={() => {
            if (course.status !== 'archived' && !isUploading) {
              fileInputRef.current?.click();
            }
          }}
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition cursor-pointer ${
            course.status === 'archived'
              ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
              : isUploading
              ? 'border-blue-400 bg-blue-50/50'
              : 'border-slate-300 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/20'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={course.status === 'archived' || isUploading}
          />

          <FileSpreadsheet className="w-10 h-10 text-blue-700 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-800">
            {isUploading ? 'Validating Against University Directory...' : 'Click to Browse Roster Spreadsheet'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Accepts Excel (.xlsx, .xls) and CSV. Requires header column: <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-blue-900 font-mono">matric_no</code>
          </p>
        </div>
      </div>

      {/* Roster Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-sm">Enrolled Students</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-mono font-bold">
              {roster.length} Total
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search matric or name..."
                className="pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 w-48 sm:w-60"
              />
            </div>

            {/* Level Filter */}
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value)}
              className="py-1.5 px-3 text-xs rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Levels</option>
              <option value="100">100 Level</option>
              <option value="200">200 Level</option>
              <option value="300">300 Level</option>
              <option value="400">400 Level</option>
              <option value="500">500 Level</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading course roster...</p>
          </div>
        ) : filteredRoster.length === 0 ? (
          <div className="p-10">
            <EmptyState
              icon={Users}
              title="No Students Enrolled"
              description="Upload your course roster above to enroll students allowed to attend and sign attendance."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">#</th>
                  <th className="px-5 py-3.5">Matric Number</th>
                  <th className="px-5 py-3.5">Student Full Name</th>
                  <th className="px-5 py-3.5">Program</th>
                  <th className="px-5 py-3.5">Level</th>
                  <th className="px-5 py-3.5">Enrolled Date</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRoster.map((student, idx) => (
                  <tr key={student.id} className="hover:bg-blue-50/30 transition">
                    <td className="px-5 py-3.5 text-slate-400 font-mono text-xs">{idx + 1}</td>
                    <td className="px-5 py-3.5 font-mono font-bold text-blue-900">
                      {student.matric_no}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-800">
                      {student.student_name}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{student.program || 'N/A'}</td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-xs font-semibold">
                        {student.level || '100'}L
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                      {formatWATDate(student.uploaded_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleRemoveStudent(student.id, student.student_name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                        title="Remove student from course roster"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Summary Modal */}
      {showSummaryModal && validationSummary && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-100 relative max-h-[90vh] flex flex-col">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
              Course Roster Import Summary
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Processed spreadsheet <span className="font-semibold text-slate-700">{uploadFileName}</span> for {course.code}.
            </p>

            {/* Scorecard */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Rows</span>
                <span className="text-2xl font-black text-slate-900 font-mono">{validationSummary.total}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                <span className="text-[10px] uppercase font-bold text-emerald-700 block">Accepted</span>
                <span className="text-2xl font-black text-emerald-700 font-mono">{validationSummary.accepted.length}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-center">
                <span className="text-[10px] uppercase font-bold text-rose-700 block">Rejected</span>
                <span className="text-2xl font-black text-rose-700 font-mono">{validationSummary.rejected.length}</span>
              </div>
            </div>

            {/* Rejected Rows Preview & Download (Fix QA-12 / PERF-16) */}
            {validationSummary.rejected.length > 0 ? (
              <div className="flex-1 overflow-hidden flex flex-col border border-rose-100 rounded-xl bg-rose-50/30 p-3 mb-4">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-rose-100">
                  <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Rejected Rows Breakdown ({validationSummary.rejected.length})</span>
                  </span>
                  <button
                    onClick={handleDownloadRejections}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg transition shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Rejections (.xlsx)</span>
                  </button>
                </div>

                <div className="overflow-y-auto max-h-48 divide-y divide-rose-100 text-xs">
                  {validationSummary.rejected.map((r, i) => (
                    <div key={i} className="py-2 flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono font-bold text-rose-900 mr-2">
                          Row {r.row}: {r.matric || '[Empty Matric]'}
                        </span>
                        <p className="text-[11px] text-rose-700 mt-0.5">{r.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-emerald-800 text-xs font-medium">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>100% of rows validated successfully! All students matched the university master database.</span>
              </div>
            )}

            <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="px-5 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition shadow-xs cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
