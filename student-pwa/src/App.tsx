import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

// Pages
import { LandingPage } from './pages/LandingPage';
import { JoinTokenPage } from './pages/JoinTokenPage';
import { AttendIdentityPage } from './pages/AttendIdentityPage';
import { AttendLocationPage } from './pages/AttendLocationPage';
import { AttendSelfiePage } from './pages/AttendSelfiePage';
import { AttendVideoPage } from './pages/AttendVideoPage';
import { AttendConfirmationPage } from './pages/AttendConfirmationPage';
import { ExpiredPage } from './pages/ExpiredPage';
import { InvalidPage } from './pages/InvalidPage';
import { NotStartedPage } from './pages/NotStartedPage';
import { ClosedPage } from './pages/ClosedPage';
import { AlreadySignedPage } from './pages/AlreadySignedPage';
import { NotEnrolledPage } from './pages/NotEnrolledPage';
import { UnsupportedPage } from './pages/UnsupportedPage';
import { OfflinePage } from './pages/OfflinePage';
import { PrivacyPage } from './pages/PrivacyPage';

// Dedicated Option 2 Block Pages
import { IncognitoBlockPage } from './pages/block/IncognitoBlockPage';
import { NewDeviceBlockPage } from './pages/block/NewDeviceBlockPage';
import { DeviceInUseBlockPage } from './pages/block/DeviceInUseBlockPage';
import { SharedDeviceBlockPage } from './pages/block/SharedDeviceBlockPage';
import { ContactAdminBlockPage } from './pages/block/ContactAdminBlockPage';

// Offline Guard & Heartbeat
import { OfflineGuard } from './components/OfflineGuard';
import { heartbeatManager } from './lib/heartbeatManager';

export function App() {
  const [outsideFenceBanner, setOutsideFenceBanner] = useState(false);

  useEffect(() => {
    const unsubscribe = heartbeatManager.subscribe((status) => {
      setOutsideFenceBanner(status.active && status.insideFence === false);
    });
    return unsubscribe;
  }, []);

  return (
    <BrowserRouter>
      <OfflineGuard>
        {outsideFenceBanner && (
          <div
            role="status"
            aria-live="polite"
            className="sticky top-0 z-50 w-full bg-amber-50 border-b border-amber-200 px-3 py-2 text-amber-900 text-xs font-medium flex items-center justify-center gap-2 shadow-xs"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>You appear to have left the classroom. Your attendance may be marked partial.</span>
          </div>
        )}
        <Routes>
          {/* Public landing */}
          <Route path="/" element={<LandingPage />} />

          {/* Server token validation entry */}
          <Route path="/join/:token" element={<JoinTokenPage />} />

          {/* Attendance flow steps */}
          <Route path="/attend/identity" element={<AttendIdentityPage />} />
          <Route path="/attend/location" element={<AttendLocationPage />} />
          <Route path="/attend/selfie" element={<AttendSelfiePage />} />
          <Route path="/attend/video" element={<AttendVideoPage />} />
          <Route path="/attend/confirmation" element={<AttendConfirmationPage />} />

          {/* Dedicated Option 2 Strict Device Binding Block screens */}
          <Route path="/block/incognito" element={<IncognitoBlockPage />} />
          <Route path="/block/new-device" element={<NewDeviceBlockPage />} />
          <Route path="/block/device-in-use" element={<DeviceInUseBlockPage />} />
          <Route path="/block/shared-device" element={<SharedDeviceBlockPage />} />
          <Route path="/block/contact-admin" element={<ContactAdminBlockPage />} />

          {/* Status & Error routes */}
          <Route path="/expired" element={<ExpiredPage />} />
          <Route path="/invalid" element={<InvalidPage />} />
          <Route path="/not-started" element={<NotStartedPage />} />
          <Route path="/closed" element={<ClosedPage />} />
          <Route path="/already-signed" element={<AlreadySignedPage />} />
          <Route path="/not-enrolled" element={<NotEnrolledPage />} />
          <Route path="/unsupported" element={<UnsupportedPage />} />
          <Route path="/offline" element={<OfflinePage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OfflineGuard>
    </BrowserRouter>
  );
}

export default App;
