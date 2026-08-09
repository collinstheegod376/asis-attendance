import React from 'react';
import { Routes, Route, Link, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Map, LayoutDashboard, History, Settings, LogOut, 
  CheckCircle, Camera, LogIn
} from 'lucide-react';
import CheckInPage from './pages/CheckInPage';
import { StudentHistoryPage, StudentProfilePage } from './pages/StudentPages';
import { LecturerDashboard as ImportedLecturerDashboard, ManageCoursesPage, LiveSessionPage, ReportsPage } from './pages/LecturerPages';

// --- ANIMATION VARIANTS ---
const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2, ease: "easeIn" } }
};

const PageWrapper = ({ children }: { children: React.ReactNode }) => (
  <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
    {children}
  </motion.div>
);

// --- COMPONENTS ---
const Sidebar = ({ role }: { role: 'student' | 'lecturer' | 'admin' }) => {
  const location = useLocation();
  const menu = role === 'student' ? [
    { name: 'Dashboard', path: '/student/dashboard', icon: LayoutDashboard },
    { name: 'Register Face', path: '/student/register-face', icon: Camera },
    { name: 'Check-in', path: '/student/check-in', icon: CheckCircle },
    { name: 'History', path: '/student/history', icon: History },
    { name: 'Profile Settings', path: '/student/profile', icon: Settings },
  ] : [
    { name: 'Dashboard', path: '/lecturer/dashboard', icon: LayoutDashboard },
    { name: 'Manage Courses', path: '/lecturer/courses', icon: Map },
    { name: 'Manage Sessions', path: '/lecturer/sessions', icon: Users },
    { name: 'Reports', path: '/lecturer/reports', icon: History },
    { name: 'Student Mgmt', path: '/lecturer/students', icon: Users },
    { name: 'Profile Settings', path: '/lecturer/profile', icon: Settings },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <img src="https://adun.edu.ng/core/public/images/logo.png" alt="Adun Logo" style={{ height: 32, objectFit: 'contain' }} />
        Adun Attendance
      </div>
      <div className="sidebar-nav">
        {menu.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path} className={`nav-item ${active ? 'active' : ''}`}>
              <item.icon size={20} />
              {item.name}
            </Link>
          )
        })}
      </div>
      <div className="sidebar-nav" style={{marginTop: 'auto', flex: 0}}>
         <Link to="/" className="nav-item">
            <LogOut size={20} /> Logout
         </Link>
      </div>
    </div>
  );
};

const DashboardLayout = () => {
  const location = useLocation();
  const isStudent = location.pathname.includes('/student');
  
  return (
    <div className="dashboard-layout">
      <Sidebar role={isStudent ? 'student' : 'lecturer'} />
      <div className="main-content">
        <div className="top-bar">
          <h2 style={{fontSize: '1.25rem'}}>Admiralty University Portal</h2>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <div style={{textAlign: 'right'}}>
              <div style={{fontWeight: 600}}>John Doe</div>
              <div style={{fontSize: '0.8rem', color: 'var(--text-gray)'}}>{isStudent ? 'Student' : 'Lecturer'}</div>
            </div>
            <div style={{width: 40, height: 40, borderRadius: '50%', background: '#ccc'}}></div>
          </div>
        </div>
        <div className="page-container">
          <AnimatePresence mode="wait">
            <Outlet key={location.pathname} />
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// --- PAGES ---
const LandingPage = () => {
  return (
    <PageWrapper>
      <div style={{minHeight: '100vh', display: 'flex', flexDirection: 'column'}}>
        <div className="top-bar" style={{justifyContent: 'flex-start', gap: 16}}>
           <img src="https://adun.edu.ng/core/public/images/logo.png" alt="Adun Logo" style={{ height: 32, objectFit: 'contain' }} />
           <h1 style={{color: 'var(--primary-navy)', fontSize: '1.2rem'}}>Admiralty University Attendance System</h1>
        </div>
        <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20}}>
          <motion.div initial={{scale: 0.9, opacity: 0}} animate={{scale: 1, opacity: 1}} transition={{duration: 0.5}}>
            <h1 style={{fontSize: '3rem', color: 'var(--primary-navy)', marginBottom: 20}}>Welcome to the Future of Attendance</h1>
            <p style={{fontSize: '1.2rem', color: 'var(--text-gray)', marginBottom: 40, maxWidth: 600, marginInline: 'auto'}}>
              Seamless, secure, and smart. Adun Attendance uses state-of-the-art biometrics and geofencing to ensure accurate turnouts.
            </p>
            <div style={{display: 'flex', gap: 20, justifyContent: 'center'}}>
              <Link to="/login" className="btn btn-primary"><LogIn className="inline mr-2" size={18}/> Student Login</Link>
              <Link to="/login" className="btn btn-secondary"><LogIn className="inline mr-2" size={18}/> Lecturer Login</Link>
            </div>
          </motion.div>
        </div>
      </div>
    </PageWrapper>
  );
};

