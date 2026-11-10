import React, { useState, useEffect, useMemo } from 'react';
import { AdminService } from '../../services/adminService';
import { DeviceBinding, DeviceEvent, StudentMaster } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  formatReferenceCode,
  matchReferenceCode,
  REFERENCE_CODE_MAP,
  ReferenceCode,
} from '../../lib/referenceCodes';
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
  incognito: {
    label: 'Incognito Flagged',
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
    defaultCode: 'BIND-203',
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'reset' | 'revoked'>('all');
  const [sharedFilter, setSharedFilter] = useState<'all' | 'shared_only' | 'dedicated_only'>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);

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
  const [rateLimitWaitNotice, setRateLimitWaitNotice] = useState<string | null>(null);

  const [sharedModalBinding, setSharedModalBinding] = useState<DeviceBinding | null>(null);
  const [sharedReason, setSharedReason] = useState('');
  const [sharedError, setSharedError] = useState('');
  const [isSubmittingShared, setIsSubmittingShared] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await AdminService.getDeviceBindings();
      setBindings(data);
    } catch (err) {
      console.error('Failed to load device bindings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadForensicEvents = async (studentId: string) => {
    try {
      const events = await AdminService.getStudentDeviceEvents(studentId, 20);
      setForensicEvents(events);
    } catch (err) {
      console.error('Failed to load student device events:', err);
      setForensicEvents([]);
    }
  };

  useEffect(() => {
    if (selectedStudent?.student_id) {
      loadForensicEvents(selectedStudent.student_id);
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
    setRateLimitWaitNotice(null);
  };

  const handleConfirmReset = async () => {
    if (!resetModalBinding || !currentAdmin) return;

    if (!resetReason.trim()) {
      setResetError('A mandatory justification reason is required before resetting a device binding.');
      return;
    }

    if (resetReason.trim().length < 10) {
      setResetError('Justification reason must be at least 10 characters long.');
      return;
    }

    setIsSubmittingReset(true);
    setResetError('');
    setRateLimitWaitNotice(null);

    const result = await AdminService.resetDeviceBinding(
      resetModalBinding.student_id,
      resetReason.trim()
    );
    setIsSubmittingReset(false);

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: `Device lock successfully reset for ${resetModalBinding.student_name} (${resetModalBinding.matric_no}). Reference Code: BIND-205 recorded in forensic log.`,
      });
      setResetModalBinding(null);
      await loadData();
      if (selectedStudent?.student_id === resetModalBinding.student_id) {
        await loadForensicEvents(resetModalBinding.student_id);
      }
    } else {
      if (result.status === 429) {
        setRateLimitWaitNotice('Rate limit exceeded: Please wait 60 seconds before submitting another device reset.');
      }
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

  const handleConfirmSharedToggle = async () => {
    if (!sharedModalBinding || !currentAdmin) return;

    if (!sharedReason.trim()) {
      setSharedError('A documentation reason is required when modifying shared device policy.');
      return;
    }

    setIsSubmittingShared(true);
    const newSharedState = !sharedModalBinding.is_shared;
    const result = await AdminService.toggleSharedDevice(
      sharedModalBinding.id,
      newSharedState,
      sharedReason.trim(),
      { id: currentAdmin.id, name: currentAdmin.name }
    );
    setIsSubmittingShared(false);

    if (result.success) {
      setFeedbackMsg({
        type: 'success',
        text: newSharedState
          ? `Shared device exception granted for ${sharedModalBinding.student_name}.`
          : `Shared device exception revoked for ${sharedModalBinding.student_name}. Restored to strict single-device lock.`,
      });
      setSharedModalBinding(null);
      await loadData();
      if (selectedStudent?.student_id === sharedModalBinding.student_id) {
        await loadForensicEvents(sharedModalBinding.student_id);
      }
    } else {
      setSharedError(result.error || 'Failed to update shared device status.');
    }
  };

  // Filter bindings
  const filteredBindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bindings.filter(b => {
      const matchesSearch =
        !q ||
        b.matric_no.toLowerCase().includes(q) ||
        b.student_name.toLowerCase().includes(q) ||
        b.device_id.toLowerCase().includes(q) ||
        (b.device_fingerprint_hash && b.device_fingerprint_hash.toLowerCase().includes(q)) ||
        (b.user_agent && b.user_agent.toLowerCase().includes(q));

      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;

      const matchesShared =
        sharedFilter === 'all' ||
        (sharedFilter === 'shared_only' && b.is_shared) ||
        (sharedFilter === 'dedicated_only' && !b.is_shared);

      return matchesSearch && matchesStatus && matchesShared;
    });
  }, [bindings, search, statusFilter, sharedFilter]);

  // Filter forensic events
  const filteredForensicEvents = useMemo(() => {
    if (eventTypeFilter === 'all') return forensicEvents;
    return forensicEvents.filter(e => e.event_type.toLowerCase() === eventTypeFilter.toLowerCase());
  }, [forensicEvents, eventTypeFilter]);

  // Metrics overview
  const totalBindings = bindings.length;
  const activeCount = bindings.filter(b => b.status === 'active').length;
  const resetCount = bindings.filter(b => b.status === 'reset').length;
  const revokedCount = bindings.filter(b => b.status === 'revoked').length;
  const sharedExceptionsCount = bindings.filter(b => b.is_shared).length;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-12 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-100 text-blue-800 text-[10px] sm:text-[11px] font-bold tracking-wide uppercase mb-1">
            <Lock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
            <span>Option 2: Strict Device Binding Protocol</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Device Binding Administration
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Cryptographic hardware fingerprint locking, forensic telemetry, and administrative reset governance.
          </p>
        </div>
      </div>

      {/* Explanatory Protocol Alert Banner */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-sm flex items-start gap-3 border border-blue-800">
        <ShieldCheck className="w-5 h-5 text-blue-300 shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-xs">
          <p className="font-bold text-white text-xs sm:text-sm">
            Institutional Hardware Governance Policy (Option 2 Enforced)
          </p>
          <p className="text-blue-100/90 leading-relaxed text-xs sm:text-sm break-words">
            Upon check-in, each student’s matriculation number is tied cryptographically to a unique SHA-256 device fingerprint token. Multiple students checking in from the identical device will be automatically rejected with code <span className="font-mono text-amber-300 font-semibold">BIND-202</span> (Device Mismatch) to prevent buddy signing.
          </p>
          <p className="text-blue-200/80 text-[11px] sm:text-xs break-words">
            Family/sibling exceptions can be granted via the <span className="font-bold text-white">Shared Device Flag</span> toggle. Administrative resets are logged with non-repudiable audit trails and invoke verified Edge Functions.
          </p>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border text-xs sm:text-sm flex items-start justify-between gap-2 shadow-2xs ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            )}
            <span className="font-medium text-xs sm:text-sm break-words">{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-700 p-1.5 -mr-1 -mt-1 cursor-pointer rounded-lg hover:bg-slate-200/50 transition shrink-0"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 5 KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider block truncate">
            Total Bound Devices
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">{totalBindings}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Cataloged in registry</p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block truncate">
            Active Locks
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1">{activeCount}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Strict enforcement live</p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] sm:text-[11px] font-semibold text-amber-600 uppercase tracking-wider block truncate">
            Reset / Unbound
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-amber-700 mt-1">{resetCount}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Pending new device</p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <span className="text-[10px] sm:text-[11px] font-semibold text-rose-600 uppercase tracking-wider block truncate">
            Revoked Locks
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-rose-700 mt-1">{revokedCount}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Blacklisted devices</p>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs col-span-2 sm:col-span-1">
          <span className="text-[10px] sm:text-[11px] font-semibold text-indigo-600 uppercase tracking-wider block truncate">
            Shared Exceptions
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-indigo-700 mt-1">{sharedExceptionsCount}</p>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">Documented sibling/family</p>
        </div>
      </div>

      {/* Filter and Search Control Bar */}
      <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search matric, name, fingerprint SHA-256, or UA..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1">
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="w-full bg-transparent py-1.5 text-base sm:text-xs font-semibold text-slate-700 focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Statuses ({totalBindings})</option>
              <option value="active">Active Only ({activeCount})</option>
              <option value="reset">Reset Only ({resetCount})</option>
              <option value="revoked">Revoked Only ({revokedCount})</option>
            </select>
          </div>

          {/* Shared Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1">
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Type:</span>
            <select
              value={sharedFilter}
              onChange={e => setSharedFilter(e.target.value as any)}
              className="w-full bg-transparent py-1.5 text-base sm:text-xs font-semibold text-slate-700 focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="shared_only">Shared Exceptions ({sharedExceptionsCount})</option>
              <option value="dedicated_only">Dedicated Single-Device</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content: Mobile Cards (< md) & Desktop Table (>= md) */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center text-sm text-slate-500">
          Loading device bindings from Supabase...
        </div>
      ) : filteredBindings.length === 0 ? (
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
        <>
          {/* MOBILE RESPONSIVE CARD VIEW (< 768px) */}
          <div className="block md:hidden space-y-3">
            {filteredBindings.map(binding => {
              const isActive = binding.status === 'active';
              const isReset = binding.status === 'reset';
              const isRevoked = binding.status === 'revoked';
              const isSelected = selectedStudent?.student_id === binding.student_id;
              const uaInfo = parseUserAgent(binding.user_agent);

              const rawHash = binding.device_fingerprint_hash || binding.device_id || '';
              const shortHash =
                rawHash.length > 20
                  ? `${rawHash.slice(0, 10)}...${rawHash.slice(-8)}`
                  : rawHash || 'SHA-256_UNKNOWN';

              return (
                <div
                  key={binding.id}
                  className={`bg-white rounded-2xl border p-4 shadow-2xs transition space-y-3 ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20'
                      : 'border-slate-200/80'
                  }`}
                >
                  {/* Card Header: Student & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-sm text-blue-900">
                          {binding.matric_no}
                        </span>
                        {binding.is_shared && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                            <Users className="w-2.5 h-2.5 shrink-0" />
                            Shared
                          </span>
                        )}
                      </div>
                      <h4 className="font-semibold text-slate-900 text-xs sm:text-sm mt-0.5 truncate">
                        {binding.student_name}
                      </h4>
                    </div>

                    <div className="shrink-0">
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          Active Lock
                        </span>
                      )}
                      {isReset && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <Unlock className="w-3 h-3" />
                          Reset
                        </span>
                      )}
                      {isRevoked && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                          <Ban className="w-3 h-3" />
                          Revoked
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Details Box */}
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 space-y-2 text-xs">
                    {/* Fingerprint Hash */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 text-[11px] font-medium shrink-0">Fingerprint:</span>
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 truncate"
                          title={rawHash}
                        >
                          {shortHash}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyHash(rawHash)}
                          title="Copy full cryptographic fingerprint hash"
                          className="p-1 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 rounded transition cursor-pointer shrink-0"
                        >
                          {copiedHash === rawHash ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Browser / Device */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 text-[11px] font-medium shrink-0">Device:</span>
                      <span className="text-[11px] font-semibold text-slate-800 flex items-center gap-1 truncate">
                        <Smartphone className="w-3 h-3 text-slate-400 shrink-0" />
                        {uaInfo.browser} on {uaInfo.os}
                      </span>
                    </div>

                    {/* Timestamps */}
                    <div className="pt-1.5 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="text-slate-400 block">First Bound:</span>
                        <span className="font-mono text-slate-700 font-medium block truncate">
                          {formatWAT(binding.first_bound_at)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Last Seen:</span>
                        <span className="font-mono text-slate-700 font-medium block truncate">
                          {formatWAT(binding.last_seen_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    {/* Reset button */}
                    <button
                      onClick={() => handleOpenResetModal(binding)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded-xl border border-amber-200 transition cursor-pointer shadow-2xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Binding</span>
                    </button>

                    {/* Shared Toggle button */}
                    <button
                      onClick={() => handleOpenSharedModal(binding)}
                      className={`px-3 py-2 text-xs font-semibold rounded-xl border transition cursor-pointer inline-flex items-center gap-1 shadow-2xs ${
                        binding.is_shared
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                      title="Shared device exception"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>{binding.is_shared ? 'Shared' : 'Dedicated'}</span>
                    </button>

                    {/* Forensics button */}
                    <button
                      onClick={() => {
                        setSelectedStudent({
                          student_id: binding.student_id,
                          matric_no: binding.matric_no,
                          student_name: binding.student_name,
                        });
                        const el = document.getElementById('forensic-ledger');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                      title="Inspect forensic telemetry log"
                      className={`p-2 rounded-xl transition border cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'text-slate-500 hover:text-blue-700 hover:bg-blue-50 border-slate-200'
                      }`}
                    >
                      <Activity className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DESKTOP TABLE VIEW (>= 768px) */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
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
                    const isSelected = selectedStudent?.student_id === binding.student_id;
                    const uaInfo = parseUserAgent(binding.user_agent);

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
                            className="text-left group cursor-pointer"
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
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded transition cursor-pointer"
                            >
                              {copiedHash === rawHash ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
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
                        </td>

                        {/* Shared Device Flag */}
                        <td className="py-3.5 px-4">
                          <button
                            onClick={() => handleOpenSharedModal(binding)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                              binding.is_shared
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Click to toggle shared family/sibling device exception"
                          >
                            <Users className="w-3 h-3 shrink-0" />
                            <span>{binding.is_shared ? 'Shared Exception' : 'Dedicated'}</span>
                          </button>
                        </td>

                        {/* Administrative Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Reset button */}
                            <button
                              onClick={() => handleOpenResetModal(binding)}
                              title="Reset student device lock (requires min 10 chars reason)"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 rounded-lg transition border border-amber-200 shadow-2xs cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reset</span>
                            </button>

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
                              className={`p-1.5 rounded-lg transition border cursor-pointer ${
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
        </>
      )}

      {/* FORENSIC EVENT LOG (Display last 20 device_events for selected student) */}
      <div id="forensic-ledger" className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-4 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-700 shrink-0" />
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Forensic Device Telemetry Ledger
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time forensic telemetry displaying the last 20 verification &amp; binding events for audit inspection.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            {/* Event type filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
              <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Filter:</span>
              <select
                value={eventTypeFilter}
                onChange={e => setEventTypeFilter(e.target.value)}
                className="w-full bg-transparent py-1 text-base sm:text-xs font-semibold text-slate-700 focus:outline-hidden cursor-pointer"
              >
                <option value="all">All Event Types</option>
                <option value="bind">bind</option>
                <option value="match">match</option>
                <option value="mismatch">mismatch</option>
                <option value="cookie_missing">cookie_missing</option>
                <option value="cookie_mismatch">cookie_mismatch</option>
                <option value="admin_reset">admin_reset</option>
                <option value="proxy_detected">proxy_detected</option>
              </select>
            </div>

            {selectedStudent ? (
              <div className="flex items-center justify-between sm:justify-start gap-2 bg-blue-50 text-blue-800 border border-blue-200 px-3 py-1.5 rounded-xl font-medium text-xs">
                <span className="truncate">
                  Inspecting: <strong className="font-mono">{selectedStudent.matric_no}</strong> ({selectedStudent.student_name})
                </span>
                <button
                  onClick={() => setSelectedStudent(null)}
                  className="text-slate-500 hover:text-slate-800 p-1 hover:bg-blue-100 rounded-lg transition cursor-pointer shrink-0"
                  title="Clear selected student"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-400 italic">
                Select a student to inspect dedicated trace
              </span>
            )}
          </div>
        </div>

        {filteredForensicEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
            <History className="w-8 h-8 text-slate-300" />
            <p className="max-w-md">
              {selectedStudent
                ? `No forensic security events recorded yet for ${selectedStudent.matric_no}. Events populate as the student checks in or resets locks.`
                : 'No student currently selected for forensic telemetry. Tap on any student above to view their logs.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Forensic Cards (< md) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredForensicEvents.map(evt => {
                const cfg = EVENT_TYPE_CONFIG[evt.event_type] || {
                  label: evt.event_type,
                  badge: 'bg-slate-100 text-slate-700 border-slate-200',
                  defaultCode: evt.reference_code || 'BIND-200',
                };
                const code = evt.reference_code || cfg.defaultCode;
                const formattedCode = formatReferenceCode(code);

                return (
                  <div key={evt.id} className="py-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${cfg.badge}`}
                      >
                        {cfg.label}
                      </span>
                      <span className="font-mono text-slate-500 text-[10px]">
                        {formatWAT(evt.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-slate-900">
                        {formattedCode}
                      </span>
                      <span className="font-mono text-slate-600 text-[10px]">
                        IP: {evt.ip_address || '127.0.0.1'}
                      </span>
                    </div>

                    {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2.5 border border-slate-100 space-y-0.5">
                        {evt.metadata.reason && (
                          <p className="font-medium text-slate-800 break-words">
                            {evt.metadata.reason}
                          </p>
                        )}
                        {evt.metadata.admin_name && (
                          <p className="text-[10px] text-slate-500 font-mono">
                            Admin: {evt.metadata.admin_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Forensic Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5 px-3">Timestamp (WAT)</th>
                    <th className="py-2.5 px-3">Event Type</th>
                    <th className="py-2.5 px-3">Reference Code &amp; Diagnostics</th>
                    <th className="py-2.5 px-3">IP Address</th>
                    <th className="py-2.5 px-3">Forensic Metadata &amp; Justification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredForensicEvents.map(evt => {
                    const cfg = EVENT_TYPE_CONFIG[evt.event_type] || {
                      label: evt.event_type,
                      badge: 'bg-slate-100 text-slate-700 border-slate-200',
                      defaultCode: evt.reference_code || 'BIND-200',
                    };
                    const code = evt.reference_code || cfg.defaultCode;
                    const formattedCode = formatReferenceCode(code);

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

                        {/* Reference Code: prefix + full code */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-mono text-[11px] font-bold text-slate-900">
                              {formattedCode}
                            </span>
                          </div>
                        </td>

                        {/* IP Address */}
                        <td className="py-3 px-3 font-mono text-slate-700 text-[11px] whitespace-nowrap">
                          {evt.ip_address || '127.0.0.1'}
                        </td>

                        {/* Metadata / Reason */}
                        <td className="py-3 px-3 text-slate-600">
                          {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                            <div className="font-mono text-[10px] text-slate-500 space-x-2">
                              {evt.metadata.reason && (
                                <span className="font-sans font-medium text-slate-800">
                                  {evt.metadata.reason}
                                </span>
                              )}
                              {evt.metadata.admin_name && (
                                <span>Admin: {evt.metadata.admin_name}</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* RESET BINDING MODAL */}
      {resetModalBinding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90dvh] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Modal Header */}
            <div className="px-5 sm:px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <RotateCcw className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="font-bold text-base truncate">Authorize Strict Device Reset</h3>
              </div>
              <button
                onClick={() => setResetModalBinding(null)}
                className="text-slate-400 hover:text-white p-2 -mr-2 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto p-4 sm:p-6 space-y-4 overscroll-contain">
              {/* Target Student Details */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="text-[11px] text-slate-500 font-medium">Target Student Registration:</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono font-bold text-blue-900 text-sm sm:text-base">
                    {resetModalBinding.matric_no}
                  </p>
                  <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 bg-slate-200/60 px-2 py-0.5 rounded uppercase">
                    {resetModalBinding.status}
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-semibold text-slate-900">
                  {resetModalBinding.student_name}
                </p>
                <p className="font-mono text-[10px] sm:text-[11px] text-slate-500 pt-1.5 border-t border-slate-200/80 break-all">
                  Current Lock: {resetModalBinding.device_id}
                </p>
              </div>

              {rateLimitWaitNotice && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2 break-words">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="break-words">{rateLimitWaitNotice}</span>
                </div>
              )}

              {resetError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2 break-words">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span className="break-words">{resetError}</span>
                </div>
              )}

              {/* Mandatory Reason Input (Min 10 chars per SEC-15 / spec) */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Mandatory Justification Reason (min. 10 chars) <span className="text-rose-600">*</span>
                </label>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Institutional compliance requires documenting why this device binding is being cleared. Stored immutably under Reference Code <span className="font-mono font-bold text-slate-800">BIND-205</span>.
                </p>

                {/* Quick reason pills with wrapping and active selection feedback */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-semibold text-slate-500 block">
                    Quick presets (tap to apply):
                  </span>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {COMMON_REASONS.map(cr => {
                      const isSelected = resetReason === cr;
                      return (
                        <button
                          key={cr}
                          type="button"
                          onClick={() => {
                            setResetReason(cr);
                            if (resetError) setResetError('');
                          }}
                          className={`text-xs px-3 py-1.5 rounded-full border transition text-left cursor-pointer leading-snug break-words ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600 font-medium shadow-2xs'
                              : 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-800 border-slate-200'
                          }`}
                        >
                          {cr}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Textarea with text-base on mobile to avoid iOS Safari zoom */}
                <textarea
                  required
                  rows={3}
                  value={resetReason}
                  onChange={e => {
                    setResetReason(e.target.value);
                    if (resetError) setResetError('');
                  }}
                  placeholder="Specify official justification (minimum 10 characters)..."
                  className="w-full p-3 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition leading-relaxed"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Minimum 10 characters</span>
                  <span className={resetReason.trim().length >= 10 ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                    {resetReason.trim().length}/10 chars
                  </span>
                </div>
              </div>

              {/* Protocol Notice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] sm:text-xs text-amber-900 leading-relaxed break-words">
                <span className="font-bold">Protocol Notice: </span>
                This action calls the authenticated <code className="font-mono font-bold break-all">/api/reset-device-binding</code> Edge Function with verified JWT. The binding status changes to <code className="font-mono font-bold">reset</code>, permitting a replacement device on next check-in.
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setResetModalBinding(null)}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition text-center cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReset}
                  disabled={isSubmittingReset || resetReason.trim().length < 10}
                  className="w-full sm:w-auto px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50 rounded-xl shadow-xs transition inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <span>{isSubmittingReset ? 'Resetting...' : 'Confirm Device Reset (BIND-205)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHARED MODAL */}
      {sharedModalBinding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90dvh] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Modal Header */}
            <div className="px-5 sm:px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Users className="w-5 h-5 text-indigo-400 shrink-0" />
                <h3 className="font-bold text-base truncate">Toggle Shared Device Exception</h3>
              </div>
              <button
                onClick={() => setSharedModalBinding(null)}
                className="text-slate-400 hover:text-white p-2 -mr-2 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto p-4 sm:p-6 space-y-4 overscroll-contain">
              {sharedError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs break-words">
                  {sharedError}
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                <span className="text-slate-500 font-medium block">Student:</span>
                <p className="font-mono font-bold text-slate-900">{sharedModalBinding.matric_no}</p>
                <p className="font-medium text-slate-800">{sharedModalBinding.student_name}</p>
                <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-slate-500">Current Setting:</span>
                  <span className="font-semibold text-slate-900">
                    {sharedModalBinding.is_shared ? 'Shared Exception Enabled' : 'Strict Single-Device Locked'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Documentation Reason <span className="text-rose-600">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={sharedReason}
                  onChange={e => setSharedReason(e.target.value)}
                  className="w-full p-3 text-base sm:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
                  placeholder="Enter policy rationale for shared device exception..."
                />
              </div>

              <div className="pt-2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setSharedModalBinding(null)}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition text-center cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSharedToggle}
                  disabled={isSubmittingShared}
                  className="w-full sm:w-auto px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-xs disabled:opacity-50 transition cursor-pointer"
                >
                  {isSubmittingShared ? 'Updating...' : 'Save Exception Policy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
