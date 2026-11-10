import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { normalizeMatric } from '../../lib/storage';
import { AdminService } from '../../services/adminService';
import { StudentMaster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  GraduationCap,
  UploadCloud,
  FileSpreadsheet,
  Search,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Users,
  Filter,
  Check,
  X,
  FileDown,
  Loader2,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

export const StudentsMasterPage: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [students, setStudents] = useState<StudentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterProgram, setFilterProgram] = useState<string>('all');

  // File Upload & Preview State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<{
    fileName: string;
    total: number;
    accepted: any[];
    rejected: Array<{ row: number; matric_no: string; reason: string }>;
  } | null>(null);

  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [importSuccessMsg, setImportSuccessMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await AdminService.getStudentsMaster();
      setStudents(data);
    } catch (err) {
      console.error('Failed to load students master:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle File Selection and Parsing via SheetJS
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setImportSuccessMsg('');

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary', raw: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to array of objects with raw strings
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

        const accepted: any[] = [];
        const rejected: Array<{ row: number; matric_no: string; reason: string }> = [];
        const seenMatrics = new Set<string>();

        rawJson.forEach((row, idx) => {
          const rowNum = idx + 2; // header is row 1
          
          // Case-insensitive key mapping
          const getVal = (keys: string[]) => {
            for (const k of Object.keys(row)) {
              if (keys.includes(k.trim().toLowerCase())) {
                return String(row[k] || '').trim();
              }
            }
            return '';
          };

          const rawMatric = getVal(['matric_no', 'matric', 'matricno', 'matriculation_no', 'matric_number']);
          const surname = getVal(['surname', 'last_name', 'lastname']);
          const firstName = getVal(['first_name', 'firstname', 'first name']);
          const middleName = getVal(['middle_name', 'middlename', 'other_name', 'othername']);
          const program = getVal(['program', 'programme', 'course_of_study', 'department']) || 'General';
          const level = getVal(['level', 'class', 'year']) || '100';
          const email = getVal(['email', 'email_address', 'student_email']);
          const phone = getVal(['phone', 'phone_number', 'mobile']);
          const searchKey = getVal(['search_key', 'searchkey']);

          const normMatric = normalizeMatric(rawMatric);

          if (!normMatric) {
            rejected.push({ row: rowNum, matric_no: '', reason: 'Empty matric number' });
            return;
          }

          if (!surname) {
            rejected.push({ row: rowNum, matric_no: normMatric, reason: 'Missing student surname' });
            return;
          }

          if (!firstName) {
            rejected.push({ row: rowNum, matric_no: normMatric, reason: 'Missing student first name' });
            return;
          }

          if (seenMatrics.has(normMatric)) {
            rejected.push({ row: rowNum, matric_no: normMatric, reason: 'Duplicate matric in file' });
            return;
          }

          seenMatrics.add(normMatric);

          accepted.push({
            matric_no: normMatric,
            surname,
            first_name: firstName,
            middle_name: middleName,
            program,
            level,
            email,
            phone,
            search_key: searchKey,
          });
        });

        setUploadPreview({
          fileName: file.name,
          total: rawJson.length,
          accepted,
          rejected,
        });
      } catch (err: any) {
        alert('Failed to parse spreadsheet: ' + err.message);
      } finally {
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleConfirmImport = async () => {
    if (!uploadPreview || !currentAdmin) return;

    setIsProcessing(true);
    const result = await AdminService.importStudentsMaster(
      uploadPreview.accepted,
      importMode === 'replace',
      { id: currentAdmin.id, name: currentAdmin.name }
    );
    setIsProcessing(false);

    if (result.success) {
      setImportSuccessMsg(
        `Successfully loaded ${result.accepted} students into master directory. (${result.rejected} rejected)`
      );
      setUploadPreview(null);
      await loadData();
    } else {
      alert(result.error || 'Failed to import students master directory.');
    }
  };

  const handleDownloadSample = () => {
    const sampleData = [
      {
        matric_no: 'ADUN/FS/COM/25/001',
        surname: 'Adebayo',
        first_name: 'Babajide',
        middle_name: 'Femi',
        program: 'Computer Science',
        level: '400',
        email: 'b.adebayo@student.adun.edu.ng',
        phone: '08012345678',
        search_key: '001',
      },
      {
        matric_no: 'ADUN/FS/CYB/25/002',
        surname: 'Chukwu',
        first_name: 'Ngozi',
        middle_name: 'Blessing',
        program: 'Cyber Security',
        level: '300',
        email: 'n.chukwu@student.adun.edu.ng',
        phone: '08098765432',
        search_key: '002',
      },
      {
        matric_no: 'ADUN/FS/SEN/25/003',
        surname: 'Ibrahim',
        first_name: 'Musa',
        middle_name: '',
        program: 'Software Engineering',
        level: '200',
        email: 'm.ibrahim@student.adun.edu.ng',
        phone: '08055554444',
        search_key: '003',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MasterStudents');
    XLSX.writeFile(wb, 'ADUN_Students_Master_Template.xlsx');
  };

  const handleDownloadRejections = () => {
    if (!uploadPreview || uploadPreview.rejected.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(uploadPreview.rejected);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RejectedRows');
    XLSX.writeFile(wb, `Import_Rejections_${Date.now()}.xlsx`);
  };

  // Unique programs for filter dropdown
  const programs = Array.from(new Set(students.map(s => s.program).filter(Boolean)));

  const filteredStudents = students.filter(s => {
    const matchesSearch =
      s.matric_no.toLowerCase().includes(search.toLowerCase()) ||
      s.surname.toLowerCase().includes(search.toLowerCase()) ||
      s.first_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.email && s.email.toLowerCase().includes(search.toLowerCase()));

    const matchesLevel = filterLevel === 'all' || s.level === filterLevel;
    const matchesProgram = filterProgram === 'all' || s.program === filterProgram;

    return matchesSearch && matchesLevel && matchesProgram;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Master Student Directory</h1>
          <p className="text-sm text-slate-500">
            Institutional matriculation register used as the authoritative source for course roster eligibility.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <button
            onClick={handleDownloadSample}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition flex-1 sm:flex-initial"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Sample Template (.xlsx)</span>
          </button>

          <label className="cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-sm rounded-xl transition shadow-xs flex-1 sm:flex-initial">
            <UploadCloud className="w-4 h-4" />
            <span>Upload Spreadsheet</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {importSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-medium">{importSuccessMsg}</span>
          </div>
          <button onClick={() => setImportSuccessMsg('')} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by matric no, name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Level Filter */}
          <select
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Levels</option>
            <option value="100">100 Level</option>
            <option value="200">200 Level</option>
            <option value="300">300 Level</option>
            <option value="400">400 Level</option>
            <option value="500">500 Level</option>
          </select>

          {/* Program Filter */}
          <select
            value={filterProgram}
            onChange={e => setFilterProgram(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Programs</option>
            {programs.map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Directory Table or Empty State */}
      {filteredStudents.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={search ? 'No students found matching your query' : 'Master student directory is currently empty'}
          description={
            search
              ? 'Try modifying your search query or level filters.'
              : 'Upload the official ADUN student matriculation spreadsheet (.xlsx or .csv). Once uploaded, lecturers can validate their course rosters against this master list.'
          }
          actionText={!search ? 'Upload Spreadsheet (.xlsx)' : undefined}
          onAction={!search ? () => fileInputRef.current?.click() : undefined}
          secondaryActionText={!search ? 'Download Sample Template' : undefined}
          onSecondaryAction={!search ? handleDownloadSample : undefined}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="px-4 sm:px-6 py-3.5 bg-slate-50/75 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-slate-600">
            <span className="font-semibold">
              Showing {filteredStudents.length} of {students.length} students
            </span>
            <span className="font-mono text-slate-500 text-[11px]">
              Preserving leading zeros &bull; Case-insensitive lookup
            </span>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full min-w-[700px] text-left border-collapse">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs z-10 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Matriculation No</th>
                  <th className="py-3 px-4">Student Full Name</th>
                  <th className="py-3 px-4">Program / Discipline</th>
                  <th className="py-3 px-4">Level</th>
                  <th className="py-3 px-4">Search Key</th>
                  <th className="py-3 px-4">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map(student => (
                  <tr key={student.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-mono font-bold text-blue-900">
                      {student.matric_no}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {student.surname}, {student.first_name} {student.middle_name || ''}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700">
                      {student.program}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 font-semibold text-xs border border-blue-100">
                        {student.level}L
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">
                      {student.search_key || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      <div>{student.email || '—'}</div>
                      {student.phone && <div className="text-[11px] text-slate-400">{student.phone}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* IMPORT PREVIEW MODAL */}
      {uploadPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 truncate">
                <FileSpreadsheet className="w-5 h-5 text-blue-400 shrink-0" />
                <div className="truncate">
                  <h3 className="font-bold text-base truncate">Import Validation Preview</h3>
                  <p className="text-xs text-slate-400 truncate">{uploadPreview.fileName}</p>
                </div>
              </div>
              <button onClick={() => setUploadPreview(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
              {/* Stat Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <p className="text-xs text-slate-500 font-medium">Total Rows In File</p>
                  <p className="text-2xl font-extrabold text-slate-800 mt-1">{uploadPreview.total}</p>
                </div>
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <p className="text-xs text-emerald-700 font-medium">Valid / Accepted</p>
                  <p className="text-2xl font-extrabold text-emerald-800 mt-1">{uploadPreview.accepted.length}</p>
                </div>
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-center">
                  <p className="text-xs text-red-700 font-medium">Rejected / Errors</p>
                  <p className="text-2xl font-extrabold text-red-800 mt-1">{uploadPreview.rejected.length}</p>
                </div>
              </div>

              {/* Import Mode selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Directory Update Mode:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label
                    className={`p-3 rounded-xl border cursor-pointer text-xs transition ${
                      importMode === 'append'
                        ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={() => setImportMode('append')}
                      className="sr-only"
                    />
                    <p className="font-bold">Append / Merge</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Keep existing records and add new students</p>
                  </label>

                  <label
                    className={`p-3 rounded-xl border cursor-pointer text-xs transition ${
                      importMode === 'replace'
                        ? 'border-red-600 bg-red-50/50 text-red-900 font-semibold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => setImportMode('replace')}
                      className="sr-only"
                    />
                    <p className="font-bold text-red-700">Replace All</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Clear directory and replace with this upload</p>
                  </label>
                </div>
              </div>

              {/* Rejection list if any */}
              {uploadPreview.rejected.length > 0 && (
                <div className="border border-red-200 rounded-xl overflow-hidden">
                  <div className="bg-red-50 px-4 py-2.5 flex items-center justify-between text-xs text-red-900 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span>{uploadPreview.rejected.length} rows failed validation</span>
                    </span>
                    <button
                      onClick={handleDownloadRejections}
                      className="text-red-700 hover:text-red-900 underline font-medium inline-flex items-center gap-1"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      Download Rejections (.xlsx)
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-red-100 text-xs">
                    {uploadPreview.rejected.map((r, i) => (
                      <div key={i} className="px-4 py-2 flex items-center justify-between bg-white text-slate-700">
                        <span className="font-mono text-slate-500">Row {r.row}</span>
                        <span className="font-mono font-bold text-slate-800">{r.matric_no || 'Missing'}</span>
                        <span className="text-red-600 font-medium">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 shrink-0">
              <button
                onClick={() => setUploadPreview(null)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-xl text-center"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={uploadPreview.accepted.length === 0}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-xl shadow-xs text-center"
              >
                Import {uploadPreview.accepted.length} Valid Students
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
