import React, { useState, useEffect, useMemo } from 'react';
import { AppStorage } from '../../lib/storage';
import { DeviceBinding, DeviceEvent, StudentMaster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  Smartphone,
  Search,
  RotateCcw,
  ShieldCheck,
  AlertCircle,
  Info,
  Clock,
  CheckCircle2,
  X,
  Copy,
  Check,
  Users,
  ShieldAlert,
  SlidersHorizontal,
  FileText,
  Activity,
  History,
  Lock,
  Unlock,
  AlertTriangle,
  Ban,
  Filter,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

function formatWAT(isoString?: string | null): string {
  if (!isoString) return 'N/A';
  try {
    return (
      new Date(isoString).toLocaleString('en-GB', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }) + ' WAT'
    );
  } catch {
    return isoString;
  }
}

function parseUserAgent(ua?: string): { browser: string; os: string; full: string } {
  if (!ua) return { browser: 'Standard Browser', os: 'Mobile Device', full: 'Generic Web Agent' };
  let os = 'Unknown OS';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg/i.test(ua)) browser = 'Edge';
  else if (/Chrome|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';

  return { browser, os, full: ua };
}

const EVENT_TYPE_CONFIG: Record<string, { label: string; badge: string; defaultCode: string }> = {
  bind: {
    label: 'Device Bound',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultCode: 'BIND-201',
  },
  match: {
    label: 'Fingerprint Match',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    defaultCode: 'BIND-200',
  },
  mismatch: {
    label: 'Device Mismatch',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    defaultCode: 'BIND-202',
  },
  cookie_missing: {
    label: 'Cookie Missing',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    defaultCode: 'BIND-203',
  },
  cookie_mismatch: {
    label: 'Cookie Mismatch',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    defaultCode: 'BIND-204',
  },
  admin_reset: {
    label: 'Admin Reset',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    defaultCode: 'BIND-205',
  },
  proxy_detected: {
    label: 'Proxy / Anomaly',
    badge: 'bg-red-50 text-red-700 border-red-200',
    defaultCode: 'BIND-206',
  },
  device_reset: {
    label: 'Device Reset',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    defaultCode: 'BIND-205',
  },
  device_bound: {
    label: 'Device Bound',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultCode: 'BIND-201',
  },
  binding_conflict: {
    label: 'Binding Conflict',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    defaultCode: 'BIND-202',
  },
  proxy_flagged: {
    label: 'Proxy Flagged',
    badge: 'bg-red-50 text-red-700 border-red-200',
    defaultCode: 'BIND-206',
  },
};

const COMMON_REASONS = [
  'Student acquired a replacement smartphone / device',
  'Browser local storage and cookies were cleared by user',
  'Operating system or browser reinstall rendered token invalid',
  'Student lost previous registered device (Helpdesk ticket logged)',
  'Lecturer authorized emergency in-class unbind due to device failure',
  'Documented sibling/family shared device exception verified',
];

