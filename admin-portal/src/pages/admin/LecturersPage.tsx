import React, { useState, useEffect } from 'react';
import { AdminService } from '../../services/adminService';
import { User, Course } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  Users,
  UserPlus,
  Search,
  KeyRound,
  Trash2,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  X,
  Mail,
  Building2,
  IdCard,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

export const LecturersPage: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [lecturers, setLecturers] = useState<User[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'soft_deleted'>('all');
  const [loading, setLoading] = useState(false);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedLecturer, setSelectedLecturer] = useState<User | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    department: 'Computer Science',
    staff_id: '',
    username: '',
    password: '',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [resetSuccessMsg, setResetSuccessMsg] = useState('');
  const [resetErrorMsg, setResetErrorMsg] = useState('');

  // Soft-delete modal state (QA-18)
  const [deleteActionCourses, setDeleteActionCourses] = useState<'archive' | 'reassign'>('archive');
  const [targetLecturerId, setTargetLecturerId] = useState<string>('');
  const [deleteErrorMsg, setDeleteErrorMsg] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [allLecturers, allCourses] = await Promise.all([
        AdminService.getLecturers(),
        AdminService.getAllCourses(),
      ]);
      setLecturers(allLecturers);
      setCourses(allCourses);
    } catch (err) {
      console.error('Error loading lecturer management data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim() || !formData.email.trim() || !formData.username.trim() || !formData.password) {
      setFormError('Please fill in all required fields.');
      return;
    }

    if (!currentAdmin) return;
    setIsSubmitting(true);

    const res = await AdminService.createLecturer(
      {
        name: formData.name.trim(),
        email: formData.email.trim(),
        department: formData.department,
        staff_id: formData.staff_id.trim() || `ADUN/LEC/${Date.now().toString().slice(-4)}`,
        username: formData.username.trim().toLowerCase(),
        password: formData.password,
      },
      { id: currentAdmin.id, name: currentAdmin.name }
    );

    setIsSubmitting(false);

    if (!res.success) {
      setFormError(res.error || 'Failed to create lecturer.');
      return;
    }

    setCreateModalOpen(false);
    setFormData({
      name: '',
      email: '',
      department: 'Computer Science',
      staff_id: '',
      username: '',
      password: '',
    });
    await loadData();
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetErrorMsg('');
    if (!selectedLecturer || !currentAdmin) return;

    if (!resetPasswordVal || resetPasswordVal.length < 6) {
      setResetErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    const res = await AdminService.resetLecturerPassword(
      selectedLecturer.id,
      { id: currentAdmin.id, name: currentAdmin.name }
    );
    setIsSubmitting(false);

    if (res.success) {
      setResetSuccessMsg(`Password reset flag set for ${selectedLecturer.name}. They will be prompted to set a new password on their next login.`);
      setTimeout(() => {
        setResetModalOpen(false);
        setResetSuccessMsg('');
        setResetPasswordVal('');
        setSelectedLecturer(null);
        loadData();
      }, 2000);
    } else {
      setResetErrorMsg(res.error || 'Failed to reset password flag.');
    }
  };

  const handleOpenDeleteModal = (lecturer: User) => {
    setSelectedLecturer(lecturer);
    setDeleteErrorMsg('');
    setDeleteActionCourses('archive');
    const availableTargets = lecturers.filter(
      l => l.id !== lecturer.id && l.status === 'active'
    );
    setTargetLecturerId(availableTargets.length > 0 ? availableTargets[0].id : '');
    setDeleteModalOpen(true);
  };

  const handleSoftDelete = async () => {
    if (!selectedLecturer || !currentAdmin) return;
    setDeleteErrorMsg('');

    const lecturerActiveCourses = courses.filter(
      c => c.lecturer_id === selectedLecturer.id && c.status === 'active'
    );

    if (lecturerActiveCourses.length > 0 && deleteActionCourses === 'reassign' && !targetLecturerId) {
      setDeleteErrorMsg('Please select a target faculty member to receive reassigned courses.');
      return;
    }

    setIsSubmitting(true);
    const res = await AdminService.softDeleteLecturer(
      selectedLecturer.id,
      lecturerActiveCourses.length > 0 ? deleteActionCourses : 'archive',
      deleteActionCourses === 'reassign' ? targetLecturerId : undefined,
      { id: currentAdmin.id, name: currentAdmin.name }
    );
    setIsSubmitting(false);

    if (res.success) {
      setDeleteModalOpen(false);
      setSelectedLecturer(null);
      await loadData();
    } else {
      setDeleteErrorMsg(res.error || 'Failed to soft delete lecturer.');
    }
  };

  const handleRestore = async (lecturer: User) => {
    if (!currentAdmin) return;
    const res = await AdminService.restoreLecturer(lecturer.id, { id: currentAdmin.id, name: currentAdmin.name });
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || 'Failed to reactivate lecturer.');
    }
  };

  const filteredLecturers = lecturers.filter(l => {
    const matchesSearch =
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.email.toLowerCase().includes(search.toLowerCase()) ||
      l.username.toLowerCase().includes(search.toLowerCase()) ||
      (l.department && l.department.toLowerCase().includes(search.toLowerCase())) ||
      (l.staff_id && l.staff_id.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus =
      filterStatus === 'all' ? true : l.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  const activeLecturerCourses = selectedLecturer
    ? courses.filter(c => c.lecturer_id === selectedLecturer.id && c.status === 'active')
    : [];

  const eligibleReassignTargets = lecturers.filter(
    l => selectedLecturer && l.id !== selectedLecturer.id && l.status === 'active'
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Lecturer Management</h1>
          <p className="text-sm text-slate-500">
            Provision faculty accounts, manage active teaching assignments, and control security credentials.
          </p>
        </div>

        <button
          onClick={() => {
            setFormError('');
            setCreateModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-sm rounded-xl transition shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>New Faculty Account</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, email, department or staff ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto self-end">
          <span className="text-xs text-slate-500 font-medium">Status:</span>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Accounts</option>
            <option value="active">Active Only</option>
            <option value="soft_deleted">Deactivated (Soft-deleted)</option>
          </select>
        </div>
      </div>

      {/* Table / List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center text-sm text-slate-500">
          Loading faculty accounts from database...
        </div>
      ) : filteredLecturers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? 'No lecturers match your search' : 'No lecturer accounts created yet'}
          description={
            search
              ? 'Try modifying your search terms or status filter.'
              : 'Lecturer accounts can only be created by an administrator. Add the first faculty member to begin assigning courses and tracking attendance.'
          }
          actionText={search ? undefined : 'Create Lecturer Account'}
          onAction={search ? undefined : () => setCreateModalOpen(true)}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Lecturer / Staff</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Active Courses</th>
                  <th className="py-3 px-4">Security Policy</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredLecturers.map(lecturer => {
                  const activeCourses = courses.filter(
                    c => c.lecturer_id === lecturer.id && c.status === 'active'
                  );
                  const isDeleted = lecturer.status === 'soft_deleted';

                  return (
                    <tr
                      key={lecturer.id}
                      className={`hover:bg-slate-50/80 transition ${
                        isDeleted ? 'bg-slate-50/50 opacity-75' : ''
                      }`}
                    >
                      {/* Name & Email */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                              isDeleted
                                ? 'bg-slate-200 text-slate-500'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {(lecturer.name || lecturer.username || 'L').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 leading-tight">
                              {lecturer.name || lecturer.username || 'Lecturer'}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                              <span>{lecturer.email}</span>
                              {lecturer.staff_id && (
                                <>
                                  <span>&bull;</span>
                                  <span className="font-mono text-[11px]">{lecturer.staff_id}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Department */}
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-700">
                        {lecturer.department || 'N/A'}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isDeleted
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {isDeleted ? 'Deactivated' : 'Active'}
                        </span>
                      </td>

                      {/* Active Courses */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-800">
                            {activeCourses.length} / 9
                          </span>
                        </div>
                      </td>

                      {/* Security Policy */}
                      <td className="py-3.5 px-4">
                        {lecturer.must_change_password ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            <KeyRound className="w-3 h-3" />
                            Must Change PW
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500">Normal</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isDeleted ? (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedLecturer(lecturer);
                                  setResetPasswordVal('Lecturer@' + Math.floor(1000 + Math.random() * 9000));
                                  setResetModalOpen(true);
                                }}
                                title="Reset Lecturer Password"
                                className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleOpenDeleteModal(lecturer)}
                                title="Deactivate (Soft-delete) Lecturer"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleRestore(lecturer)}
                              title="Reactivate Account"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reactivate</span>
                            </button>
                          )}
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

      {/* CREATE LECTURER MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base">Provision Faculty Account</h3>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name &amp; Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Dr. Olatunji Adebayo"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Official Email *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="lecturer@adun.edu.ng"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Staff ID
                  </label>
                  <input
                    type="text"
                    placeholder="ADUN/STAFF/042"
                    value={formData.staff_id}
                    onChange={e => setFormData({ ...formData, staff_id: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Academic Department
                  </label>
                  <select
                    value={formData.department}
                    onChange={e => setFormData({ ...formData, department: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="Computer Science">Computer Science</option>
                    <option value="Cyber Security">Cyber Security</option>
                    <option value="Software Engineering">Software Engineering</option>
                    <option value="Information Technology">Information Technology</option>
                    <option value="Maritime Studies">Maritime Studies</option>
                    <option value="Business Administration">Business Administration</option>
                    <option value="Accounting">Accounting</option>
                    <option value="International Relations">International Relations</option>
                    <option value="General Studies">General Studies</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Portal Username *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. oadebayo"
                    value={formData.username}
                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Temporary Password *
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Min 6 chars"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl text-blue-900 text-xs">
                Account will be created with <span className="font-semibold">must_change_password: true</span>. The lecturer will be prompted to choose a new password upon first sign-in.
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {resetModalOpen && selectedLecturer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base">Reset Password Flag</h3>
              </div>
              <button onClick={() => setResetModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <p className="text-xs text-slate-600">
                Force password reset for <span className="font-semibold text-slate-900">{selectedLecturer.name}</span> ({selectedLecturer.username}).
              </p>

              {resetErrorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
                  {resetErrorMsg}
                </div>
              )}

              {resetSuccessMsg ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{resetSuccessMsg}</span>
                </div>
              ) : (
                <>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                    This will set <code className="font-mono bg-white px-1">must_change_password = true</code>. The lecturer will be required to configure a new password upon their next login.
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setResetModalOpen(false)}
                      className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-5 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmitting ? 'Updating...' : 'Set Reset Flag'}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}

      {/* SOFT DELETE CONFIRMATION & COURSE REASSIGNMENT MODAL (QA-18) */}
      {deleteModalOpen && selectedLecturer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-red-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-400" />
                <h3 className="font-bold text-base">Deactivate Faculty Account</h3>
              </div>
              <button onClick={() => setDeleteModalOpen(false)} className="text-red-300 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700">
                Are you sure you want to soft-delete <span className="font-bold text-slate-900">{selectedLecturer.name}</span>?
              </p>

              {deleteErrorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{deleteErrorMsg}</span>
                </div>
              )}

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5 text-slate-600">
                <p className="font-semibold text-slate-900">Per ADUN Institutional Policy:</p>
                <p>&bull; The account is marked <code className="font-mono bg-white px-1">status = soft_deleted</code>.</p>
                <p>&bull; All past attendance sessions, signatures, and biometric audits remain preserved.</p>
                <p>&bull; The lecturer will no longer be able to log in or create sessions.</p>
              </div>

              {/* QA-18 Active Courses Option */}
              {activeLecturerCourses.length > 0 ? (
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-amber-900 font-semibold text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>This lecturer owns {activeLecturerCourses.length} active course(s). Choose course disposition:</span>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="radio"
                        name="course_action"
                        value="archive"
                        checked={deleteActionCourses === 'archive'}
                        onChange={() => setDeleteActionCourses('archive')}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="font-semibold text-slate-900">Archive all courses</span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Marks courses as archived and automatically closes any active or scheduled lecture sessions.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                      <input
                        type="radio"
                        name="course_action"
                        value="reassign"
                        checked={deleteActionCourses === 'reassign'}
                        onChange={() => setDeleteActionCourses('reassign')}
                        className="mt-0.5"
                      />
                      <div className="w-full">
                        <span className="font-semibold text-slate-900">Reassign to another faculty member</span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Transfers all active courses and their roster/sessions to another lecturer (subject to the 9-course quota).
                        </p>

                        {deleteActionCourses === 'reassign' && (
                          <div className="mt-2.5">
                            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                              Target Faculty Member:
                            </label>
                            <select
                              value={targetLecturerId}
                              onChange={e => setTargetLecturerId(e.target.value)}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                            >
                              {eligibleReassignTargets.length === 0 ? (
                                <option value="">No other active lecturers available</option>
                              ) : (
                                eligibleReassignTargets.map(target => {
                                  const targetActiveCount = courses.filter(
                                    c => c.lecturer_id === target.id && c.status === 'active'
                                  ).length;
                                  return (
                                    <option key={target.id} value={target.id}>
                                      {target.name} ({target.department}) — {targetActiveCount}/9 active
                                    </option>
                                  );
                                })
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  This lecturer currently holds no active courses.
                </p>
              )}

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSoftDelete}
                  disabled={isSubmitting || (activeLecturerCourses.length > 0 && deleteActionCourses === 'reassign' && !targetLecturerId)}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Processing...' : 'Confirm Deactivation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
