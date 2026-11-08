import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';

// Auth Pages
import { LoginPage } from './pages/auth/LoginPage';

// Admin Pages
import { AdminHomePage } from './pages/admin/AdminHomePage';
import { LecturersPage } from './pages/admin/LecturersPage';
import { CoursesPage } from './pages/admin/CoursesPage';
import { StudentsMasterPage } from './pages/admin/StudentsMasterPage';
import { AnalyticsPage } from './pages/admin/AnalyticsPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { DeviceBindingsPage } from './pages/admin/DeviceBindingsPage';
import { AuditPage } from './pages/admin/AuditPage';

// Lecturer Pages
import { LecturerDashboardPage } from './pages/lecturer/LecturerDashboardPage';
import { CourseDetailPage } from './pages/lecturer/CourseDetailPage';
import { StudentAttendanceCalendarPage } from './pages/lecturer/StudentAttendanceCalendarPage';
import { ClassroomProjectorView } from './pages/lecturer/ClassroomProjectorView';

// Route Guards
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/lecturer/dashboard" replace />;
  return <>{children}</>;
};

const LecturerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const RootRedirect: React.FC = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return isAdmin ? <Navigate to="/admin/home" replace /> : <Navigate to="/lecturer/dashboard" replace />;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Login Route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Standalone Classroom Projector Display */}
          <Route path="/lecturer/projector/:sessionId" element={<ClassroomProjectorView />} />

          {/* Protected App Routes inside Shared Layout */}
          <Route path="/" element={<AppLayout />}>
            {/* Index redirection */}
            <Route index element={<RootRedirect />} />

            {/* Admin Routes */}
            <Route path="admin/home" element={<AdminRoute><AdminHomePage /></AdminRoute>} />
            <Route path="admin/lecturers" element={<AdminRoute><LecturersPage /></AdminRoute>} />
            <Route path="admin/courses" element={<AdminRoute><CoursesPage /></AdminRoute>} />
            <Route path="admin/students" element={<AdminRoute><StudentsMasterPage /></AdminRoute>} />
            <Route path="admin/analytics" element={<AdminRoute><AnalyticsPage /></AdminRoute>} />
            <Route path="admin/device-bindings" element={<AdminRoute><DeviceBindingsPage /></AdminRoute>} />
            <Route path="admin/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
            <Route path="admin/audit" element={<AdminRoute><AuditPage /></AdminRoute>} />

            {/* Lecturer Routes */}
            <Route path="lecturer/dashboard" element={<LecturerRoute><LecturerDashboardPage /></LecturerRoute>} />
            <Route path="lecturer/courses" element={<LecturerRoute><LecturerDashboardPage /></LecturerRoute>} />
            <Route path="lecturer/courses/:id" element={<LecturerRoute><CourseDetailPage /></LecturerRoute>} />
            <Route path="lecturer/courses/:id/roster" element={<LecturerRoute><CourseDetailPage /></LecturerRoute>} />
            <Route path="lecturer/courses/:id/sessions" element={<LecturerRoute><CourseDetailPage /></LecturerRoute>} />
            <Route path="lecturer/courses/:id/students" element={<LecturerRoute><CourseDetailPage /></LecturerRoute>} />
            <Route
              path="lecturer/courses/:id/students/:studentId/calendar"
              element={<LecturerRoute><StudentAttendanceCalendarPage /></LecturerRoute>}
            />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
