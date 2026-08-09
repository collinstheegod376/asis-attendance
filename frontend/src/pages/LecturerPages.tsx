import React from 'react';
import { motion } from 'framer-motion';
import { Activity, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

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

export const LecturerDashboard = () => (
  <PageWrapper>
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
       <h1>Mission Control</h1>
       <div style={{display: 'flex', gap: 12}}>
          <Link to="/lecturer/courses" className="btn btn-secondary">+ Create New Course</Link>
          <Link to="/lecturer/sessions" className="btn btn-primary">+ Start New Session</Link>
       </div>
    </div>
    
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24, marginBottom: 32}}>
      <div className="card text-center" style={{textAlign: 'center'}}>
        <h2 style={{fontSize: '2.5rem', color: 'var(--primary-navy)'}}>12</h2>
        <p style={{color: 'var(--text-gray)', fontWeight: 500}}>Total Courses</p>
      </div>
      <div className="card text-center" style={{textAlign: 'center'}}>
        <h2 style={{fontSize: '2.5rem', color: 'var(--success-green)'}}>2</h2>
        <p style={{color: 'var(--text-gray)', fontWeight: 500}}>Active Sessions</p>
      </div>
      <div className="card text-center" style={{textAlign: 'center'}}>
        <h2 style={{fontSize: '2.5rem', color: 'var(--primary-navy)'}}>145</h2>
        <p style={{color: 'var(--text-gray)', fontWeight: 500}}>Students Enrolled</p>
      </div>
      <div className="card text-center" style={{textAlign: 'center'}}>
        <h2 style={{fontSize: '2.5rem', color: 'var(--secondary-gold)'}}>68%</h2>
        <p style={{color: 'var(--text-gray)', fontWeight: 500}}>Today's Attendance</p>
      </div>
    </div>

    {/* Live Banner */}
    <div style={{background: '#d4edda', border: '1px solid #c3e6cb', padding: 20, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
        <div style={{color: 'var(--success-green)', fontWeight: 600, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8}}>
            <Activity className="animate-pulse" />
            🔴 LIVE: CSC 101 is currently open. 12 students checked in.
        </div>
        <Link to="/lecturer/session/live/123" className="btn" style={{background: 'var(--success-green)', color: 'white'}}>Go to Live Session</Link>
    </div>
    
    <div className="card" style={{borderLeft: '4px solid var(--warning-yellow)'}}>
        <h3 style={{color: 'var(--primary-navy)', marginBottom: 16}}>Live Recent Check-in Feed</h3>
        <ul style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          <li style={{padding: 12, background: 'var(--background-light)', borderRadius: 8, display: 'flex', justifyContent: 'space-between'}}>
             <span>John Doe (ADUN/FS/COM/25/012) checked in for CSC 101</span>
             <span style={{color: 'var(--text-gray)'}}>Just now</span>
          </li>
          <li style={{padding: 12, background: 'var(--background-light)', borderRadius: 8, display: 'flex', justifyContent: 'space-between'}}>
             <span>Sarah Conor (ADUN/FS/COM/25/031) checked in for CSC 101</span>
             <span style={{color: 'var(--text-gray)'}}>2 mins ago</span>
          </li>
        </ul>
    </div>
  </PageWrapper>
);

export const ManageCoursesPage = () => {
    return (
        <PageWrapper>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
                <h1>Manage Courses</h1>
                <button className="btn btn-primary">+ Create Course</button>
            </div>
            
            <div className="card">
                <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left'}}>
                    <thead>
                        <tr style={{borderBottom: '2px solid #eee'}}>
                            <th style={{padding: 12}}>S/N</th>
                            <th style={{padding: 12}}>Course Code</th>
                            <th style={{padding: 12}}>Title</th>
                            <th style={{padding: 12}}>Geofence</th>
                            <th style={{padding: 12}}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>1</td>
                            <td style={{padding: 12}}>CSC 101</td>
                            <td style={{padding: 12}}>Intro to Programming</td>
                            <td style={{padding: 12, color: 'var(--success-green)'}}><CheckCircle size={16} className="inline mr-1"/> Mapped</td>
                            <td style={{padding: 12}}><button style={{color: 'var(--primary-navy)', fontWeight: 600}}>Edit Map</button></td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>2</td>
                            <td style={{padding: 12}}>CSC 202</td>
                            <td style={{padding: 12}}>Data Structures</td>
                            <td style={{padding: 12, color: 'var(--danger-red)'}}><XCircle size={16} className="inline mr-1"/> Not Mapped</td>
                            <td style={{padding: 12}}><button style={{color: 'var(--primary-navy)', fontWeight: 600}}>Edit Map</button></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Instruction block for map styling mapping layout */}
            <div className="card" style={{marginTop: 32}}>
                <h3 style={{marginBottom: 16}}>Geofencing Editor Preview</h3>
                <p style={{color: 'var(--text-gray)', marginBottom: 12}}>Click on the map to drop pins and draw a polygon around your lecture venue.</p>
                <div style={{height: 300, background: '#e0e0e0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <div style={{color: '#666'}}>Leaflet.js Map Instance Placeholder</div>
                </div>
            </div>
        </PageWrapper>
    );
};

export const LiveSessionPage = () => {
    return (
        <PageWrapper>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24}}>
                <div>
                    <h1 style={{color: 'var(--danger-red)', display: 'flex', alignItems: 'center', gap: 12}}><Activity className="animate-pulse" /> LIVE: CSC 101</h1>
                    <p style={{color: 'var(--text-gray)'}}>Intro to Programming • Ends in 45 minutes</p>
                </div>
                <div style={{display: 'flex', gap: 12}}>
                    <button className="btn btn-secondary">Refresh QR</button>
                    <button className="btn" style={{background: 'var(--danger-red)', color: 'white'}}>End Session</button>
                </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
                <div className="card" style={{height: 600, padding: 0, overflow: 'hidden', position: 'relative'}}>
                    <div style={{position: 'absolute', top: 10, left: 10, background: 'white', padding: '4px 12px', borderRadius: 20, zIndex: 10, fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.1)'}}>
                        Geofence Map
                    </div>
                    {/* Placeholder for map showing polygon and dropping student pins overlay */}
                    <div style={{height: '100%', width: '100%', background: '#c8dbf0', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                         [Live Student GPS Droppins]
                    </div>
                </div>

                <div className="card" style={{height: 600, overflowY: 'auto'}}>
                    <input type="text" className="form-control" placeholder="Search student..." style={{marginBottom: 16}} />
                    
                    <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem'}}>
                        <thead>
                            <tr style={{borderBottom: '2px solid #eee'}}>
                                <th style={{padding: 8}}>Student</th>
                                <th style={{padding: 8}}>GPS</th>
                                <th style={{padding: 8}}>Face</th>
                                <th style={{padding: 8}}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{borderBottom: '1px solid #eee'}}>
                                <td style={{padding: 8}}>ADUN/.../012<br/><strong>John Doe</strong></td>
                                <td style={{padding: 8, color: 'var(--success-green)'}}>Inside</td>
                                <td style={{padding: 8, color: 'var(--success-green)'}}>94%</td>
                                <td style={{padding: 8}}><span style={{background: '#d4edda', color: 'var(--success-green)', padding: '2px 8px', borderRadius: 12, fontWeight: 600}}>COMPLETED</span></td>
                            </tr>
                            <tr style={{borderBottom: '1px solid #eee'}}>
                                <td style={{padding: 8}}>ADUN/.../045<br/><strong>Jane Smith</strong></td>
                                <td style={{padding: 8, color: 'var(--danger-red)'}}>Outside</td>
                                <td style={{padding: 8, color: 'var(--danger-red)'}}>42%</td>
                                <td style={{padding: 8}}><span style={{background: '#f8d7da', color: 'var(--danger-red)', padding: '2px 8px', borderRadius: 12, fontWeight: 600}}>FAILED</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </PageWrapper>
    );
};

export const ReportsPage = () => {
    return (
        <PageWrapper>
            <h1 style={{marginBottom: 24}}>Attendance Reports</h1>
            <div className="card" style={{marginBottom: 24, display: 'flex', gap: 16}}>
                <select className="form-control" style={{width: 200}}>
                    <option>CSC 101</option>
                    <option>CSC 202</option>
                </select>
                <input type="date" className="form-control" style={{width: 200}} />
                <button className="btn btn-primary" style={{marginLeft: 'auto'}}>Export CSV</button>
            </div>
            
            <div className="card">
                <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left'}}>
                    <thead>
                        <tr style={{borderBottom: '2px solid #eee'}}>
                            <th style={{padding: 12}}>Matric No</th>
                            <th style={{padding: 12}}>Student Name</th>
                            <th style={{padding: 12}}>Sessions Attended</th>
                            <th style={{padding: 12}}>Percentage</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>ADUN/FS/COM/25/001</td>
                            <td style={{padding: 12}}>John Doe</td>
                            <td style={{padding: 12}}>12 / 14</td>
                            <td style={{padding: 12}}><strong style={{color: 'var(--success-green)'}}>85%</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </PageWrapper>
    );
}
