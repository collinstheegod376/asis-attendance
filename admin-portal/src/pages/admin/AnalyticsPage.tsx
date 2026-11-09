import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { AdminService } from '../../services/adminService';
import { Course, User, AttendanceRecord, LectureSession, StudentMaster } from '../../types';
import { formatWATDate, formatWATDateTime } from '../../lib/dateUtils';
import {
  BarChart3,
  Filter,
  Users,
  CheckCircle2,
  Clock,
  Printer,
  X,
  FileText,
  Loader2,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

const STATUS_COLORS = ['#1D4ED8', '#F59E0B', '#EF4444'];
const DISTRIBUTION_COLORS = ['#EF4444', '#F59E0B', '#10B981'];

export const AnalyticsPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [lecturers, setLecturers] = useState<User[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<LectureSession[]>([]);
  const [students, setStudents] = useState<StudentMaster[]>([]);
  const [rosters, setRosters] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [selectedLecturerId, setSelectedLecturerId] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('all');
  const [showReportModal, setShowReportModal] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const data = await AdminService.getAnalyticsData();
        if (isMounted) {
          setCourses(data.courses || []);
          setLecturers((data.lecturers || []).filter((u: any) => u.role === 'lecturer'));
          setRecords(data.records || []);
          setSessions(data.sessions || []);
          setStudents(data.students || []);
          setRosters(data.rosters || []);
        }
      } catch (err) {
        console.error('Failed to load analytics data:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter courses based on selectedCourseId and selectedLecturerId
  const filteredCourses = courses.filter(c => {
    if (selectedCourseId !== 'all' && c.id !== selectedCourseId) return false;
    if (selectedLecturerId !== 'all' && c.lecturer_id !== selectedLecturerId) return false;
    return true;
  });
  const filteredCourseIds = new Set(filteredCourses.map(c => c.id));

  // Filter sessions based on filteredCourseIds and selectedDateRange
  const now = Date.now();
  const dateRangeDays = selectedDateRange !== 'all' ? parseInt(selectedDateRange, 10) : null;

  const filteredSessions = sessions.filter(s => {
    if (!filteredCourseIds.has(s.course_id)) return false;
    if (dateRangeDays) {
      const sessionTime = new Date(s.starts_at).getTime();
      if (now - sessionTime > dateRangeDays * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });
  const filteredSessionIds = new Set(filteredSessions.map(s => s.id));

  // Filter attendance records based on filteredCourseIds, filteredSessionIds, and selectedDateRange
  const filteredRecords = records.filter(r => {
    if (!filteredCourseIds.has(r.course_id)) return false;
    if (r.session_id && !filteredSessionIds.has(r.session_id)) return false;
    if (dateRangeDays) {
      const recordDate = new Date(r.signed_at).getTime();
      if (now - recordDate > dateRangeDays * 24 * 60 * 60 * 1000) return false;
    }
    return true;
  });

  const hasData = records.length > 0;

  // Chart 1: Attendance by Course
  const courseChartData = filteredCourses.map(c => {
    const courseRecs = filteredRecords.filter(r => r.course_id === c.id);
    const present = courseRecs.filter(r => r.status === 'present').length;
    const late = courseRecs.filter(r => r.status === 'late').length;
    return {
      name: c.code,
      title: c.title,
      present,
      late,
      total: present + late,
    };
  }).filter(c => c.total > 0 || !hasData);

  // Chart 2: Attendance by Student Level (100L - 500L)
  const levels = ['100', '200', '300', '400', '500'];
  const levelChartData = levels.map(lvl => {
    const levelRecs = filteredRecords.filter(r => {
      const std = students.find(s => s.id === r.student_id || s.matric_no === r.matric_no);
      return String(std?.level || r.level) === lvl;
    });
    const present = levelRecs.filter(r => r.status === 'present').length;
    const late = levelRecs.filter(r => r.status === 'late').length;
    return {
      level: `${lvl}L`,
      present,
      late,
      total: present + late,
    };
  });

  // Chart 3: Attendance by Session Timeline
  const sessionChartData = filteredSessions
    .slice()
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .slice(-10) // last 10 sessions
    .map(s => {
      const sessionRecs = filteredRecords.filter(r => r.session_id === s.id);
      return {
        title: s.title.length > 15 ? s.title.slice(0, 15) + '...' : s.title,
        date: formatWATDate(s.starts_at),
        attendees: sessionRecs.length,
      };
    });

  // Chart 4: Present vs Late Status Breakdown
  const presentCount = filteredRecords.filter(r => r.status === 'present').length;
  const lateCount = filteredRecords.filter(r => r.status === 'late').length;
  const statusPieData = [
    { name: 'Present (On-time)', value: presentCount },
    { name: 'Late (Within Grace)', value: lateCount },
  ].filter(d => d.value > 0);

  // Chart 5: Student attendance percentage distribution (<50%, 50-75%, >=75%)
  // Fixes QA-19:
  // - Filter students to those enrolled in filteredCourses
  // - Denominator = number of held sessions in filteredCourses (per student's enrolled courses, not global)
  // - If no sessions held, shows "No sessions held" empty state
  const studentDistribution = () => {
    // 1. Identify held sessions per course in filteredCourses
    const heldSessionsPerCourse = new Map<string, string[]>();
    filteredSessions.forEach(s => {
      const isHeld = s.status === 'closed' || s.status === 'active' || s.status === 'expired' || new Date(s.starts_at).getTime() <= now;
      if (isHeld) {
        const list = heldSessionsPerCourse.get(s.course_id) || [];
        list.push(s.id);
        heldSessionsPerCourse.set(s.course_id, list);
      }
    });

    // 2. Identify students enrolled in filteredCourses
    const studentEnrolledCourses = new Map<string, Set<string>>(); // matric_no -> Set of course_id

    rosters.forEach((rost: any) => {
      if (filteredCourseIds.has(rost.course_id)) {
        const matric = (rost.matric_no || '').trim().toUpperCase();
        if (matric) {
          if (!studentEnrolledCourses.has(matric)) {
            studentEnrolledCourses.set(matric, new Set());
          }
          studentEnrolledCourses.get(matric)!.add(rost.course_id);
        }
      }
    });

    // Fallback: If no roster loaded, infer enrollment from filtered records
    if (studentEnrolledCourses.size === 0) {
      filteredRecords.forEach(r => {
        const matric = (r.matric_no || '').trim().toUpperCase();
        if (matric && filteredCourseIds.has(r.course_id)) {
          if (!studentEnrolledCourses.has(matric)) {
            studentEnrolledCourses.set(matric, new Set());
          }
          studentEnrolledCourses.get(matric)!.add(r.course_id);
        }
      });
    }

    if (studentEnrolledCourses.size === 0) return [];

    let below50 = 0;
    let between50and75 = 0;
    let above75 = 0;
    let evaluatedStudents = 0;

    studentEnrolledCourses.forEach((enrolledCourseIds, matric) => {
      let totalHeldSessions = 0;
      const validHeldSessionIds = new Set<string>();

      enrolledCourseIds.forEach(courseId => {
        const courseSessions = heldSessionsPerCourse.get(courseId) || [];
        totalHeldSessions += courseSessions.length;
        courseSessions.forEach(sid => validHeldSessionIds.add(sid));
      });

      // If denominator is 0, student has had no sessions held yet
      if (totalHeldSessions === 0) return;

      evaluatedStudents++;
      const attended = filteredRecords.filter(
        r => r.matric_no === matric && r.session_id && validHeldSessionIds.has(r.session_id)
      ).length;

      const pct = (attended / totalHeldSessions) * 100;
      if (pct < 50) below50++;
      else if (pct < 75) between50and75++;
      else above75++;
    });

    if (evaluatedStudents === 0) return [];

    return [
      { range: 'Below 50% (< 50%)', count: below50, total: evaluatedStudents },
      { range: 'Satisfactory (50% - 74%)', count: between50and75, total: evaluatedStudents },
      { range: 'High (75% - 100%)', count: above75, total: evaluatedStudents },
    ];
  };

  const distData = studentDistribution();

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-sm font-medium">Loading institutional analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Institutional Attendance Analytics</h1>
          <p className="text-sm text-slate-500">
            Real-time biometric, geofenced, and chronological attendance insights across ADUN faculties.
          </p>
        </div>

        <button
          onClick={() => setShowReportModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 active:bg-blue-950 text-white font-semibold text-xs transition shadow-xs self-start sm:self-auto"
        >
          <Printer className="w-4 h-4 text-blue-200" />
          <span>Official Executive Report</span>
        </button>
      </div>

      {/* Global Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Filter className="w-4 h-4 text-blue-700" />
          <span>Filters:</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Course filter */}
          <select
            value={selectedCourseId}
            onChange={e => setSelectedCourseId(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Courses</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>

          {/* Lecturer filter */}
          <select
            value={selectedLecturerId}
            onChange={e => setSelectedLecturerId(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Lecturers</option>
            {lecturers.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {/* Date range */}
          <select
            value={selectedDateRange}
            onChange={e => setSelectedDateRange(e.target.value)}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Time (Full Semester)</option>
            <option value="7">Last 7 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </select>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="No attendance records logged yet"
          description="Analytics and distribution charts will automatically generate as lecturers initiate lecture sessions and students sign attendance via their mobile PWA."
        />
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-xs font-semibold text-slate-500 uppercase">Filtered Records</span>
              <p className="text-3xl font-extrabold text-slate-900 mt-2">{filteredRecords.length}</p>
              <p className="text-xs text-slate-500 mt-1">Total verified submissions</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-xs font-semibold text-slate-500 uppercase">On-Time Arrivals</span>
              <p className="text-3xl font-extrabold text-blue-700 mt-2">{presentCount}</p>
              <p className="text-xs text-slate-500 mt-1">
                {filteredRecords.length ? Math.round((presentCount / filteredRecords.length) * 100) : 0}% on-time rate
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-xs font-semibold text-slate-500 uppercase">Late Arrivals</span>
              <p className="text-3xl font-extrabold text-amber-600 mt-2">{lateCount}</p>
              <p className="text-xs text-slate-500 mt-1">Within lecture grace period</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-xs font-semibold text-slate-500 uppercase">Lectures Monitored</span>
              <p className="text-3xl font-extrabold text-emerald-700 mt-2">{filteredSessions.length}</p>
              <p className="text-xs text-slate-500 mt-1">Matching selected filters</p>
            </div>
          </div>

          {/* Row 1: Attendance by Course & Status Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Attendance by Course Bar Chart */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
              <h2 className="text-base font-bold text-slate-900 mb-1">Attendance by Course</h2>
              <p className="text-xs text-slate-500 mb-5">Present vs late volume per course</p>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={courseChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', color: '#FFF' }}
                    />
                    <Legend />
                    <Bar dataKey="present" name="Present" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="late" name="Late" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Present vs Late Donut Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 mb-1">Punctuality Breakdown</h2>
                <p className="text-xs text-slate-500 mb-4">Overall arrival status proportion</p>

                <div className="h-56 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {statusPieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-4 border-t border-slate-100 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-700" />
                  <span className="text-slate-600">Present ({presentCount})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500" />
                  <span className="text-slate-600">Late ({lateCount})</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Attendance by Student Level & Session Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Level Distribution */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
              <h2 className="text-base font-bold text-slate-900 mb-1">Attendance by Academic Level</h2>
              <p className="text-xs text-slate-500 mb-5">Volume across 100L through 500L cohorts</p>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={levelChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="level" tick={{ fontSize: 12, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', color: '#FFF' }}
                    />
                    <Legend />
                    <Bar dataKey="present" name="Present" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="late" name="Late" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Attendance by Session Timeline */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
              <h2 className="text-base font-bold text-slate-900 mb-1">Session Attendance Trend</h2>
              <p className="text-xs text-slate-500 mb-5">Chronological student headcount over recent sessions</p>

              <div className="h-64">
                {sessionChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    No session timeline data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sessionChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748B' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', color: '#FFF' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="attendees"
                        stroke="#1D4ED8"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#1D4ED8' }}
                        name="Attendees"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Student Attendance Distribution */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
            <h2 className="text-base font-bold text-slate-900 mb-1">Student Attendance % Distribution</h2>
            <p className="text-xs text-slate-500 mb-4">
              Proportion of student body meeting institutional examination eligibility threshold (75% minimum)
            </p>

            {distData.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-sm italic border border-dashed border-slate-200 rounded-xl">
                No sessions held for the selected course and date criteria.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {distData.map((d, i) => (
                  <div key={d.range} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: DISTRIBUTION_COLORS[i] }}
                      />
                      <span className="text-xs font-semibold text-slate-700">{d.range}</span>
                    </div>
                    <p className="text-2xl font-extrabold text-slate-900 mt-2">{d.count} Students</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {d.total ? Math.round((d.count / d.total) * 100) : 0}% of evaluated cohort
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* OFFICIAL INSTITUTIONAL REPORT MODAL */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
            {/* Modal Controls Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between print:hidden">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base">Executive Institutional Attendance Report</h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition shadow-2xs cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Document Body */}
            <div className="p-8 sm:p-12 space-y-6 print:p-0 print:m-0">
              {/* Official Crest Header */}
              <div className="flex items-center justify-between border-b-2 border-blue-900 pb-4">
                <div>
                  <h2 className="text-xl font-black text-blue-950 tracking-tight">
                    ADMIRALTY UNIVERSITY OF NIGERIA
                  </h2>
                  <p className="text-xs font-semibold text-slate-600">
                    Office of Academic Affairs &amp; Directorate of ICT
                  </p>
                  <p className="text-[11px] text-slate-500">Ibusa / Asaba Campus, Delta State, Nigeria</p>
                </div>
                <div className="text-right text-xs">
                  <span className="font-mono px-2.5 py-1 bg-slate-100 rounded-md font-bold text-slate-800">
                    STATUS: OFFICIAL
                  </span>
                  <p className="text-[10px] text-slate-500 mt-1">Generated: {formatWATDateTime(new Date())}</p>
                </div>
              </div>

              {/* Report Title */}
              <div className="text-center py-2 bg-blue-50/60 rounded-xl border border-blue-100">
                <h3 className="text-base font-extrabold text-blue-950 uppercase tracking-wide">
                  Semester Institutional Attendance &amp; Examination Eligibility Audit
                </h3>
                <p className="text-xs text-blue-800/80">
                  Dual-GPS Geofencing, Facial Biometric Verification &amp; Option 2 Strict Hardware Binding
                </p>
              </div>

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase">Total Students</span>
                  <p className="text-xl font-black text-slate-900 mt-1">{students.length}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase">Active Courses</span>
                  <p className="text-xl font-black text-blue-900 mt-1">{filteredCourses.length}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase">Lectures Monitored</span>
                  <p className="text-xl font-black text-indigo-900 mt-1">{filteredSessions.length}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <span className="text-[11px] text-slate-500 font-semibold uppercase">Total Check-Ins</span>
                  <p className="text-xl font-black text-emerald-900 mt-1">{filteredRecords.length}</p>
                </div>
              </div>

              {/* Course-by-Course Attendance Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Course Level Attendance Performance
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                        <th className="py-2.5 px-3">Course Code</th>
                        <th className="py-2.5 px-3">Course Title</th>
                        <th className="py-2.5 px-3">On-Time</th>
                        <th className="py-2.5 px-3">Late (Grace)</th>
                        <th className="py-2.5 px-3">Total Submissions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredCourses.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-400 italic">
                            No courses matching selected filters.
                          </td>
                        </tr>
                      ) : (
                        filteredCourses.map(c => {
                          const crsRecs = filteredRecords.filter(r => r.course_id === c.id);
                          const pCount = crsRecs.filter(r => r.status === 'present').length;
                          const lCount = crsRecs.filter(r => r.status === 'late').length;
                          return (
                            <tr key={c.id}>
                              <td className="py-2 px-3 font-mono font-bold text-blue-900">{c.code}</td>
                              <td className="py-2 px-3 text-slate-800">{c.title}</td>
                              <td className="py-2 px-3 text-emerald-700 font-semibold">{pCount}</td>
                              <td className="py-2 px-3 text-amber-700 font-semibold">{lCount}</td>
                              <td className="py-2 px-3 font-bold text-slate-900">{crsRecs.length}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 75% Exam Policy Certification */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs text-slate-700">
                <p className="font-bold text-slate-900">Institutional Statutory Notice:</p>
                <p className="leading-relaxed">
                  Pursuant to Admiralty University Senate Academic Regulations, students are strictly required to attain an aggregate minimum of <strong>75% lecture attendance</strong> to be eligible to sit for semester examinations. Attendance verified under cryptographic Option 2 hardware binding is non-repudiable.
                </p>
              </div>

              {/* Signatures & Certification Block */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-xs border-t border-slate-200">
                <div className="space-y-8">
                  <div className="border-b border-slate-400 w-48" />
                  <div>
                    <p className="font-bold text-slate-900">Academic Affairs Officer</p>
                    <p className="text-slate-500 text-[11px]">Admiralty University of Nigeria</p>
                  </div>
                </div>

                <div className="space-y-8 text-right">
                  <div className="border-b border-slate-400 w-48 ml-auto" />
                  <div>
                    <p className="font-bold text-slate-900">Director of ICT &amp; Systems</p>
                    <p className="text-slate-500 text-[11px]">Admiralty University of Nigeria</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
