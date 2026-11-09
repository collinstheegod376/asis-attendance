import { 
  User, 
  StudentMaster, 
  Course, 
  CourseRoster, 
  LectureSession, 
  AttendanceRecord, 
  DeviceBinding, 
  DeviceEvent,
  AuditLog, 
  SystemSettings 
} from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

const STORAGE_KEYS = {
  USERS: 'adun_users',
  STUDENTS_MASTER: 'adun_students_master',
  COURSES: 'adun_courses',
  COURSE_ROSTER: 'adun_course_roster',
  SESSIONS: 'adun_sessions',
  ATTENDANCE: 'adun_attendance_records',
  DEVICE_BINDINGS: 'adun_device_bindings',
  DEVICE_EVENTS: 'adun_device_events',
  AUDIT_LOGS: 'adun_audit_logs',
  SETTINGS: 'adun_settings',
  INITIALIZED: 'adun_system_initialized_v1',
};

// Default seed admin and settings ONLY (STRICTLY NO DEMO STUDENTS, COURSES OR SESSIONS)
const SEED_ADMIN: User = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'admin',
  username: 'admin',
  password: 'admin', // Enforces change password on first login
  email: 'admin@adun.edu.ng',
  name: 'System Administrator',
  department: 'ICT & Academic Affairs',
  staff_id: 'ADUN/ADM/001',
  status: 'active',
  must_change_password: true,
  created_at: new Date().toISOString(),
};

const DEFAULT_SETTINGS: SystemSettings = {
  location_mode: 'evidence_only',
  campus_center_lat: 6.2235, // Admiralty University of Nigeria Ibusa/Ogwashi-Uku Campus
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
  updated_by: 'System Seed',
};

function getItem<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read from localStorage key: ${key}`, e);
    return defaultValue;
  }
}

function setItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Failed to write to localStorage key: ${key}`, e);
  }
}

let syncStarted = false;

export class AppStorage {
  static setRawItem<T>(key: string, value: T): void {
    setItem(key, value);
  }