const LoginPage = () => {
  const [isLecturer, setIsLecturer] = React.useState(false);

  return (
    <PageWrapper>
      <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div className="card" style={{width: '100%', maxWidth: 400}}>
          <div style={{textAlign: 'center', marginBottom: 24}}>
            <img src="https://adun.edu.ng/core/public/images/logo.png" alt="Adun Logo" style={{ height: 48, objectFit: 'contain', marginBottom: 12 }} />
            <h2 style={{color: 'var(--primary-navy)'}}>System Login</h2>
          </div>
          
          <div style={{display: 'flex', marginBottom: 20, background: '#f0f0f0', borderRadius: 8, padding: 4}}>
            <button 
              onClick={() => setIsLecturer(false)}
              style={{flex: 1, padding: '8px 16px', background: !isLecturer ? 'white' : 'transparent', borderRadius: 4, fontWeight: 600, color: !isLecturer ? 'var(--text-dark)' : 'var(--text-gray)', boxShadow: !isLecturer ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>
              Student
            </button>
            <button 
              onClick={() => setIsLecturer(true)}
              style={{flex: 1, padding: '8px 16px', background: isLecturer ? 'white' : 'transparent', borderRadius: 4, fontWeight: 600, color: isLecturer ? 'var(--text-dark)' : 'var(--text-gray)', boxShadow: isLecturer ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'}}>
              Lecturer
            </button>
          </div>

          <div className="form-group">
            <label>{isLecturer ? 'Email Address' : 'Matric Number'}</label>
            <input type="text" className="form-control" placeholder={isLecturer ? 'dr.smith@adun.edu.ng' : 'ADUN/FS/COM/25/...'} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" className="form-control" placeholder="••••••••" />
          </div>
          
          <Link to={isLecturer ? "/lecturer/dashboard" : "/student/dashboard"} className="btn btn-primary" style={{width: '100%', textAlign: 'center', marginTop: 12}}>Sign In</Link>
          
          {!isLecturer && (
            <div style={{textAlign: 'center', marginTop: 24, fontSize: '0.9rem'}}>
              Don't have an account? <Link to="/signup" style={{color: 'var(--primary-navy)', fontWeight: 600}}>Sign Up</Link>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  )
}

const SignUpPage = () => {
  return (
    <PageWrapper>
      <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0'}}>
        <div className="card" style={{width: '100%', maxWidth: 450}}>
          <div style={{textAlign: 'center', marginBottom: 24}}>
            <img src="https://adun.edu.ng/core/public/images/logo.png" alt="Adun Logo" style={{ height: 48, objectFit: 'contain', marginBottom: 12 }} />
            <h2 style={{color: 'var(--primary-navy)'}}>Student Registration</h2>
            <p style={{fontSize: '0.85rem', color: 'var(--text-gray)', marginTop: 4}}>Strictly for CS 100-Level Students</p>
          </div>
          
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" className="form-control" placeholder="Jane Doe" />
          </div>
          <div className="form-group">
            <label>Matric Number</label>
            <input type="text" className="form-control" placeholder="ADUN/FS/COM/25/001" />
            <small style={{color: 'var(--text-gray)', fontSize: '0.8rem', marginTop: 4, display: 'block'}}>Must be 001 - 089</small>
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" className="form-control" placeholder="••••••••" />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" className="form-control" placeholder="••••••••" />
          </div>
          
          <Link to="/student/dashboard" className="btn btn-primary" style={{width: '100%', textAlign: 'center', marginTop: 12}}>Create Account</Link>
          <div style={{textAlign: 'center', marginTop: 24, fontSize: '0.9rem'}}>
            Already have an account? <Link to="/login" style={{color: 'var(--primary-navy)', fontWeight: 600}}>Sign In</Link>
          </div>
        </div>
      </div>
    </PageWrapper>
  )
}

const StudentDashboard = () => (
  <PageWrapper>
    <h1 style={{marginBottom: 24}}>Welcome, John!</h1>
    
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24}}>
      <motion.div whileHover={{ y: -5 }} className="card" style={{borderLeft: '4px solid var(--success-green)'}}>
        <h3 style={{color: 'var(--primary-navy)', marginBottom: 8}}>CSC 101 - Intro to Programming</h3>
        <p style={{color: 'var(--text-gray)', marginBottom: 16}}>Location: Science Block A • Ongoing Now</p>
        <Link to="/student/check-in" className="btn btn-primary">Check-in Now</Link>
      </motion.div>
      
      <motion.div whileHover={{ y: -5 }} className="card">
        <h3 style={{color: 'var(--primary-navy)', marginBottom: 16}}>Profile Status</h3>
        <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8}}>
          <CheckCircle color="var(--success-green)" size={20} />
          <span>Biometric Registered</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <CheckCircle color="var(--success-green)" size={20} />
          <span>Matric Verified</span>
        </div>
      </motion.div>
    </div>
  </PageWrapper>
);



// --- APP ROUTER ---
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      
      {/* Student Routes */}
      <Route path="/student" element={<DashboardLayout />}>
        <Route path="dashboard" element={<StudentDashboard />} />
        <Route path="check-in" element={<CheckInPage />} />
        <Route path="history" element={<StudentHistoryPage />} />
        <Route path="profile" element={<StudentProfilePage />} />
      </Route>

      {/* Lecturer Routes */}
      <Route path="/lecturer" element={<DashboardLayout />}>
        <Route path="dashboard" element={<ImportedLecturerDashboard />} />
        <Route path="courses" element={<ManageCoursesPage />} />
        <Route path="session/live/:id" element={<LiveSessionPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="sessions" element={<ManageCoursesPage />} />
        <Route path="students" element={<ReportsPage />} />
        <Route path="profile" element={<StudentProfilePage />} />
      </Route>
    </Routes>
  );
}
