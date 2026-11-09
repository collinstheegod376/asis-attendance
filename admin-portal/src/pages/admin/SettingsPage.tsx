import React, { useState, useEffect } from 'react';
import { AdminService } from '../../services/adminService';
import { SystemSettings, LocationMode } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  Sliders,
  MapPin,
  Clock,
  Camera,
  BookOpen,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Save,
  Loader2,
} from 'lucide-react';

const defaultSettings: SystemSettings = {
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
};

export const SettingsPage: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;
    async function loadSettings() {
      try {
        const s = await AdminService.getSettings();
        if (isMounted) setSettings(s);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSaveSuccess(false);

    if (!currentAdmin) return;

    // Validation
    if (settings.default_session_duration_minutes > settings.max_session_duration_minutes) {
      setErrorMessage('Default session duration cannot exceed maximum session duration.');
      return;
    }

    if (settings.grace_minutes >= settings.default_session_duration_minutes) {
      setErrorMessage('Grace period must be less than default session duration.');
      return;
    }

    // GeoJSON validation if provided
    if (settings.campus_boundary_geojson && settings.campus_boundary_geojson.trim()) {
      try {
        JSON.parse(settings.campus_boundary_geojson);
      } catch {
        setErrorMessage('Invalid GeoJSON syntax for campus boundary coordinates.');
        return;
      }
    }

    setIsSaving(true);
    const res = await AdminService.updateSettings(settings, {
      id: currentAdmin.id,
      name: currentAdmin.name,
    });
    setIsSaving(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Failed to update system settings.');
      return;
    }

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleResetDefaults = () => {
    if (confirm('Reset all parameters back to ADUN institutional defaults?')) {
      const defaults: SystemSettings = {
        location_mode: 'evidence_only',
        campus_center_lat: 6.2235,
        campus_center_lng: 6.6180,
        campus_radius_m: 1500,
        location_accuracy_threshold_m: 50,
        default_session_duration_minutes: 60,
        max_session_duration_minutes: 180,
        selfie_retention_days: 180,
        grace_minutes: 10,
        max_active_courses_per_lecturer: 9,
        rate_limit_token_per_minute: 60,
        rate_limit_matric_per_minute: 30,
        campus_boundary_geojson: '',
        updated_at: new Date().toISOString(),
      };
      setSettings(defaults);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Institutional System Settings</h1>
          <p className="text-sm text-slate-500">
            Configure global verification policies, geofence coordinates, session bounds, and security thresholds.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetDefaults}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition self-start sm:self-auto"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-sm flex items-center gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">
            System settings successfully updated and logged to immutable audit ledger.
          </span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-900 text-sm flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-medium">{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 1: Geolocation & Geofence Policy */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 text-blue-900 pb-2 border-b border-slate-100">
            <MapPin className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold">1. Geolocation &amp; Geofencing Policy</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Location Verification Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 rounded-xl border cursor-pointer text-xs transition ${
                    settings.location_mode === 'evidence_only'
                      ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="location_mode"
                    value="evidence_only"
                    checked={settings.location_mode === 'evidence_only'}
                    onChange={() => setSettings({ ...settings, location_mode: 'evidence_only' })}
                    className="sr-only"
                  />
                  <p className="font-bold">Evidence Only (Recommended)</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Student GPS coordinates and accuracy radius are captured as tamper-evident evidence. Signing is permitted even if outside campus.
                  </p>
                </label>

                <label
                  className={`p-3.5 rounded-xl border cursor-pointer text-xs transition ${
                    settings.location_mode === 'enforce'
                      ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="location_mode"
                    value="enforce"
                    checked={settings.location_mode === 'enforce'}
                    onChange={() => setSettings({ ...settings, location_mode: 'enforce' })}
                    className="sr-only"
                  />
                  <p className="font-bold">Enforce Geofence (Strict)</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Student must be physically located within the ADUN campus radius and meet the GPS accuracy threshold to sign.
                  </p>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Campus Center Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={settings.campus_center_lat}
                  onChange={e => setSettings({ ...settings, campus_center_lat: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
                />
                <span className="text-[10px] text-slate-400">Default: 6.2235 (ADUN Ibusa)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Campus Center Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={settings.campus_center_lng}
                  onChange={e => setSettings({ ...settings, campus_center_lng: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
                />
                <span className="text-[10px] text-slate-400">Default: 6.6180 (ADUN Ibusa)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Geofence Radius (Metres)
                </label>
                <input
                  type="number"
                  min="100"
                  max="10000"
                  value={settings.campus_radius_m}
                  onChange={e => setSettings({ ...settings, campus_radius_m: parseInt(e.target.value, 10) || 1500 })}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
                />
                <span className="text-[10px] text-slate-400">Coverage zone radius</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GPS Accuracy Threshold (Metres)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="10"
                  max="200"
                  value={settings.location_accuracy_threshold_m}
                  onChange={e => setSettings({ ...settings, location_accuracy_threshold_m: parseInt(e.target.value, 10) || 50 })}
                  className="w-32 px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
                />
                <span className="text-xs text-slate-500">
                  Maximum allowable browser GPS accuracy circle (Default 50m). Readings with worse accuracy trigger a student retry.
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Optional Custom GeoJSON Polygon (Campus Perimeter)
              </label>
              <textarea
                rows={2}
                value={settings.campus_boundary_geojson || ''}
                onChange={e => setSettings({ ...settings, campus_boundary_geojson: e.target.value })}
                placeholder='{"type":"Polygon","coordinates":[[[6.61,6.22],[6.62,6.22],...]]}'
                className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        </div>

        {/* SECTION 2: Lecture Durations & Grace Windows */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 text-blue-900 pb-2 border-b border-slate-100">
            <Clock className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold">2. Lecture Duration &amp; Punctuality Windows</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Duration (Minutes)
              </label>
              <input
                type="number"
                min="15"
                max="300"
                value={settings.default_session_duration_minutes}
                onChange={e => setSettings({ ...settings, default_session_duration_minutes: parseInt(e.target.value, 10) || 60 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">Pre-filled when lecturer creates session</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Allowed Duration (Minutes)
              </label>
              <input
                type="number"
                min="30"
                max="480"
                value={settings.max_session_duration_minutes}
                onChange={e => setSettings({ ...settings, max_session_duration_minutes: parseInt(e.target.value, 10) || 180 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">Hard cap on lecturer session length</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Grace Period (Minutes)
              </label>
              <input
                type="number"
                min="0"
                max="60"
                value={settings.grace_minutes}
                onChange={e => setSettings({ ...settings, grace_minutes: parseInt(e.target.value, 10) || 10 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">Marked 'present'; after grace, marked 'late'</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: Quota & Storage Retention */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 text-blue-900 pb-2 border-b border-slate-100">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold">3. Course Quota &amp; Biometric Evidence Retention</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Active Courses per Lecturer
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={settings.max_active_courses_per_lecturer}
                onChange={e => setSettings({ ...settings, max_active_courses_per_lecturer: parseInt(e.target.value, 10) || 9 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">
                Institutional limit (default 9 active subjects). Archiving releases slot.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Selfie Evidence Retention (Days)
              </label>
              <input
                type="number"
                min="30"
                max="730"
                value={settings.selfie_retention_days}
                onChange={e => setSettings({ ...settings, selfie_retention_days: parseInt(e.target.value, 10) || 180 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">
                Selfie photos automatically purged from private storage after retention.
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 4: Anti-Abuse & Rate Limits */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 text-blue-900 pb-2 border-b border-slate-100">
            <Gauge className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold">4. Edge Security &amp; Anti-Abuse Rate Limits</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Token Validations per IP / Min
              </label>
              <input
                type="number"
                min="10"
                max="300"
                value={settings.rate_limit_token_per_minute}
                onChange={e => setSettings({ ...settings, rate_limit_token_per_minute: parseInt(e.target.value, 10) || 60 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">Protects lecture session token lookup</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Matriculation Lookups per IP / Min
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={settings.rate_limit_matric_per_minute}
                onChange={e => setSettings({ ...settings, rate_limit_matric_per_minute: parseInt(e.target.value, 10) || 30 })}
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 font-mono"
              />
              <span className="text-[10px] text-slate-400">Prevents matriculation number enumeration</span>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-sm rounded-xl transition shadow-xs"
          >
            <Save className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
};
