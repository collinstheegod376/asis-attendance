import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, AlertTriangle } from 'lucide-react';

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

export const StudentHistoryPage = () => {
    return (
        <PageWrapper>
            <h1 style={{marginBottom: 24}}>Attendance History</h1>
            <div className="card">
                <div style={{display: 'flex', gap: 16, marginBottom: 24}}>
                    <select className="form-control" style={{width: 200, padding: 8}}>
                        <option>All Courses</option>
                        <option>CSC 101</option>
                    </select>
                    <input type="date" className="form-control" style={{width: 200, padding: 8}} />
                </div>

                <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left'}}>
                    <thead>
                        <tr style={{borderBottom: '2px solid #eee'}}>
                            <th style={{padding: 12}}>Date</th>
                            <th style={{padding: 12}}>Course</th>
                            <th style={{padding: 12}}>Time</th>
                            <th style={{padding: 12}}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>2024-10-15</td>
                            <td style={{padding: 12}}>CSC 101</td>
                            <td style={{padding: 12}}>09:05 AM</td>
                            <td style={{padding: 12, color: 'var(--success-green)'}}><CheckCircle size={16} className="inline mr-1"/> Present</td>
                        </tr>
                        <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>2024-10-12</td>
                            <td style={{padding: 12}}>CSC 101</td>
                            <td style={{padding: 12}}>09:00 AM</td>
                            <td style={{padding: 12, color: 'var(--success-green)'}}><CheckCircle size={16} className="inline mr-1"/> Present</td>
                        </tr>
                         <tr style={{borderBottom: '1px solid #eee'}}>
                            <td style={{padding: 12}}>2024-10-09</td>
                            <td style={{padding: 12}}>CSC 101</td>
                            <td style={{padding: 12}}>00:00</td>
                            <td style={{padding: 12, color: 'var(--danger-red)'}}><AlertTriangle size={16} className="inline mr-1"/> Absent</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </PageWrapper>
    );
};

export const StudentProfilePage = () => {
    return (
        <PageWrapper>
            <h1 style={{marginBottom: 24}}>My Profile</h1>
            <div className="card" style={{maxWidth: 600}}>
                <div style={{display: 'flex', gap: 24, alignItems: 'center', marginBottom: 32}}>
                    <div style={{width: 80, height: 80, borderRadius: '50%', background: '#ccc'}}></div>
                    <div>
                        <h2 style={{color: 'var(--primary-navy)'}}>Jane Doe</h2>
                        <p style={{color: 'var(--text-gray)'}}>ADUN/FS/COM/25/001</p>
                    </div>
                </div>

                <div className="form-group">
                    <label>Email Address</label>
                    <input type="email" className="form-control" defaultValue="adun_fs_com_25_001@adun.edu.ng" disabled style={{background: '#f8f9fa'}}/>
                </div>
                
                <div className="form-group">
                    <label>Registered Face Biometric</label>
                    <div style={{display: 'inline-block', padding: '8px 16px', background: '#d4edda', color: 'var(--success-green)', borderRadius: 20, fontWeight: 600}}>
                        <CheckCircle size={16} className="inline mr-2" />
                        Verified Active
                    </div>
                </div>

                <hr style={{margin: '32px 0', borderTop: '1px solid #eee'}} />

                <h3 style={{marginBottom: 16}}>Security</h3>
                <div className="form-group">
                    <label>New Password</label>
                    <input type="password" className="form-control" placeholder="••••••••" />
                </div>
                <button className="btn btn-primary">Update Password</button>
            </div>
        </PageWrapper>
    );
};
