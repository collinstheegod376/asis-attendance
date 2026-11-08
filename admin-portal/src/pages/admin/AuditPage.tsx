import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { AppStorage } from '../../lib/storage';
import { AuditLog } from '../../types';
import {
  ShieldCheck,
  Search,
  Download,
  Filter,
  Clock,
  User,
  Activity,
  FileSpreadsheet,
  Lock,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Printer,
  X,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

const REFERENCE_CODES = [
  { code: 'BIND-200', label: 'BIND-200: Device Match Verified' },
  { code: 'BIND-201', label: 'BIND-201: Initial Device Hardware Bound' },
  { code: 'BIND-202', label: 'BIND-202: Hardware Fingerprint Mismatch' },
  { code: 'BIND-203', label: 'BIND-203: Device Cookie Token Missing' },
  { code: 'BIND-204', label: 'BIND-204: Cryptographic Cookie Mismatch' },
  { code: 'BIND-205', label: 'BIND-205: Administrative Reset Executed' },
  { code: 'BIND-206', label: 'BIND-206: Proxy / VPN Anomaly Detected' },
  { code: 'BIND-207', label: 'BIND-207: Shared Device Exception Granted' },
  { code: 'BIND-208', label: 'BIND-208: Shared Device Exception Revoked' },
  { code: 'BIND-209', label: 'BIND-209: Device Revoked / Blacklisted' },
];

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState<'all' | 'admin' | 'lecturer' | 'system'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'device_binding' | 'users' | 'courses' | 'settings'>('all');
  const [refCodeFilter, setRefCodeFilter] = useState<string>('all');
  const [selectedLogForDetail, setSelectedLogForDetail] = useState<AuditLog | null>(null);

  useEffect(() => {
    setLogs(AppStorage.getAuditLogs());
  }, []);

  const handleExport = () => {
    if (logs.length === 0) return;

    const exportRows = filteredLogs.map(l => {
      const refCode = l.reference_code || (l.metadata && l.metadata.reference_code) || 'N/A';
      return {
        'Log ID': l.id,
        'Timestamp (WAT/Lagos)': new Date(l.created_at).toLocaleString('en-GB', {
          timeZone: 'Africa/Lagos',
        }),
        'Reference Code': refCode,
        'Actor Name': l.actor_name,
        'Actor Role': l.actor_role,
        'Action': l.action,
        'Target Entity': l.entity,
        'Entity ID': l.entity_id || 'N/A',
        'Metadata': l.metadata ? JSON.stringify(l.metadata) : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit_Trail');
    XLSX.writeFile(wb, `ADUN_Security_Audit_Trail_${Date.now()}.xlsx`);
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      const q = search.trim().toLowerCase();
      const ref = (l.reference_code || (l.metadata && l.metadata.reference_code) || '').toLowerCase();

      // Search matches
      const matchesSearch =
        !q ||
        l.actor_name.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.entity.toLowerCase().includes(q) ||
        (l.entity_id && l.entity_id.toLowerCase().includes(q)) ||
        ref.includes(q) ||
        (l.metadata && JSON.stringify(l.metadata).toLowerCase().includes(q));

      // Role filter
      const matchesRole = filterRole === 'all' || l.actor_role === filterRole;

      // Category filter
      let matchesCategory = true;
      if (categoryFilter === 'device_binding') {
        matchesCategory =
          l.entity === 'device_bindings' ||
          l.action.toLowerCase().includes('device') ||
          Boolean(ref);
      } else if (categoryFilter === 'users') {
        matchesCategory = l.entity === 'users' || l.action.toLowerCase().includes('user') || l.action.toLowerCase().includes('lecturer');
      } else if (categoryFilter === 'courses') {
        matchesCategory =
          l.entity === 'courses' ||
          l.entity === 'course_roster' ||
          l.entity === 'sessions' ||
          l.action.toLowerCase().includes('course');
      } else if (categoryFilter === 'settings') {
        matchesCategory = l.entity === 'settings' || l.action.toLowerCase().includes('settings');
      }

      // Reference code filter
      let matchesRefCode = true;
      if (refCodeFilter !== 'all') {
        matchesRefCode = ref === refCodeFilter.toLowerCase();
      }

      return matchesSearch && matchesRole && matchesCategory && matchesRefCode;
    });
  }, [logs, search, filterRole, categoryFilter, refCodeFilter]);

  // Count device binding events
  const deviceSecurityEventCount = logs.filter(
    l => l.entity === 'device_bindings' || l.action.toLowerCase().includes('device') || l.reference_code
  ).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Official Institutional Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src="/adun-logo.png"
            alt="ADUN Logo"
            className="w-12 h-12 object-contain shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 tracking-wider uppercase">
                Directorate of ICT &bull; Security Log
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              Institutional Audit Trail &amp; Telemetry
            </h1>
            <p className="text-xs text-slate-500">
              Immutable, non-repudiable audit ledger capturing strict device binding events, administrative resets, and policy modifications.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleExport}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export Audit Trail (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by reference code (BIND-201, BIND-205), actor, action, or metadata..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Security / Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Category:</span>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value as any)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Categories ({logs.length})</option>
              <option value="device_binding">
                Device Binding Security ({deviceSecurityEventCount})
              </option>
              <option value="users">User &amp; Auth Governance</option>
              <option value="courses">Courses &amp; Roster</option>
              <option value="settings">System Settings</option>
            </select>
          </div>

          {/* Reference Code Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Ref Code:</span>
            <select
              value={refCodeFilter}
              onChange={e => setRefCodeFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600 max-w-[170px]"
            >
              <option value="all">All Ref Codes</option>
              {REFERENCE_CODES.map(rc => (
                <option key={rc.code} value={rc.code}>
                  {rc.code}
                </option>
              ))}
            </select>
          </div>

          {/* Actor Role Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Role:</span>
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value as any)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Roles</option>
              <option value="admin">Admin</option>
              <option value="lecturer">Lecturer</option>
              <option value="system">System Core</option>
            </select>
          </div>
        </div>
      </div>

      {/* Quick Security Category Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400 font-medium text-[11px]">Quick Filters:</span>
        <button
          onClick={() => {
            setCategoryFilter('device_binding');
            setRefCodeFilter('all');
          }}
          className={`px-3 py-1 rounded-lg border text-xs font-medium transition inline-flex items-center gap-1.5 ${
            categoryFilter === 'device_binding' && refCodeFilter === 'all'
              ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>All Device Security Events ({deviceSecurityEventCount})</span>
        </button>

        <button
          onClick={() => {
            setCategoryFilter('device_binding');
            setRefCodeFilter('BIND-205');
          }}
          className={`px-3 py-1 rounded-lg border text-xs font-medium transition inline-flex items-center gap-1.5 ${
            refCodeFilter === 'BIND-205'
              ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="font-mono font-bold">BIND-205</span>
          <span>(Admin Resets)</span>
        </button>

        <button
          onClick={() => {
            setCategoryFilter('device_binding');
            setRefCodeFilter('BIND-201');
          }}
          className={`px-3 py-1 rounded-lg border text-xs font-medium transition inline-flex items-center gap-1.5 ${
            refCodeFilter === 'BIND-201'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="font-mono font-bold">BIND-201</span>
          <span>(Device Bound)</span>
        </button>

        <button
          onClick={() => {
            setCategoryFilter('device_binding');
            setRefCodeFilter('BIND-207');
          }}
          className={`px-3 py-1 rounded-lg border text-xs font-medium transition inline-flex items-center gap-1.5 ${
            refCodeFilter === 'BIND-207'
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <span className="font-mono font-bold">BIND-207</span>
          <span>(Shared Device Exception)</span>
        </button>

        {(categoryFilter !== 'all' || refCodeFilter !== 'all' || search) && (
          <button
            onClick={() => {
              setCategoryFilter('all');
              setRefCodeFilter('all');
              setSearch('');
              setFilterRole('all');
            }}
            className="text-[11px] text-slate-500 hover:text-slate-800 underline ml-2"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Main Table or Empty State */}
      {filteredLogs.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={search || refCodeFilter !== 'all' ? 'No audit records match your filter criteria' : 'No audit records in system'}
          description="All sensitive administrative actions, device binding resets, and security modifications will automatically be cataloged here."
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto max-h-[680px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-xs z-10 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Lagos Timestamp (WAT)</th>
                  <th className="py-3 px-4">Reference Code</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4">Audit Metadata &amp; Justification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map(log => {
                  const refCode = log.reference_code || (log.metadata && log.metadata.reference_code);
                  const isDeviceSecurity =
                    log.entity === 'device_bindings' ||
                    log.action.toLowerCase().includes('device') ||
                    Boolean(refCode);

                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-slate-50/80 transition ${
                        isDeviceSecurity ? 'bg-blue-50/25' : ''
                      }`}
                    >
                      {/* Lagos Timestamp */}
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap text-[11px]">
                        {new Date(log.created_at).toLocaleString('en-GB', {
                          timeZone: 'Africa/Lagos',
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}{' '}
                        <span className="text-[10px] text-slate-400">WAT</span>
                      </td>

                      {/* Reference Code Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {refCode ? (
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-900 text-white tracking-wide shadow-2xs">
                            {refCode}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono text-xs">—</span>
                        )}
                      </td>

                      {/* Actor */}
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {log.actor_name}
                      </td>

                      {/* Actor Role */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            log.actor_role === 'admin'
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : log.actor_role === 'lecturer'
                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {log.actor_role}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 font-mono font-bold text-blue-900 whitespace-nowrap">
                        {log.action}
                      </td>

                      {/* Target Entity */}
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                          {log.entity}
                        </span>
                        {log.entity_id && (
                          <span className="text-slate-400 ml-1 font-mono text-[10px]">
                            #{log.entity_id.slice(-6)}
                          </span>
                        )}
                      </td>

                      {/* Audit Metadata */}
                      <td className="py-3 px-4 max-w-sm">
                        {log.metadata ? (
                          <div className="space-y-0.5">
                            {log.metadata.reason && (
                              <p className="font-medium text-slate-900 text-xs">
                                &ldquo;{log.metadata.reason}&rdquo;
                              </p>
                            )}
                            {log.metadata.matric_no && (
                              <p className="font-mono text-[11px] text-blue-800">
                                Student: {log.metadata.matric_no}{' '}
                                {log.metadata.student_name ? `(${log.metadata.student_name})` : ''}
                              </p>
                            )}
                            <p
                              className="font-mono text-[10px] text-slate-400 truncate max-w-xs cursor-pointer hover:text-slate-700"
                              onClick={() => setSelectedLogForDetail(log)}
                              title="Click to view full JSON payload"
                            >
                              {JSON.stringify(log.metadata)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail JSON Modal */}
      {selectedLogForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-base">Audit Event Payload Detail</h3>
              <button
                onClick={() => setSelectedLogForDetail(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-500">Log ID: {selectedLogForDetail.id}</span>
                <span className="font-mono font-bold text-blue-700">
                  {selectedLogForDetail.action}
                </span>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto max-h-80">
                {JSON.stringify(selectedLogForDetail, null, 2)}
              </pre>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setSelectedLogForDetail(null)}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
