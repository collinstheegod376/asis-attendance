import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AdminService } from '../../services/adminService';
import { isSupabaseConfigured } from '../../lib/supabase';
import { SystemSettings, AuditLog } from '../../types';
import {
  Users,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  UploadCloud,
  Sliders,
  ShieldCheck,
  MapPin,
  Clock,
  Sparkles,
  ArrowRight,
  UserPlus,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

export const AdminHomePage: React.FC = () => {
  const [metrics, setMetrics] = useState({
    totalLecturers: 0,
    activeLecturers: 0,
    totalCourses: 0,
    activeCourses: 0,
    totalSessions: 0,
    totalAttendance: 0,
    presentCount: 0,
    lateCount: 0,
    totalStudentsMaster: 0,
  });
  const [settings, setSettings] = useState<SystemSettings>({
    location_mode: 'evidence_only',
    campus_center_lat: 6.2235,
    campus_center_lng: 6.6180,
    campus_radius_m: 1500,
    location_accuracy_threshold_m: 50,
    default_session_duration_minutes: 60,
    max_session_duration_minutes: 180,
    selfie_retention_days: 90,
    grace_minutes: 15,
    max_active_courses_per_lecturer: 9,
    rate_limit_token_per_minute: 60,
    rate_limit_matric_per_minute: 30,
    updated_at: new Date().toISOString(),
  });
  const [recentAudits, setRecentAudits] = useState<AuditLog[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [overview, sysSettings, audits] = await Promise.all([
          AdminService.getAnalyticsOverview(),
          AdminService.getSettings(),
          AdminService.getAuditLogs(5),
        ]);
        if (isMounted) {
          setMetrics(overview);
          setSettings(sysSettings);
          setRecentAudits(audits.slice(0, 5));
        }
      } catch (err) {
        console.error('Failed to load admin overview:', err);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Welcome & System Status Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 rounded-2xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-blue-200 text-xs font-medium backdrop-blur-xs mb-3 border border-white/15">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Core Attendance Engine Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Admiralty University Executive Control
            </h1>
            <p className="text-blue-100/80 text-sm max-w-2xl mt-1.5 leading-relaxed">
              Institutional oversight for student identity verification, geofenced lecture sessions, and tamper-evident attendance records.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/admin/lecturers"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-blue-900 hover:bg-blue-50 active:bg-blue-100 text-sm font-semibold transition shadow-xs"
            >
              <UserPlus className="w-4 h-4 text-blue-700" />
              <span>Create Lecturer</span>
            </Link>
            <Link
              to="/admin/students"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-700/80 hover:bg-blue-700 border border-blue-500/50 text-white text-sm font-semibold transition"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Master Roster</span>
            </Link>
          </div>
        </div>

        {/* Decorative background circle */}
        <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/5 rounded-full blur-2xl pointer-events-none" />
      </div>

      {/* 4 Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Lecturers */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Lecturers
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {metrics.totalLecturers}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span className="font-semibold text-blue-700">{metrics.activeLecturers} Active</span>
              <span>&bull;</span>
              <span>{metrics.totalLecturers - metrics.activeLecturers} Inactive</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/admin/lecturers" className="text-blue-700 hover:text-blue-800 font-medium inline-flex items-center gap-1">
              Manage accounts &rarr;
            </Link>
          </div>
        </div>

        {/* Courses */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active Courses
            </span>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {metrics.activeCourses}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span className="text-slate-600">{metrics.totalCourses} Total registered</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/admin/courses" className="text-blue-700 hover:text-blue-800 font-medium inline-flex items-center gap-1">
              View course roster &rarr;
            </Link>
          </div>
        </div>

        {/* Sessions */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Lecture Sessions
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
              <CalendarDays className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {metrics.totalSessions}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span className="text-emerald-700 font-medium">Classroom tokens generated</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/admin/analytics" className="text-blue-700 hover:text-blue-800 font-medium inline-flex items-center gap-1">
              Session metrics &rarr;
            </Link>
          </div>
        </div>

        {/* Attendance Volume */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Attendance Records
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-extrabold text-slate-900">
              {metrics.totalAttendance}
            </span>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
              <span className="text-emerald-600 font-semibold">{metrics.presentCount} Present</span>
              <span>&bull;</span>
              <span className="text-amber-600 font-semibold">{metrics.lateCount} Late</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <Link to="/admin/analytics" className="text-blue-700 hover:text-blue-800 font-medium inline-flex items-center gap-1">
              Attendance logs &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Operational Policy & Quick Status Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Policy & Geofence overview */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-slate-900">System Security &amp; Policy Rules</h2>
              <p className="text-xs text-slate-500">Live configuration enforced across mobile PWA and edge endpoints</p>
            </div>
            <Link
              to="/admin/settings"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Modify</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-blue-800">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Location Enforcement</p>
                <p className="text-sm font-bold text-slate-800 capitalize mt-0.5">
                  {settings.location_mode === 'enforce' ? 'Geofence Enforced (Strict)' : 'Evidence Only (Captured)'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Threshold: {settings.location_accuracy_threshold_m}m accuracy radius
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-indigo-100 text-indigo-800">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Lecture Session Durations</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  Default {settings.default_session_duration_minutes}m &bull; Max {settings.max_session_duration_minutes}m
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Grace Period: {settings.grace_minutes}m (Late marking window)
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Selfie Retention Policy</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  {settings.selfie_retention_days} Days Retention
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Private bucket with temporary signed preview URLs
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Course Quota Allocation</p>
                <p className="text-sm font-bold text-slate-800 mt-0.5">
                  Up to {settings.max_active_courses_per_lecturer} Active Courses
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Enforces lecturer capacity; archived courses exempt
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Database & Connection Status */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Infrastructure Status</h2>
            <p className="text-xs text-slate-500 mb-4">Backend connector and master student state</p>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${isSupabaseConfigured ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                  <span className="text-xs font-semibold text-slate-700">Storage Engine</span>
                </div>
                <span className="text-xs font-mono font-medium text-slate-600">
                  {isSupabaseConfigured ? 'Supabase Cloud' : 'Local Reactive Engine'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${metrics.totalStudentsMaster > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-xs font-semibold text-slate-700">Master Directory</span>
                </div>
                <span className="text-xs font-semibold text-slate-800">
                  {metrics.totalStudentsMaster} Students Loaded
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-slate-700">Timezone Anchor</span>
                </div>
                <span className="text-xs font-mono font-medium text-slate-600">
                  Africa/Lagos (WAT)
                </span>
              </div>
            </div>
          </div>

          {metrics.totalStudentsMaster === 0 && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <p className="font-semibold mb-0.5">Master directory is empty</p>
              <p className="text-[11px] text-amber-800 mb-2">
                Upload your official matriculation roster (.xlsx or .csv) so lecturers can assign course rosters.
              </p>
              <Link
                to="/admin/students"
                className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800"
              >
                Upload master spreadsheet &rarr;
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Recent Audit Stream */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">System Activity Stream</h2>
            <p className="text-xs text-slate-500">Immutable chronological audit log</p>
          </div>
          <Link
            to="/admin/audit"
            className="text-xs font-semibold text-blue-700 hover:text-blue-800 inline-flex items-center gap-1"
          >
            <span>View All Logs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentAudits.length === 0 ? (
          <EmptyState
            title="No activity recorded yet"
            description="All administrative operations, logins, lecturer creations, and settings updates will be immutably recorded here."
          />
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            {recentAudits.map((log: AuditLog) => {
              const actorDisplay = log.actor_name || log.actor_role || 'System';
              const initial = actorDisplay.charAt(0).toUpperCase();
              return (
                <div key={log.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                      {initial}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{log.action}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase font-mono">
                          {log.actor_role}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        By {actorDisplay} on {log.entity} {log.entity_id ? `(${log.entity_id})` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-right text-slate-400 font-mono text-[11px] shrink-0">
                    {new Date(log.created_at).toLocaleString('en-GB', {
                      timeZone: 'Africa/Lagos',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