export const DeviceBindingsPage: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [bindings, setBindings] = useState<DeviceBinding[]>([]);
  const [students, setStudents] = useState<StudentMaster[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'reset' | 'revoked'>('all');
  const [sharedFilter, setSharedFilter] = useState<'all' | 'shared_only' | 'dedicated_only'>('all');

  // Selected student for Forensic Event Log
  const [selectedStudent, setSelectedStudent] = useState<{
    student_id: string;
    matric_no: string;
    student_name: string;
  } | null>(null);
  const [forensicEvents, setForensicEvents] = useState<DeviceEvent[]>([]);

  // Notification states
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Modals
  const [resetModalBinding, setResetModalBinding] = useState<DeviceBinding | null>(null);
  const [resetReason, setResetReason] = useState('');
  const [resetError, setResetError] = useState('');
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  const [sharedModalBinding, setSharedModalBinding] = useState<DeviceBinding | null>(null);
  const [sharedReason, setSharedReason] = useState('');
  const [sharedError, setSharedError] = useState('');

  const [revokeModalBinding, setRevokeModalBinding] = useState<DeviceBinding | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeError, setRevokeError] = useState('');

  // Rate limit status for current admin
  const rateLimitStatus = useMemo(() => {
    if (!currentAdmin) return { allowed: true, remaining: 50, countInLastHour: 0 };
    return AppStorage.checkAdminResetRateLimit(currentAdmin.id);
  }, [currentAdmin, bindings]);

  const loadData = () => {
    const loadedBindings = AppStorage.getDeviceBindings();
    setBindings(loadedBindings);
    setStudents(AppStorage.getStudentsMaster());

    if (selectedStudent) {
      const events = AppStorage.getStudentDeviceEvents(selectedStudent.matric_no, 20);
      setForensicEvents(events);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedStudent) {
      const events = AppStorage.getStudentDeviceEvents(selectedStudent.matric_no, 20);
      setForensicEvents(events);
    } else {
      setForensicEvents([]);
    }
  }, [selectedStudent]);

  // Copy hash helper
  const handleCopyHash = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Reset Binding Handler
  const handleOpenResetModal = (binding: DeviceBinding) => {
    setResetModalBinding(binding);
    setResetReason('');
    setResetError('');
  };

  const handleConfirmReset = () => {
    if (!resetModalBinding || !currentAdmin) return;

    if (!resetReason.trim()) {
      setResetError('A mandatory justification reason is required before resetting a device binding.');
      return;
    }

    if (resetReason.trim().length < 5) {
      setResetError('Justification reason must be at least 5 characters long.');
      return;
    }

    setIsSubmittingReset(true);
    const result = AppStorage.resetDeviceBinding(resetModalBinding.id, resetReason.trim(), {
      id: currentAdmin.id,
      name: currentAdmin.name,
    });
    setIsSubmittingReset(false);

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: `Device lock successfully reset for ${resetModalBinding.student_name} (${resetModalBinding.matric_no}). Reference Code: BIND-205 recorded in forensic log.`,
      });
      setResetModalBinding(null);
      loadData();
      if (selectedStudent?.matric_no === resetModalBinding.matric_no) {
        setForensicEvents(AppStorage.getStudentDeviceEvents(resetModalBinding.matric_no, 20));
      }
    } else {
      setResetError(result.error || 'Failed to execute device reset.');
    }
  };

  // Shared Device Toggle Handler
  const handleOpenSharedModal = (binding: DeviceBinding) => {
    setSharedModalBinding(binding);
    setSharedReason(
      binding.is_shared
        ? 'Revoking shared device exception; reverting student to single-device enforcement'
        : 'Documented sibling or household shared tablet verified by faculty coordinator'
    );
    setSharedError('');
  };

  const handleConfirmSharedToggle = () => {
    if (!sharedModalBinding || !currentAdmin) return;

    if (!sharedReason.trim()) {
      setSharedError('A documentation reason is required when modifying shared device policy.');
      return;
    }

    const newSharedState = !sharedModalBinding.is_shared;
    const result = AppStorage.toggleSharedDevice(
      sharedModalBinding.id,
      newSharedState,
      sharedReason.trim(),
      { id: currentAdmin.id, name: currentAdmin.name }
    );

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: newSharedState
          ? `Shared device exception granted for ${sharedModalBinding.student_name}. Documented in BIND-207 audit trail.`
          : `Shared device exception revoked for ${sharedModalBinding.student_name}. Restored to strict single-device lock (BIND-208).`,
      });
      setSharedModalBinding(null);
      loadData();
      if (selectedStudent?.matric_no === sharedModalBinding.matric_no) {
        setForensicEvents(AppStorage.getStudentDeviceEvents(sharedModalBinding.matric_no, 20));
      }
    } else {
      setSharedError(result.error || 'Failed to update shared device status.');
    }
  };

  // Revoke Binding Handler
  const handleOpenRevokeModal = (binding: DeviceBinding) => {
    setRevokeModalBinding(binding);
    setRevokeReason('');
    setRevokeError('');
  };

  const handleConfirmRevoke = () => {
    if (!revokeModalBinding || !currentAdmin) return;

    if (!revokeReason.trim()) {
      setRevokeError('A mandatory justification reason is required to revoke a device binding.');
      return;
    }

    const result = AppStorage.revokeDeviceBinding(revokeModalBinding.id, revokeReason.trim(), {
      id: currentAdmin.id,
      name: currentAdmin.name,
    });

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: `Device binding revoked and blacklisted for ${revokeModalBinding.student_name} (${revokeModalBinding.matric_no}). Logged as BIND-209.`,
      });
      setRevokeModalBinding(null);
      loadData();
      if (selectedStudent?.matric_no === revokeModalBinding.matric_no) {
        setForensicEvents(AppStorage.getStudentDeviceEvents(revokeModalBinding.matric_no, 20));
      }
    } else {
      setRevokeError(result.error || 'Failed to revoke device binding.');
    }
  };

  // Filter bindings
  const filteredBindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bindings.filter(b => {
      // Search
      const matchesSearch =
        !q ||
        b.matric_no.toLowerCase().includes(q) ||
        b.student_name.toLowerCase().includes(q) ||
        b.device_id.toLowerCase().includes(q) ||
        (b.device_fingerprint_hash && b.device_fingerprint_hash.toLowerCase().includes(q)) ||
        (b.user_agent && b.user_agent.toLowerCase().includes(q));

      // Status filter
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;

      // Shared filter
      const matchesShared =
        sharedFilter === 'all' ||
        (sharedFilter === 'shared_only' && b.is_shared) ||
        (sharedFilter === 'dedicated_only' && !b.is_shared);

      return matchesSearch && matchesStatus && matchesShared;
    });
  }, [bindings, search, statusFilter, sharedFilter]);

  // Metrics overview
  const totalBindings = bindings.length;
  const activeCount = bindings.filter(b => b.status === 'active').length;
  const resetCount = bindings.filter(b => b.status === 'reset').length;
  const revokedCount = bindings.filter(b => b.status === 'revoked').length;
  const sharedExceptionsCount = bindings.filter(b => b.is_shared).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-blue-100 text-blue-800 text-[11px] font-bold tracking-wide uppercase mb-1">
            <Lock className="w-3.5 h-3.5 text-blue-700" />
            <span>Option 2: Strict Device Binding Protocol</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Device Binding Administration
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cryptographic hardware fingerprint locking, forensic telemetry, and administrative reset governance.
          </p>
        </div>

        {/* Rate limit status badge */}
        <div className="flex items-center gap-3">
          <div
            className={`px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-2.5 shadow-2xs ${
              rateLimitStatus.remaining <= 5
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : rateLimitStatus.remaining <= 15
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <Activity className="w-4 h-4 shrink-0" />
            <div>
              <span className="font-bold">Hourly Reset Quota: </span>
              <span className="font-mono">{rateLimitStatus.countInLastHour}/50 used</span>
              <span className="text-[11px] text-slate-500 ml-1.5">
                ({rateLimitStatus.remaining} remaining)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Protocol Alert Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-sm flex items-start gap-3.5 border border-blue-800">
        <ShieldCheck className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <p className="font-bold text-white text-sm">
            Institutional Hardware Governance Policy (Option 2 Enforced)
          </p>
          <p className="text-blue-100/90 leading-relaxed">
            Upon check-in, each student’s matriculation number is tied cryptographically to a unique SHA-256 device fingerprint token. Multiple students checking in from the identical device will be automatically rejected with code <span className="font-mono text-amber-300 font-semibold">BIND-202</span> (Device Mismatch) to prevent buddy signing.
          </p>
          <p className="text-blue-200/80 text-[11px]">
            Family/sibling exceptions can be granted via the <span className="font-bold text-white">Shared Device Flag</span> toggle. Administrative resets are logged with non-repudiable audit trails and strictly capped at 50 resets/hour per administrator.
          </p>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl border text-sm flex items-center justify-between shadow-2xs ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <span className="font-medium text-xs sm:text-sm">{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 5 KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Total Bound Devices
          </span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{totalBindings}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Cataloged in registry</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
            Active Locks
          </span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1">{activeCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Strict enforcement live</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">
            Reset / Unbound
          </span>
          <p className="text-2xl font-extrabold text-amber-700 mt-1">{resetCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Pending new device</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider block">
            Revoked Locks
          </span>
          <p className="text-2xl font-extrabold text-rose-700 mt-1">{revokedCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Blacklisted devices</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs col-span-2 sm:col-span-1">
          <span className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider block">
            Shared Exceptions
          </span>
          <p className="text-2xl font-extrabold text-indigo-700 mt-1">{sharedExceptionsCount}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Documented sibling/family</p>
        </div>
      </div>

      {/* Filter and Search Control Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by student matric, name, device fingerprint (SHA-256), or user agent..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Statuses ({totalBindings})</option>
              <option value="active">Active Only ({activeCount})</option>
              <option value="reset">Reset Only ({resetCount})</option>
              <option value="revoked">Revoked Only ({revokedCount})</option>
            </select>
          </div>

          {/* Shared Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 font-medium">Device Type:</span>
            <select
              value={sharedFilter}
              onChange={e => setSharedFilter(e.target.value as any)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Types</option>
              <option value="shared_only">Shared Exceptions ({sharedExceptionsCount})</option>
              <option value="dedicated_only">Dedicated Single-Device</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table or Empty State */}
      {filteredBindings.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title={search ? 'No device bindings match your filter query' : 'No student devices bound yet'}
          description={
            search
              ? 'Try adjusting your search criteria or filter options.'
              : 'As students verify their matriculation credentials on the ADUN Student PWA, their cryptographic device fingerprints will automatically populate here under Option 2 Strict Binding.'
          }
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Student &amp; Matriculation</th>
                  <th className="py-3 px-4">Device Fingerprint Hash</th>
                  <th className="py-3 px-4">Browser &amp; User Agent</th>
                  <th className="py-3 px-4">First Bound / Last Seen (WAT)</th>
                  <th className="py-3 px-4">Binding Status</th>
                  <th className="py-3 px-4">Shared Device Flag</th>
                  <th className="py-3 px-4 text-right">Administrative Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredBindings.map(binding => {
                  const isActive = binding.status === 'active';
                  const isReset = binding.status === 'reset';
                  const isRevoked = binding.status === 'revoked';
                  const isSelected = selectedStudent?.matric_no === binding.matric_no;
                  const uaInfo = parseUserAgent(binding.user_agent);

                  // Shortened fingerprint hash representation
                  const rawHash = binding.device_fingerprint_hash || binding.device_id || '';
                  const shortHash =
                    rawHash.length > 20
                      ? `${rawHash.slice(0, 10)}...${rawHash.slice(-8)}`
                      : rawHash || 'SHA-256_UNKNOWN';

                  return (
                    <tr
                      key={binding.id}
                      className={`transition ${
                        isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Student & Matric */}
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() =>
                            setSelectedStudent({
                              student_id: binding.student_id,
                              matric_no: binding.matric_no,
                              student_name: binding.student_name,
                            })
                          }
                          className="text-left group"
                          title="Click to view full forensic telemetry"
                        >
                          <p className="font-mono font-bold text-blue-900 group-hover:text-blue-700 flex items-center gap-1.5">
                            {binding.matric_no}
                            <span className="text-[10px] font-sans px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-800 transition">
                              Forensics &rarr;
                            </span>
                          </p>
                          <p className="font-semibold text-slate-800 text-xs mt-0.5">
                            {binding.student_name}
                          </p>
                        </button>
                      </td>

                      {/* Shortened Fingerprint Hash */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded-md border border-slate-200"
                            title={rawHash}
                          >
                            SHA-256: {shortHash}
                          </span>
                          <button
                            onClick={() => handleCopyHash(rawHash)}
                            title="Copy full cryptographic fingerprint hash"
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition"
                          >
                            {copiedHash === rawHash ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[200px]">
                          Matric Hash: {binding.matric_hash?.slice(0, 16)}...
                        </div>
                      </td>

                      {/* Browser & User Agent */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            {uaInfo.browser} on {uaInfo.os}
                          </span>
                        </div>
                        <p
                          className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5"
                          title={uaInfo.full}
                        >
                          {uaInfo.full}
                        </p>
                      </td>

                      {/* First Bound & Last Seen WAT */}
                      <td className="py-3.5 px-4 space-y-0.5 text-[11px]">
                        <div>
                          <span className="text-slate-400">First Bound: </span>
                          <span className="font-mono text-slate-700 font-medium">
                            {formatWAT(binding.first_bound_at)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Last Seen: </span>
                          <span className="font-mono text-slate-700 font-medium">
                            {formatWAT(binding.last_seen_at)}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {isActive && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            Active Lock
                          </span>
                        )}
                        {isReset && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Unlock className="w-3 h-3" />
                            Reset / Unbound
                          </span>
                        )}
                        {isRevoked && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <Ban className="w-3 h-3" />
                            Revoked / Banned
                          </span>
                        )}
                        {binding.reset_reason && (
                          <p
                            className="text-[10px] text-slate-500 italic mt-1 truncate max-w-[150px]"
                            title={`Reset justification: ${binding.reset_reason}`}
                          >
                            Reason: {binding.reset_reason}
                          </p>
                        )}
                      </td>

                      {/* Shared Device Flag */}
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => handleOpenSharedModal(binding)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                            binding.is_shared
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                          title="Click to toggle shared family/sibling device exception"
                        >
                          <Users className="w-3 h-3 shrink-0" />
                          <span>{binding.is_shared ? 'Shared Exception' : 'Dedicated'}</span>
                        </button>
                        {binding.is_shared && binding.shared_reason && (
                          <p
                            className="text-[10px] text-indigo-600/90 truncate max-w-[130px] mt-0.5"
                            title={`Documented Reason: ${binding.shared_reason}`}
                          >
                            {binding.shared_reason}
                          </p>
                        )}
                      </td>

                      {/* Administrative Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Reset button */}
                          <button
                            onClick={() => handleOpenResetModal(binding)}
                            disabled={!rateLimitStatus.allowed}
                            title={
                              rateLimitStatus.allowed
                                ? 'Reset student device lock (allows new device binding on next check-in)'
                                : 'Hourly admin rate limit reached (50/50 resets used)'
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition border border-amber-200 shadow-2xs"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset</span>
                          </button>

                          {/* Revoke button */}
                          {!isRevoked && (
                            <button
                              onClick={() => handleOpenRevokeModal(binding)}
                              title="Revoke and blacklist this device binding"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition border border-transparent hover:border-rose-200"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Forensics quick select */}
                          <button
                            onClick={() =>
                              setSelectedStudent({
                                student_id: binding.student_id,
                                matric_no: binding.matric_no,
                                student_name: binding.student_name,
                              })
                            }
                            title="Inspect forensic telemetry log"
                            className={`p-1.5 rounded-lg transition border ${
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50 border-slate-200'
                            }`}
                          >
                            <Activity className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FORENSIC EVENT LOG (Display last 20 device_events for selected student) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-700" />
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Forensic Device Telemetry Ledger
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time forensic telemetry displaying the last 20 verification &amp; binding events for audit inspection.
            </p>
          </div>

          {selectedStudent ? (
            <div className="flex items-center gap-2">
              <span className="text-xs bg-blue-50 text-blue-800 border border-blue-200 px-3 py-1 rounded-xl font-medium">
                Inspecting: <strong className="font-mono">{selectedStudent.matric_no}</strong> ({selectedStudent.student_name})
              </span>
              <button
                onClick={() => setSelectedStudent(null)}
                className="text-xs text-slate-500 hover:text-slate-800 p-1 hover:bg-slate-100 rounded-lg transition"
                title="Clear selected student"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">
              Select a student above to inspect their dedicated forensic trace
            </span>
          )}
        </div>

        {forensicEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
            <History className="w-8 h-8 text-slate-300" />
            <p>
              {selectedStudent
                ? `No forensic security events recorded yet for ${selectedStudent.matric_no}. Events populate as the student checks in or resets locks.`
                : 'No student currently selected for forensic telemetry. Click on any student row in the table above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Timestamp (WAT)</th>
                  <th className="py-2.5 px-3">Event Type</th>
                  <th className="py-2.5 px-3">Reference Code</th>
                  <th className="py-2.5 px-3">IP Address</th>
                  <th className="py-2.5 px-3">Forensic Metadata &amp; Justification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {forensicEvents.map(evt => {
                  const cfg = EVENT_TYPE_CONFIG[evt.event_type] || {
                    label: evt.event_type,
                    badge: 'bg-slate-100 text-slate-700 border-slate-200',
                    defaultCode: evt.reference_code || 'BIND-200',
                  };
                  const code = evt.reference_code || cfg.defaultCode;

                  return (
                    <tr key={evt.id} className="hover:bg-slate-50/60 transition">
                      {/* Timestamp WAT */}
                      <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap text-[11px]">
                        {formatWAT(evt.created_at)}
                      </td>

                      {/* Event Type */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${cfg.badge}`}
                        >
                          {cfg.label}
                        </span>
                      </td>

                      {/* Reference Code */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-900 text-white tracking-wide">
                          {code}
                        </span>
                      </td>

                      {/* IP Address */}
                      <td className="py-3 px-3 font-mono text-slate-700 text-[11px] whitespace-nowrap">
                        {evt.ip_address || '127.0.0.1'}
                      </td>

                      {/* Metadata / Reason */}
                      <td className="py-3 px-3 text-slate-600">
                        {evt.reason && (
                          <p className="font-medium text-slate-800 text-xs">
                            {evt.reason}
                          </p>
                        )}
                        {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                          <div className="font-mono text-[10px] text-slate-500 mt-0.5 space-x-2">
                            {evt.metadata.admin_name && (
                              <span>Admin: {evt.metadata.admin_name}</span>
                            )}
                            {evt.metadata.previous_status && (
                              <span>
                                {evt.metadata.previous_status} &rarr; {evt.metadata.new_status}
                              </span>
                            )}
                            {evt.metadata.policy && <span>Policy: {evt.metadata.policy}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RESET BINDING MODAL */}
      {resetModalBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base">Authorize Strict Device Reset</h3>
              </div>
              <button
                onClick={() => setResetModalBinding(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="text-xs text-slate-500 font-medium">Target Student Registration:</p>
                <p className="font-mono font-bold text-blue-900 text-sm">
                  {resetModalBinding.matric_no}
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  {resetModalBinding.student_name}
                </p>
                <p className="font-mono text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                  Current Lock: {resetModalBinding.device_id.slice(0, 24)}...
                </p>
              </div>

              {/* Rate Limit notice */}
              <div className="flex items-center justify-between text-xs px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-blue-900">
                <div className="flex items-center gap-1.5 font-medium">
                  <Activity className="w-4 h-4 text-blue-700" />
                  <span>Rate Limit Guard (Max 50/hour per admin):</span>
                </div>
                <span className="font-mono font-bold">
                  {rateLimitStatus.remaining} remaining this hour
                </span>
              </div>

              {resetError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}

              {/* Mandatory Reason Input */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Mandatory Justification Reason <span className="text-rose-600">*</span>
                </label>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Institutional compliance requires documenting why this device binding is being cleared. Stored immutably under Reference Code <span className="font-mono font-bold text-slate-800">BIND-205</span>.
                </p>

                {/* Quick reason chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COMMON_REASONS.map(cr => (
                    <button
                      key={cr}
                      type="button"
                      onClick={() => setResetReason(cr)}
                      className="text-[10px] px-2.5 py-1 rounded-md bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-800 border border-slate-200 transition text-left"
                    >
                      {cr}
                    </button>
                  ))}
                </div>

                <textarea
                  required
                  rows={3}
                  value={resetReason}
                  onChange={e => {
                    setResetReason(e.target.value);
                    if (resetError) setResetError('');
                  }}
                  placeholder="Specify official justification (e.g. Student replaced stolen phone; verified with ICT ticket #492)..."
                  className="w-full p-3 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                <span className="font-bold">Protocol Notice: </span>
                This action does not erase historical verification events. The binding status will change to <code className="font-mono font-bold">reset</code>, permitting the student to register their replacement mobile device on their subsequent check-in attempt.
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setResetModalBinding(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReset}
                  disabled={isSubmittingReset || !rateLimitStatus.allowed}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 rounded-xl shadow-xs transition inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Confirm Device Reset (BIND-205)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHARED DEVICE TOGGLE MODAL */}
      {sharedModalBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-base">
                  {sharedModalBinding.is_shared
                    ? 'Revoke Shared Device Exception'
                    : 'Grant Shared Device Exception'}
                </h3>
              </div>
              <button
                onClick={() => setSharedModalBinding(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="font-mono font-bold text-blue-900 text-sm">
                  {sharedModalBinding.matric_no}
                </p>
                <p className="text-xs font-semibold text-slate-800 mt-0.5">
                  {sharedModalBinding.student_name}
                </p>
              </div>

              {sharedError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                  {sharedError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Documentation Justification <span className="text-rose-600">*</span>
                </label>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Strict Option 2 prohibits shared devices unless formally documented for siblings or verified institutional exceptions. Logged under <span className="font-mono font-bold text-slate-800">BIND-207</span>.
                </p>
                <textarea
                  required
                  rows={3}
                  value={sharedReason}
                  onChange={e => setSharedReason(e.target.value)}
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSharedModalBinding(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSharedToggle}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition"
                >
                  Save Shared Device Exception
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REVOKE DEVICE BINDING MODAL */}
      {revokeModalBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-rose-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ban className="w-5 h-5 text-rose-400" />
                <h3 className="font-bold text-base">Revoke &amp; Blacklist Device</h3>
              </div>
              <button
                onClick={() => setRevokeModalBinding(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-600">
                Are you sure you want to blacklist and revoke this device binding for{' '}
                <strong>{revokeModalBinding.student_name}</strong> ({revokeModalBinding.matric_no})?
              </p>

              {revokeError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                  {revokeError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Revocation Reason <span className="text-rose-600">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                  placeholder="e.g. Device flagged for fraudulent geo-spoofing attempt or unauthorized multi-matric access..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-rose-600 focus:border-transparent transition"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRevokeModalBinding(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRevoke}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition"
                >
                  Revoke Device (BIND-209)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
