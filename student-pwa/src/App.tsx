import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

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

// Offline Guard
import { OfflineGuard } from './components/OfflineGuard';

export function App() {
  return (
    <BrowserRouter>
      <OfflineGuard>
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