  static async syncFromSupabase(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const [
        usersRes,
        studentsRes,
        coursesRes,
        rosterRes,
        sessionsRes,
        attendanceRes,
        bindingsRes,
        eventsRes,
        settingsRes,
        logsRes,
      ] = await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('students_master').select('*'),
        supabase.from('courses').select('*'),
        supabase.from('course_roster').select('*'),
        supabase.from('lecture_sessions').select('*'),
        supabase.from('attendance_records').select('*'),
        supabase.from('device_bindings').select('*'),
        supabase.from('device_events').select('*'),
        supabase.from('settings').select('*').limit(1),
        supabase.from('audit_logs').select('*').limit(200),
      ]);

      if (usersRes.data && usersRes.data.length > 0) {
        const mappedUsers: User[] = usersRes.data.map((u: any) => ({
          id: u.id,
          role: u.role,
          username: u.username,
          password: 'admin',
          email: u.email,
          name: u.username === 'admin' ? 'System Administrator' : (u.username === 'tega' ? 'Mr Tega' : u.username),
          department: u.role === 'admin' ? 'ICT & Academic Affairs' : 'Computer Science',
          staff_id: `ADUN/${u.role === 'admin' ? 'ADM' : 'LEC'}/001`,
          status: u.status,
          must_change_password: u.must_change_password,
          created_at: u.created_at,
        }));
        setItem(STORAGE_KEYS.USERS, mappedUsers);
      }

      if (studentsRes.data && studentsRes.data.length > 0) {
        setItem(STORAGE_KEYS.STUDENTS_MASTER, studentsRes.data);
      }

      if (coursesRes.data) {
        setItem(STORAGE_KEYS.COURSES, coursesRes.data);
      }

      if (rosterRes.data && studentsRes.data) {
        const studentMap = new Map((studentsRes.data || []).map((s: any) => [s.id, s]));
        const mappedRoster: CourseRoster[] = rosterRes.data.map((r: any) => {
          const s = studentMap.get(r.student_id);
          return {
            id: r.id,
            course_id: r.course_id,
            student_id: r.student_id,
            matric_no: s?.matric_no || '',
            student_name: s ? `${s.surname} ${s.first_name} ${s.middle_name || ''}`.trim() : 'Enrolled Student',
            program: s?.program || 'Computer Science',
            level: String(s?.level || '200'),
            uploaded_by: r.uploaded_by,
            uploaded_at: r.uploaded_at,
          };
        });
        setItem(STORAGE_KEYS.COURSE_ROSTER, mappedRoster);
      }

      if (sessionsRes.data) {
        setItem(STORAGE_KEYS.SESSIONS, sessionsRes.data);
      }

      if (attendanceRes.data) {
        setItem(STORAGE_KEYS.ATTENDANCE, attendanceRes.data);
      }

      if (bindingsRes.data) {
        setItem(STORAGE_KEYS.DEVICE_BINDINGS, bindingsRes.data);
      }

      if (eventsRes.data) {
        setItem(STORAGE_KEYS.DEVICE_EVENTS, eventsRes.data);
      }

      if (settingsRes.data && settingsRes.data[0]) {
        setItem(STORAGE_KEYS.SETTINGS, { ...DEFAULT_SETTINGS, ...settingsRes.data[0] });
      }

      if (logsRes.data) {
        const userMap = new Map((usersRes.data || []).map((u: any) => [u.id, u.username === 'admin' ? 'System Administrator' : (u.username === 'tega' ? 'Mr Tega' : u.username)]));
        const mappedLogs = logsRes.data.map((l: any) => ({
          ...l,
          actor_name: l.actor_name || userMap.get(l.actor_id) || l.metadata?.actor_name || (l.actor_role === 'admin' ? 'System Administrator' : (l.actor_role === 'lecturer' ? 'Lecturer' : 'System')),
        }));
        setItem(STORAGE_KEYS.AUDIT_LOGS, mappedLogs);
      }
    } catch (e) {
      console.warn('Supabase sync warning:', e);
    }
  }

  static startServerSync(): void {
    if (syncStarted || typeof window === 'undefined') return;
    syncStarted = true;

    // Direct Real-time Supabase sync
    this.syncFromSupabase();
    setInterval(() => this.syncFromSupabase(), 3000);
  }

  static init(): void {
    if (!localStorage.getItem(STORAGE_KEYS.INITIALIZED)) {
      // Initialize with ONLY seed admin and default settings. Zero demo data.
      setItem<User[]>(STORAGE_KEYS.USERS, [SEED_ADMIN]);
      setItem<StudentMaster[]>(STORAGE_KEYS.STUDENTS_MASTER, []);
      setItem<Course[]>(STORAGE_KEYS.COURSES, []);
      setItem<CourseRoster[]>(STORAGE_KEYS.COURSE_ROSTER, []);
      setItem<LectureSession[]>(STORAGE_KEYS.SESSIONS, []);
      setItem<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, []);
      setItem<DeviceBinding[]>(STORAGE_KEYS.DEVICE_BINDINGS, []);
      setItem<DeviceEvent[]>(STORAGE_KEYS.DEVICE_EVENTS, []);
      setItem<SystemSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);

      const initAudit: AuditLog = {
        id: 'aud_init_' + Date.now(),
        actor_id: SEED_ADMIN.id,
        actor_name: SEED_ADMIN.name,
        actor_role: 'system',
        action: 'SYSTEM_BOOTSTRAP',
        entity: 'system',
        entity_id: 'seed',
        metadata: { message: 'ADUN Attendance system initialized with seed admin account' },
        created_at: new Date().toISOString(),
      };
      setItem<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, [initAudit]);
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    }
    this.startServerSync();
  }

  // =================== USERS & AUTH ===================
  static getUsers(): User[] {
    this.init();
    return getItem<User[]>(STORAGE_KEYS.USERS, [SEED_ADMIN]);
  }

  static getUser(id: string): User | undefined {
    return this.getUsers().find(u => u.id === id);
  }

  static findUserByUsername(username: string): User | undefined {
    const clean = username.trim().toLowerCase();
    return this.getUsers().find(u => u.username.toLowerCase() === clean || u.email.toLowerCase() === clean);
  }

  static createUser(user: Omit<User, 'id' | 'created_at'>, actor: { id: string; name: string }): { success: boolean; error?: string; user?: User } {
    const users = this.getUsers();
    const cleanUsername = user.username.trim().toLowerCase();
    const cleanEmail = user.email.trim().toLowerCase();

    if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
      return { success: false, error: 'A user with this username already exists.' };
    }
    if (users.some(u => u.email.toLowerCase() === cleanEmail)) {
      return { success: false, error: 'A user with this email already exists.' };
    }

    const newUser: User = {
      ...user,
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      created_at: new Date().toISOString(),
    };

    users.push(newUser);
    setItem(STORAGE_KEYS.USERS, users);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'CREATE_LECTURER',
      'users',
      newUser.id,
      { username: newUser.username, name: newUser.name, department: newUser.department }
    );

    return { success: true, user: newUser };
  }

  static updateUser(id: string, updates: Partial<User>, actor?: { id: string; name: string }): { success: boolean; error?: string } {
    const users = this.getUsers();
    const index = users.findIndex(u => u.id === id);
    if (index === -1) return { success: false, error: 'User not found' };

    const old = users[index];
    users[index] = { ...old, ...updates };
    setItem(STORAGE_KEYS.USERS, users);

    if (actor) {
      this.logAudit(
        actor.id,
        actor.name,
        'admin',
        'UPDATE_USER',
        'users',
        id,
        { updatedFields: Object.keys(updates) }
      );
    }
    return { success: true };
  }

  static softDeleteUser(id: string, actionOnCourses: 'archive' | 'keep', actor: { id: string; name: string }): { success: boolean; error?: string } {
    const users = this.getUsers();
    const user = users.find(u => u.id === id);
    if (!user) return { success: false, error: 'User not found' };

    if (user.role === 'admin' && user.username === 'admin') {
      return { success: false, error: 'The primary system admin account cannot be deleted.' };
    }

    user.status = 'soft_deleted';
    user.deleted_at = new Date().toISOString();
    setItem(STORAGE_KEYS.USERS, users);

    // Handle courses of this lecturer
    const courses = this.getCourses();
    let coursesModified = 0;
    if (actionOnCourses === 'archive') {
      courses.forEach(c => {
        if (c.lecturer_id === id && c.status === 'active') {
          c.status = 'archived';
          c.archived_at = new Date().toISOString();
          coursesModified++;
        }
      });
      setItem(STORAGE_KEYS.COURSES, courses);
    }

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'SOFT_DELETE_LECTURER',
      'users',
      id,
      {
        lecturerName: user.name,
        actionOnCourses,
        coursesArchived: coursesModified,
        attendancePreserved: true,
      }
    );

    return { success: true };
  }

  static restoreUser(id: string, actor: { id: string; name: string }): { success: boolean; error?: string } {
    const users = this.getUsers();
    const user = users.find(u => u.id === id);
    if (!user) return { success: false, error: 'User not found' };

    user.status = 'active';
    user.deleted_at = null;
    setItem(STORAGE_KEYS.USERS, users);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'RESTORE_LECTURER',
      'users',
      id,
      { lecturerName: user.name }
    );

    return { success: true };
  }

  static resetLecturerPassword(id: string, tempPassword: string, actor: { id: string; name: string }): { success: boolean; error?: string } {
    const users = this.getUsers();
    const user = users.find(u => u.id === id);
    if (!user) return { success: false, error: 'User not found' };

    user.password = tempPassword;
    user.must_change_password = true;
    setItem(STORAGE_KEYS.USERS, users);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'RESET_PASSWORD',
      'users',
      id,
      { lecturerName: user.name, targetUsername: user.username }
    );

    return { success: true };
  }

  // =================== STUDENTS MASTER ===================
  static getStudentsMaster(): StudentMaster[] {
    this.init();
    return getItem<StudentMaster[]>(STORAGE_KEYS.STUDENTS_MASTER, []);
  }

  static findStudentByMatric(matric: string): StudentMaster | undefined {
    const clean = this.normalizeMatric(matric);
    return this.getStudentsMaster().find(s => this.normalizeMatric(s.matric_no) === clean);
  }

  static normalizeMatric(matric: string): string {
    if (!matric) return '';
    return matric.trim().toUpperCase().replace(/\s+/g, '');
  }

  static importStudentsMaster(
    records: Array<{
      matric_no: string;
      surname: string;
      first_name: string;
      middle_name?: string;
      program: string;
      level: string | number;
      email?: string;
      phone?: string;
      search_key?: string;
    }>,
    replaceAll: boolean,
    actor: { id: string; name: string }
  ): {
    total: number;
    accepted: number;
    rejected: number;
    acceptedRows: StudentMaster[];
    rejectedRows: Array<{ row: number; matric_no: string; reason: string }>;
  } {
    const existing = replaceAll ? [] : this.getStudentsMaster();
    const existingMatrics = new Set(existing.map(s => this.normalizeMatric(s.matric_no)));
    const seenInBatch = new Set<string>();

    const acceptedRows: StudentMaster[] = [];
    const rejectedRows: Array<{ row: number; matric_no: string; reason: string }> = [];

    records.forEach((r, idx) => {
      const rowNum = idx + 1;
      const rawMatric = r.matric_no ? String(r.matric_no).trim() : '';
      const normMatric = this.normalizeMatric(rawMatric);

      if (!normMatric) {
        rejectedRows.push({ row: rowNum, matric_no: '', reason: 'Missing matric number' });
        return;
      }

      if (!r.surname || !String(r.surname).trim()) {
        rejectedRows.push({ row: rowNum, matric_no: normMatric, reason: 'Missing surname' });
        return;
      }

      if (!r.first_name || !String(r.first_name).trim()) {
        rejectedRows.push({ row: rowNum, matric_no: normMatric, reason: 'Missing first name' });
        return;
      }

      if (seenInBatch.has(normMatric)) {
        rejectedRows.push({ row: rowNum, matric_no: normMatric, reason: 'Duplicate matric number in current upload batch' });
        return;
      }

      if (!replaceAll && existingMatrics.has(normMatric)) {
        rejectedRows.push({ row: rowNum, matric_no: normMatric, reason: 'Matric number already exists in master directory' });
        return;
      }

      seenInBatch.add(normMatric);

      // Generate search key from last digits or fallback
      const digitsMatch = normMatric.match(/\d+$/);
      const searchKey = r.search_key ? String(r.search_key).trim() : (digitsMatch ? digitsMatch[0].slice(-3).padStart(3, '0') : '000');

      const cleanLevel = String(r.level || '100').replace(/[^0-9]/g, '') || '100';

      const student: StudentMaster = {
        id: 'std_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        matric_no: normMatric,
        search_key: searchKey,
        surname: String(r.surname).trim(),
        first_name: String(r.first_name).trim(),
        middle_name: r.middle_name ? String(r.middle_name).trim() : '',
        program: r.program ? String(r.program).trim() : 'General',
        level: cleanLevel,
        email: r.email ? String(r.email).trim().toLowerCase() : undefined,
        phone: r.phone ? String(r.phone).trim() : undefined,
        status: 'active',
        created_at: new Date().toISOString(),
      };

      acceptedRows.push(student);
    });

    const finalStudents = replaceAll ? acceptedRows : [...existing, ...acceptedRows];
    setItem(STORAGE_KEYS.STUDENTS_MASTER, finalStudents);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'IMPORT_STUDENTS_MASTER',
      'students_master',
      'batch',
      {
        totalSubmitted: records.length,
        acceptedCount: acceptedRows.length,
        rejectedCount: rejectedRows.length,
        mode: replaceAll ? 'replace_all' : 'append',
      }
    );

    return {
      total: records.length,
      accepted: acceptedRows.length,
      rejected: rejectedRows.length,
      acceptedRows,
      rejectedRows,
    };
  }

  // =================== COURSES ===================
  static getCourses(): Course[] {
    this.init();
    const courses = getItem<Course[]>(STORAGE_KEYS.COURSES, []);
    const users = this.getUsers();
    const rosters = this.getCourseRosters();
    const sessions = getItem<LectureSession[]>(STORAGE_KEYS.SESSIONS, []);

    return courses.map(c => {
      const lecturer = users.find(u => u.id === c.lecturer_id);
      const enrolled = rosters.filter(r => r.course_id === c.id).length;
      const sessionCount = sessions.filter(s => s.course_id === c.id).length;
      return {
        ...c,
        lecturer_name: lecturer ? lecturer.name : 'Unknown / Unassigned',
        enrolled_count: enrolled,
        sessions_count: sessionCount,
      };
    });
  }

  static getCourse(id: string): Course | undefined {
    return this.getCourses().find(c => c.id === id);
  }

  static createCourse(
    course: { code: string; title: string; lecturer_id: string; department?: string },
    actor: { id: string; name: string }
  ): { success: boolean; error?: string; course?: Course } {
    const courses = this.getCourses();
    const settings = this.getSettings();
    const codeClean = course.code.trim().toUpperCase();

    // Check 9 active courses limit for this lecturer
    const activeCount = courses.filter(c => c.lecturer_id === course.lecturer_id && c.status === 'active').length;
    if (activeCount >= settings.max_active_courses_per_lecturer) {
      return {
        success: false,
        error: `Lecturer has reached the maximum quota of ${settings.max_active_courses_per_lecturer} active courses. Archive an existing course to free up a slot.`,
      };
    }

    if (courses.some(c => c.code.toUpperCase() === codeClean && c.status === 'active')) {
      return { success: false, error: `An active course with code "${codeClean}" already exists.` };
    }

    const newCourse: Course = {
      id: 'crs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      code: codeClean,
      title: course.title.trim(),
      lecturer_id: course.lecturer_id,
      department: course.department,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    courses.push(newCourse);
    setItem(STORAGE_KEYS.COURSES, courses);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'CREATE_COURSE',
      'courses',
      newCourse.id,
      { code: newCourse.code, title: newCourse.title, lecturer_id: newCourse.lecturer_id }
    );

    return { success: true, course: newCourse };
  }

  static reassignCourse(courseId: string, newLecturerId: string, actor: { id: string; name: string }): { success: boolean; error?: string } {
    const courses = this.getCourses();
    const course = courses.find(c => c.id === courseId);
    if (!course) return { success: false, error: 'Course not found' };

    const users = this.getUsers();
    const newLecturer = users.find(u => u.id === newLecturerId && u.status === 'active');
    if (!newLecturer) return { success: false, error: 'Target lecturer is not active or does not exist.' };

    const settings = this.getSettings();
    const activeCount = courses.filter(c => c.lecturer_id === newLecturerId && c.status === 'active' && c.id !== courseId).length;
    if (activeCount >= settings.max_active_courses_per_lecturer) {
      return {
        success: false,
        error: `${newLecturer.name} already holds ${activeCount} of ${settings.max_active_courses_per_lecturer} maximum active courses.`,
      };
    }

    const oldLecturerId = course.lecturer_id;
    course.lecturer_id = newLecturerId;
    setItem(STORAGE_KEYS.COURSES, courses);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'REASSIGN_COURSE',
      'courses',
      courseId,
      {
        courseCode: course.code,
        previousLecturerId: oldLecturerId,
        newLecturerId,
        newLecturerName: newLecturer.name,
      }
    );

    return { success: true };
  }

  static toggleArchiveCourse(courseId: string, actor: { id: string; name: string }): { success: boolean; error?: string; status?: 'active' | 'archived' } {
    const courses = this.getCourses();
    const course = courses.find(c => c.id === courseId);
    if (!course) return { success: false, error: 'Course not found' };

    const newStatus = course.status === 'active' ? 'archived' : 'active';
    
    // If activating, check quota
    if (newStatus === 'active') {
      const settings = this.getSettings();
      const activeCount = courses.filter(c => c.lecturer_id === course.lecturer_id && c.status === 'active').length;
      if (activeCount >= settings.max_active_courses_per_lecturer) {
        return {
          success: false,
          error: `Lecturer already has ${activeCount} active courses. Cannot activate another.`,
        };
      }
    }

    course.status = newStatus;
    course.archived_at = newStatus === 'archived' ? new Date().toISOString() : null;
    setItem(STORAGE_KEYS.COURSES, courses);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      newStatus === 'archived' ? 'ARCHIVE_COURSE' : 'UNARCHIVE_COURSE',
      'courses',
      courseId,
      { courseCode: course.code, newStatus }
    );

    return { success: true, status: newStatus };
  }

  // =================== ROSTERS ===================
  static getCourseRosters(): CourseRoster[] {
    this.init();
    return getItem<CourseRoster[]>(STORAGE_KEYS.COURSE_ROSTER, []);
  }

  static getCourseRoster(courseId: string): CourseRoster[] {
    return this.getCourseRosters().filter(r => r.course_id === courseId);
  }

  // =================== SESSIONS ===================
  static getSessions(): LectureSession[] {
    this.init();
    const sessions = getItem<LectureSession[]>(STORAGE_KEYS.SESSIONS, []);
    const courses = getItem<Course[]>(STORAGE_KEYS.COURSES, []);
    const records = this.getAttendanceRecords();

    return sessions.map(s => {
      const crs = courses.find(c => c.id === s.course_id);
      const count = records.filter(r => r.session_id === s.id).length;
      return {
        ...s,
        course_code: crs?.code || 'N/A',
        course_title: crs?.title || 'Unknown Course',
        attendance_count: count,
      };
    });
  }

  // =================== ATTENDANCE RECORDS ===================
  static getAttendanceRecords(): AttendanceRecord[] {
    this.init();
    return getItem<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, []);
  }

  // =================== DEVICE BINDINGS ===================
  static getDeviceBindings(): DeviceBinding[] {
    this.init();
    const bindings = getItem<DeviceBinding[]>(STORAGE_KEYS.DEVICE_BINDINGS, []);
    return bindings.map(b => ({
      ...b,
      status: b.status || 'active',
      is_shared: Boolean(b.is_shared),
    }));
  }

  static getDeviceBinding(id: string): DeviceBinding | undefined {
    return this.getDeviceBindings().find(b => b.id === id);
  }

  static checkAdminResetRateLimit(adminId: string): { allowed: boolean; remaining: number; countInLastHour: number } {
    const oneHourAgo = Date.now() - 3600 * 1000;
    const events = this.getDeviceEvents();

    const recentResets = events.filter(e => {
      const isReset = e.event_type === 'admin_reset' || e.event_type === 'device_reset';
      const isActor = e.actor_id === adminId || e.metadata?.admin_id === adminId;
      const withinHour = new Date(e.created_at).getTime() >= oneHourAgo;
      return isReset && isActor && withinHour;
    });

    const count = recentResets.length;
    const maxPerHour = 50;
    return {
      allowed: count < maxPerHour,
      remaining: Math.max(0, maxPerHour - count),
      countInLastHour: count,
    };
  }

  static resetDeviceBinding(
    id: string,
    reason: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    if (!reason || !reason.trim()) {
      return { success: false, error: 'A mandatory justification reason is required before resetting a device binding.' };
    }

    // Rate-limit check (max 50 resets/hour per admin)
    const rateCheck = this.checkAdminResetRateLimit(actor.id);
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: `Administrative rate limit exceeded: Maximum 50 resets per hour reached (${rateCheck.countInLastHour}/50). Please wait before resetting additional devices.`,
      };
    }

    const bindings = this.getDeviceBindings();
    const binding = bindings.find(b => b.id === id);
    if (!binding) return { success: false, error: 'Device binding not found.' };

    const previousStatus = binding.status;
    const nowIso = new Date().toISOString();

    // Does not delete history; updates status = 'reset', sets reset_by and reset_at
    binding.status = 'reset';
    binding.reset_by = actor.id;
    binding.reset_at = nowIso;
    binding.reset_reason = reason.trim();
    setItem(STORAGE_KEYS.DEVICE_BINDINGS, bindings);

    // Forensic Event Log: BIND-205
    this.logDeviceEvent({
      student_id: binding.student_id,
      matric_no: binding.matric_no,
      event_type: 'admin_reset',
      reference_code: 'BIND-205',
      device_id: binding.device_id,
      ip_address: binding.ip_address || '127.0.0.1 (Admin Console)',
      user_agent: binding.user_agent,
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: 'admin',
      reason: reason.trim(),
      metadata: {
        reason: reason.trim(),
        admin_id: actor.id,
        admin_name: actor.name,
        previous_status: previousStatus,
        new_status: 'reset',
        reference_code: 'BIND-205',
        device_fingerprint: binding.device_fingerprint_hash || binding.device_id,
      },
    });

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'RESET_DEVICE_BINDING',
      'device_bindings',
      id,
      {
        matric_no: binding.matric_no,
        student_name: binding.student_name,
        device_id: binding.device_id,
        reference_code: 'BIND-205',
        reason: reason.trim(),
      },
      'BIND-205'
    );

    return { success: true };
  }

  static toggleSharedDevice(
    id: string,
    isShared: boolean,
    reason: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    if (!reason || !reason.trim()) {
      return { success: false, error: 'A mandatory documentation reason is required when toggling shared device status.' };
    }

    const bindings = this.getDeviceBindings();
    const binding = bindings.find(b => b.id === id);
    if (!binding) return { success: false, error: 'Device binding not found.' };

    const nowIso = new Date().toISOString();
    binding.is_shared = isShared;
    binding.shared_reason = reason.trim();
    binding.shared_updated_at = nowIso;
    binding.shared_updated_by = actor.name;
    setItem(STORAGE_KEYS.DEVICE_BINDINGS, bindings);

    const refCode = isShared ? 'BIND-207' : 'BIND-208';
    this.logDeviceEvent({
      student_id: binding.student_id,
      matric_no: binding.matric_no,
      event_type: 'bind',
      reference_code: refCode,
      device_id: binding.device_id,
      ip_address: binding.ip_address || '127.0.0.1 (Admin Console)',
      user_agent: binding.user_agent,
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: 'admin',
      reason: reason.trim(),
      metadata: {
        is_shared: isShared,
        reason: reason.trim(),
        admin_id: actor.id,
        admin_name: actor.name,
        reference_code: refCode,
        policy: 'OPTION_2_SHARED_EXCEPTION',
      },
    });

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      isShared ? 'ENABLE_SHARED_DEVICE_EXCEPTION' : 'DISABLE_SHARED_DEVICE_EXCEPTION',
      'device_bindings',
      id,
      {
        matric_no: binding.matric_no,
        student_name: binding.student_name,
        is_shared: isShared,
        reason: reason.trim(),
        reference_code: refCode,
      },
      refCode
    );

    return { success: true };
  }

  static revokeDeviceBinding(
    id: string,
    reason: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    if (!reason || !reason.trim()) {
      return { success: false, error: 'A mandatory justification reason is required to revoke a device binding.' };
    }

    const bindings = this.getDeviceBindings();
    const binding = bindings.find(b => b.id === id);
    if (!binding) return { success: false, error: 'Device binding not found.' };

    const previousStatus = binding.status;
    const nowIso = new Date().toISOString();

    binding.status = 'revoked';
    binding.reset_by = actor.id;
    binding.reset_at = nowIso;
    binding.reset_reason = reason.trim();
    setItem(STORAGE_KEYS.DEVICE_BINDINGS, bindings);

    const refCode = 'BIND-209';
    this.logDeviceEvent({
      student_id: binding.student_id,
      matric_no: binding.matric_no,
      event_type: 'mismatch',
      reference_code: refCode,
      device_id: binding.device_id,
      ip_address: binding.ip_address || '127.0.0.1 (Admin Console)',
      user_agent: binding.user_agent,
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: 'admin',
      reason: reason.trim(),
      metadata: {
        previous_status: previousStatus,
        new_status: 'revoked',
        reason: reason.trim(),
        admin_id: actor.id,
        admin_name: actor.name,
        reference_code: refCode,
      },
    });

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'REVOKE_DEVICE_BINDING',
      'device_bindings',
      id,
      {
        matric_no: binding.matric_no,
        student_name: binding.student_name,
        reason: reason.trim(),
        reference_code: refCode,
      },
      refCode
    );

    return { success: true };
  }

  // =================== DEVICE EVENTS ===================
  static getDeviceEvents(): DeviceEvent[] {
    this.init();
    return getItem<DeviceEvent[]>(STORAGE_KEYS.DEVICE_EVENTS, []);
  }

  static getStudentDeviceEvents(studentIdOrMatric: string, limit: number = 20): DeviceEvent[] {
    const events = this.getDeviceEvents();
    const clean = studentIdOrMatric.trim().toLowerCase();
    const matched = events.filter(
      e =>
        e.student_id?.toLowerCase() === clean ||
        e.matric_no?.toLowerCase() === clean ||
        (e.device_id && e.device_id.toLowerCase() === clean)
    );
    return matched.slice(0, limit);
  }

  static logDeviceEvent(event: Omit<DeviceEvent, 'id' | 'created_at'>): DeviceEvent {
    this.init();
    const events = this.getDeviceEvents();
    const newEvent: DeviceEvent = {
      ...event,
      id: 'devevt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      created_at: new Date().toISOString(),
    };
    events.unshift(newEvent);
    // Keep max 3000 events
    if (events.length > 3000) events.length = 3000;
    setItem(STORAGE_KEYS.DEVICE_EVENTS, events);
    return newEvent;
  }

  static lecturerResetDeviceBinding(
    studentId: string,
    reason: string,
    actor: { id: string; name: string; role?: 'lecturer' | 'admin' },
    courseContext?: { course_id?: string; course_code?: string }
  ): { success: boolean; error?: string } {
    if (!reason || !reason.trim()) {
      return { success: false, error: 'A mandatory justification reason is required for emergency device reset.' };
    }

    const students = this.getStudentsMaster();
    const student = students.find(s => s.id === studentId || s.matric_no.toLowerCase() === studentId.toLowerCase());
    if (!student) {
      return { success: false, error: 'Student record not found in institution directory.' };
    }

    const bindings = this.getDeviceBindings();
    let binding = bindings.find(b => b.student_id === student.id || b.matric_no.toLowerCase() === student.matric_no.toLowerCase());

    const nowIso = new Date().toISOString();
    if (binding) {
      binding.status = 'reset';
      binding.reset_by = actor.id;
      binding.reset_at = nowIso;
    } else {
      // Create a reset marker binding record so the student's next sign-in can bind a fresh device
      binding = {
        id: 'bind_' + Date.now(),
        device_id: 'RESET_PENDING',
        student_id: student.id,
        matric_no: student.matric_no,
        student_name: `${student.surname} ${student.first_name}`,
        matric_hash: 'PENDING_REBIND',
        first_bound_at: nowIso,
        last_seen_at: nowIso,
        status: 'reset',
        reset_by: actor.id,
        reset_at: nowIso,
      };
      bindings.push(binding);
    }
    setItem(STORAGE_KEYS.DEVICE_BINDINGS, bindings);

    const actorRole = actor.role || 'lecturer';

    // 1. Log to device_events
    this.logDeviceEvent({
      student_id: student.id,
      matric_no: student.matric_no,
      event_type: 'admin_reset',
      reference_code: 'BIND-205',
      device_id: binding.device_id,
      ip_address: '127.0.0.1 (Lecturer Console)',
      actor_id: actor.id,
      actor_name: actor.name,
      actor_role: actorRole,
      reason: reason.trim(),
      metadata: {
        course_id: courseContext?.course_id,
        course_code: courseContext?.course_code,
        student_name: `${student.surname} ${student.first_name}`,
        action_type: 'EMERGENCY_LECTURER_RESET',
        compliance_check: 'OPTION_2_STRICT_DEVICE_BINDING',
        reference_code: 'BIND-205',
      },
    });

    // 2. Log to audit_logs
    this.logAudit(
      actor.id,
      actor.name,
      actorRole,
      'EMERGENCY_DEVICE_RESET',
      'device_bindings',
      binding.id,
      {
        student_id: student.id,
        matric_no: student.matric_no,
        student_name: `${student.surname} ${student.first_name}`,
        reason: reason.trim(),
        course_id: courseContext?.course_id,
        course_code: courseContext?.course_code,
        reference_code: 'BIND-205',
      },
      'BIND-205'
    );

    return { success: true };
  }

  // =================== SETTINGS ===================
  static getSettings(): SystemSettings {
    this.init();
    return getItem<SystemSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }

  static updateSettings(settings: Partial<SystemSettings>, actor: { id: string; name: string }): { success: boolean; error?: string } {
    const current = this.getSettings();
    const updated: SystemSettings = {
      ...current,
      ...settings,
      updated_at: new Date().toISOString(),
      updated_by: actor.name,
    };
    setItem(STORAGE_KEYS.SETTINGS, updated);

    this.logAudit(
      actor.id,
      actor.name,
      'admin',
      'UPDATE_SYSTEM_SETTINGS',
      'settings',
      'global',
      { changedKeys: Object.keys(settings) }
    );

    return { success: true };
  }

  // =================== AUDIT LOGS ===================
  static getAuditLogs(): AuditLog[] {
    this.init();
    const logs = getItem<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  static logAudit(
    actorId: string,
    actorName: string,
    actorRole: 'admin' | 'lecturer' | 'system',
    action: string,
    entity: string,
    entityId?: string,
    metadata?: Record<string, any>,
    referenceCode?: string
  ): void {
    const logs = getItem<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    const ref = referenceCode || (metadata && metadata.reference_code) || undefined;
    const newLog: AuditLog = {
      id: 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      actor_id: actorId,
      actor_name: actorName,
      actor_role: actorRole,
      action,
      entity,
      entity_id: entityId,
      reference_code: ref,
      metadata,
      created_at: new Date().toISOString(),
    };
    logs.unshift(newLog);
    // Keep max 2000 logs in local storage
    if (logs.length > 2000) logs.length = 2000;
    setItem(STORAGE_KEYS.AUDIT_LOGS, logs);
  }

  // =================== ANALYTICS HELPERS ===================
  static getAnalyticsOverview() {
    const users = this.getUsers();
    const lecturers = users.filter(u => u.role === 'lecturer');
    const activeLecturers = lecturers.filter(u => u.status === 'active');
    const courses = this.getCourses();
    const activeCourses = courses.filter(c => c.status === 'active');
    const sessions = this.getSessions();
    const records = this.getAttendanceRecords();
    const studentsMaster = this.getStudentsMaster();

    const presentCount = records.filter(r => r.status === 'present').length;
    const lateCount = records.filter(r => r.status === 'late').length;

    return {
      totalLecturers: lecturers.length,
      activeLecturers: activeLecturers.length,
      totalCourses: courses.length,
      activeCourses: activeCourses.length,
      totalSessions: sessions.length,
      totalAttendance: records.length,
      totalStudentsMaster: studentsMaster.length,
      presentCount,
      lateCount,
    };
  }
}
