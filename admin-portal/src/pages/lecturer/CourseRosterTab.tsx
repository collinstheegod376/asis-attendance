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
import { LecturerService, ImportRosterSummary } from '../../services/lecturerService';
import { AppStorage } from '../../lib/storage';
import { Course, CourseRoster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../../components/common/EmptyState';

interface CourseRosterTabProps {
  course: Course;
  onRosterUpdated: () => void;
}

export const CourseRosterTab: React.FC<CourseRosterTabProps> = ({ course, onRosterUpdated }) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [roster, setRoster] = useState<CourseRoster[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  // Upload & validation states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<any[] | null>(null);
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [validationSummary, setValidationSummary] = useState<ImportRosterSummary | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  const loadRoster = () => {
    const list = AppStorage.getCourseRoster(course.id);
    setRoster(list);
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
      const rows = await LecturerService.parseSpreadsheetFile(file);
      if (!rows || rows.length === 0) {
        setUploadError('The selected spreadsheet appears to be empty or has no data rows.');
        setIsUploading(false);
        return;
      }

      setParsedRows(rows);

      // Perform dry-run validation against students_master
      if (!user) return;
      const summary = LecturerService.importCourseRoster(
        course.id,
        rows,
        importMode,
        { id: user.id, name: user.name }
      );

      setValidationSummary(summary);
      setShowSummaryModal(true);
      loadRoster();
      onRosterUpdated();
    } catch (err: any) {
      setUploadError(err.message || 'Failed to read spreadsheet.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadRejections = () => {
    if (!validationSummary || validationSummary.rejectedRows.length === 0) return;
    LecturerService.downloadRejectedRowsCSV(course.code, validationSummary.rejectedRows);
  };

  const handleRemoveStudent = (rosterId: string, studentName: string) => {
    if (!user) return;
    if (window.confirm(`Are you sure you want to remove ${studentName} from this course roster?`)) {
      const res = LecturerService.removeStudentFromRoster(rosterId, { id: user.id, name: user.name });
      if (res.success) {
        loadRoster();
        onRosterUpdated();
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-blue-700" />
              <span>Course Roster Spreadsheet Upload</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload class roster (.xlsx, .xls, .csv). Each student matric number is strictly validated against the official university master database.
            </p>
          </div>

          {/* Import Mode Radio Switch */}
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-semibold self-start sm:self-auto border border-slate-200">
            <span className="text-[11px] text-slate-500 px-2 uppercase tracking-wider font-bold">Mode:</span>
            <button
              onClick={() => setImportMode('append')}
              className={`px-3 py-1.5 rounded-lg transition ${
                importMode === 'append'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Append New
            </button>
            <button
              onClick={() => setImportMode('replace')}
              className={`px-3 py-1.5 rounded-lg transition ${
                importMode === 'replace'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Replace All
            </button>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Drag & Drop File Upload Trigger */}
        <div className="mt-5 flex flex-col sm:flex-row items-center justify-between gap-4 p-6 border-2 border-dashed border-blue-200 bg-blue-50/30 rounded-2xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                Upload Eligible Students (.xlsx, .xls, .csv)
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Columns accepted: <code className="font-mono bg-blue-100/60 px-1 py-0.5 rounded text-blue-900">matric_no</code> (or <code className="font-mono bg-blue-100/60 px-1 py-0.5 rounded text-blue-900">matric_no, surname, first_name, program, level</code>)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-bold text-xs transition shadow-xs flex items-center gap-2"
            >
              {isUploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Validating Roster...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Select Spreadsheet</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Informational Guidance */}
        <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <span>
            <strong>Attendance Gatekeeper Policy:</strong> Only students included in this course roster who also exist in the university's master register are qualified to submit attendance during lecture sessions.
          </span>
        </div>
      </div>

      {/* Roster Table Section */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {/* Table controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-700" />
              <span>Enrolled Students</span>
            </h4>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-100">
              {roster.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search matric or name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Level filter */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={levelFilter}
                onChange={e => setLevelFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-medium bg-white focus:outline-hidden"
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
        </div>

        {/* Table */}
        {roster.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Users}
              title="No Students on Course Roster"
              description="This course does not have an active roster yet. Click 'Select Spreadsheet' above to import eligible students from an Excel or CSV file."
            />
          </div>
        ) : filteredRoster.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No enrolled students match your search filter "{searchQuery}".
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
                {filteredRoster.map((student, idx) => {
                  const d = new Date(student.uploaded_at);
                  const enrolledDate = d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });

                  return (
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
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">{enrolledDate}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => handleRemoveStudent(student.id, student.student_name)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          title="Remove student from course roster"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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
                <span className="text-2xl font-black text-emerald-700 font-mono">{validationSummary.accepted}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-center">
                <span className="text-[10px] uppercase font-bold text-rose-700 block">Rejected</span>
                <span className="text-2xl font-black text-rose-700 font-mono">{validationSummary.rejected}</span>
              </div>
            </div>

            {/* Rejected Rows Preview & Download */}
            {validationSummary.rejected > 0 ? (
              <div className="flex-1 overflow-hidden flex flex-col border border-rose-100 rounded-xl bg-rose-50/30 p-3 mb-4">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-rose-100">
                  <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Rejected Rows Breakdown ({validationSummary.rejected})</span>
                  </span>
                  <button
                    onClick={handleDownloadRejections}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg transition shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Rejections (.xlsx)</span>
                  </button>
                </div>

                <div className="overflow-y-auto max-h-48 divide-y divide-rose-100 text-xs">
                  {validationSummary.rejectedRows.map((r, i) => (
                    <div key={i} className="py-2 flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono font-bold text-rose-900 mr-2">
                          Row {r.row}: {r.matric_no || '[Empty Matric]'}
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
                className="px-5 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition shadow-xs"
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
