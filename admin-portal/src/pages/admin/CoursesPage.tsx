import React, { useState, useEffect } from 'react';
import { AdminService } from '../../services/adminService';
import { Course, User } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen,
  Search,
  UserCheck,
  Archive,
  ArchiveRestore,
  Plus,
  Users,
  Calendar,
  AlertCircle,
  X,
  CheckCircle2,
} from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';

export const CoursesPage: React.FC = () => {
  const { user: currentAdmin } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [lecturers, setLecturers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [filterLecturer, setFilterLecturer] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'archived'>('all');
  const [loading, setLoading] = useState(false);

  // Reassign Modal
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [targetLecturerId, setTargetLecturerId] = useState('');
  const [reassignError, setReassignError] = useState('');
  const [isSubmittingReassign, setIsSubmittingReassign] = useState(false);

  // Create Course Modal (Admin override)
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newLecturerId, setNewLecturerId] = useState('');
  const [newDept, setNewDept] = useState('Computer Science');
  const [createError, setCreateError] = useState('');
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allCourses, allLecturers] = await Promise.all([
        AdminService.getAllCourses(),
        AdminService.getLecturers(),
      ]);
      setCourses(allCourses);
      setLecturers(allLecturers.filter(u => u.status === 'active'));
    } catch (err) {
      console.error('Failed to load courses data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleArchive = async (course: Course) => {
    if (!currentAdmin) return;
    const res = await AdminService.toggleArchiveCourse(course.id, {
      id: currentAdmin.id,
      name: currentAdmin.name,
    });
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || 'Failed to update course status.');
    }
  };

  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReassignError('');
    if (!selectedCourse || !targetLecturerId || !currentAdmin) return;

    setIsSubmittingReassign(true);
    const res = await AdminService.reassignCourse(selectedCourse.id, targetLecturerId, {
      id: currentAdmin.id,
      name: currentAdmin.name,
    });
    setIsSubmittingReassign(false);

    if (!res.success) {
      setReassignError(res.error || 'Failed to reassign course.');
      return;
    }

    setReassignModalOpen(false);
    setSelectedCourse(null);
    setTargetLecturerId('');
    await loadData();
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!newCode.trim() || !newTitle.trim() || !newLecturerId || !currentAdmin) {
      setCreateError('Please fill in all fields.');
      return;
    }

    setIsSubmittingCreate(true);
    const res = await AdminService.createCourse(
      {
        code: newCode.trim().toUpperCase(),
        title: newTitle.trim(),
        lecturer_id: newLecturerId,
        department: newDept,
      },
      { id: currentAdmin.id, name: currentAdmin.name }
    );
    setIsSubmittingCreate(false);

    if (!res.success) {
      setCreateError(res.error || 'Failed to create course.');
      return;
    }

    setCreateModalOpen(false);
    setNewCode('');
    setNewTitle('');
    setNewLecturerId('');
    await loadData();
  };

  const filteredCourses = courses.filter(c => {
    const matchesSearch =
      c.code.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.lecturer_name && c.lecturer_name.toLowerCase().includes(search.toLowerCase()));

    const matchesLecturer = filterLecturer === 'all' || c.lecturer_id === filterLecturer;
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;

    return matchesSearch && matchesLecturer && matchesStatus;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Institutional Courses</h1>
          <p className="text-sm text-slate-500">
            Monitor course offerings, enforce the 9-course active quota per lecturer, and manage teaching assignments.
          </p>
        </div>

        <button
          onClick={() => {
            setCreateError('');
            setCreateModalOpen(true);
          }}
          disabled={lecturers.length === 0}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition shadow-xs w-full sm:w-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Provision Course</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by course code, title, or lecturer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600 focus:border-transparent transition"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Lecturer Filter */}
          <select
            value={filterLecturer}
            onChange={e => setFilterLecturer(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Faculty</option>
            {lecturers.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value as any)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="archived">Archived Only</option>
          </select>
        </div>
      </div>

      {/* Course List or Empty State */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center text-sm text-slate-500">
          Loading institutional courses...
        </div>
      ) : filteredCourses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={search ? 'No courses match your search criteria' : 'No courses registered in system'}
          description={
            search
              ? 'Try modifying your search query or reset filter options.'
              : 'Lecturers create their courses up to the maximum 9-course quota, or an administrator can provision courses directly.'
          }
          actionText={lecturers.length > 0 && !search ? 'Provision Course' : undefined}
          onAction={lecturers.length > 0 && !search ? () => setCreateModalOpen(true) : undefined}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Course Code &amp; Title</th>
                  <th className="py-3 px-4">Assigned Lecturer</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Enrolled Roster</th>
                  <th className="py-3 px-4">Sessions Held</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredCourses.map(course => {
                  const isArchived = course.status === 'archived';

                  return (
                    <tr
                      key={course.id}
                      className={`hover:bg-slate-50/80 transition ${
                        isArchived ? 'bg-slate-50/50 opacity-70' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              isArchived
                                ? 'bg-slate-200 text-slate-500'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {course.code.slice(0, 3)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{course.code}</p>
                            <p className="text-xs text-slate-500 font-medium">{course.title}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
                          <span className="text-xs font-semibold text-slate-800">
                            {course.lecturer_name}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isArchived
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {isArchived ? 'Archived' : 'Active'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold">{course.enrolled_count || 0}</span> students
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold">{course.sessions_count || 0}</span> sessions
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setSelectedCourse(course);
                              setTargetLecturerId(course.lecturer_id);
                              setReassignError('');
                              setReassignModalOpen(true);
                            }}
                            title="Reassign course to another lecturer"
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-blue-700 hover:bg-blue-50 rounded-lg border border-slate-200 transition cursor-pointer"
                          >
                            Reassign
                          </button>

                          <button
                            onClick={() => handleToggleArchive(course)}
                            title={isArchived ? 'Restore course to active' : 'Archive course'}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${
                              isArchived
                                ? 'text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                                : 'text-slate-500 border-slate-200 hover:text-amber-700 hover:bg-amber-50'
                            }`}
                          >
                            {isArchived ? (
                              <ArchiveRestore className="w-4 h-4" />
                            ) : (
                              <Archive className="w-4 h-4" />
                            )}
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

      {/* REASSIGN MODAL */}
      {reassignModalOpen && selectedCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-base">Reassign Course Offering</h3>
              <button onClick={() => setReassignModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReassignSubmit} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-500">Selected Course</p>
                <p className="text-sm font-bold text-slate-900">{selectedCourse.code}: {selectedCourse.title}</p>
                <p className="text-xs text-slate-600 mt-1">Currently assigned to: {selectedCourse.lecturer_name}</p>
              </div>

              {reassignError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
                  {reassignError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assign to New Lecturer *
                </label>
                <select
                  required
                  value={targetLecturerId}
                  onChange={e => setTargetLecturerId(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Select an active faculty member...</option>
                  {lecturers.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.department})
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-[11px] text-slate-500">
                Course transfer will verify that the recipient faculty does not exceed the maximum of 9 active courses.
              </p>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReassignModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReassign}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingReassign ? 'Reassigning...' : 'Confirm Reassignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE COURSE MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-bold text-base">Provision New Course</h3>
              <button onClick={() => setCreateModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Course Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CSC 401"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Course Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed Operating Systems"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Lecturer *
                </label>
                <select
                  required
                  value={newLecturerId}
                  onChange={e => setNewLecturerId(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Select a lecturer...</option>
                  {lecturers.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.department})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department
                </label>
                <select
                  value={newDept}
                  onChange={e => setNewDept(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                >
                  <option value="Computer Science">Computer Science</option>
                  <option value="Cyber Security">Cyber Security</option>
                  <option value="Software Engineering">Software Engineering</option>
                  <option value="Information Technology">Information Technology</option>
                  <option value="Maritime Studies">Maritime Studies</option>
                  <option value="Business Administration">Business Administration</option>
                  <option value="Accounting">Accounting</option>
                  <option value="General Studies">General Studies</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingCreate ? 'Creating...' : 'Create Course'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
