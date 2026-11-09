/**
 * Resolves the student PWA origin URL for QR code generation and join link sharing.
 */
export function getStudentPwaUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_STUDENT_PWA_URL;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    // Local development: Admin portal runs on 5174, student PWA on 5173
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return origin.replace(':5174', ':5173');
    }

    // Deployed production: If current host is admin portal on Vercel, route to student portal
    if (origin.includes('admin-portal-zeta-six.vercel.app')) {
      return 'https://asis-attendance-dzf1.vercel.app';
    }

    // Subdomain pattern: admin.attendance.adun.edu.ng -> attendance.adun.edu.ng
    if (origin.includes('admin.')) {
      return origin.replace('admin.', '');
    }

    return 'https://asis-attendance-dzf1.vercel.app';
  }

  return 'https://asis-attendance-dzf1.vercel.app';
}
