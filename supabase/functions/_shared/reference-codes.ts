/**
 * ADUN Attendance System - Unified Reference Code Taxonomy
 * Standardized across all Edge Functions, Database Triggers, and Stored Procedures.
 *
 * Taxonomy:
 *   BIND-200 = Bound successfully / Valid matching device
 *   BIND-201 = New device / Fingerprint mismatch detected
 *   BIND-202 = Device already bound to another active student
 *   BIND-203 = Same-session device collision (proxy attempt detected)
 *   BIND-204 = Cookie missing or unrecognized device
 *   BIND-205 = Incognito / Private browsing mode detected
 *   BIND-206 = Administrative device reset performed
 */

export const REFERENCE_CODES = {
  BIND_200: 'BIND-200',
  BIND_201: 'BIND-201',
  BIND_202: 'BIND-202',
  BIND_203: 'BIND-203',
  BIND_204: 'BIND-204',
  BIND_205: 'BIND-205',
  BIND_206: 'BIND-206',
} as const;

export type ReferenceCode = (typeof REFERENCE_CODES)[keyof typeof REFERENCE_CODES];

export type DeviceAction = 'OK' | 'CONTACT_ADMIN' | 'OPEN_NORMAL_BROWSER';

export interface DeviceCheckFailureResponse {
  action: DeviceAction;
  reason: string;
  reference_code: ReferenceCode | string;
}
