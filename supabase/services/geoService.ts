/**
 * ADUN Attendance - Geolocation & Campus Boundary Service
 */
import { haversineDistanceMeters, isPointInPolygon } from '../functions/_shared/geo.ts';
import type { LocationMode } from '../types/database.types.ts';

export interface LocationVerificationInput {
  latitude: number;
  longitude: number;
  accuracyM: number;
  locationMode: LocationMode;
  campusBoundaryGeoJson?: any;
  accuracyThresholdM?: number;
}

export interface LocationVerificationOutput {
  allowed: boolean;
  accuracyValid: boolean;
  insideBoundary: boolean;
  reason?: string;
}

export class GeoService {
  /**
   * Evaluates location against institution rules
   */
  static verifyLocation(input: LocationVerificationInput): LocationVerificationOutput {
    const threshold = input.accuracyThresholdM ?? 50;
    const accuracyValid = input.accuracyM <= threshold;

    let insideBoundary = true;
    if (input.campusBoundaryGeoJson) {
      insideBoundary = isPointInPolygon(input.latitude, input.longitude, input.campusBoundaryGeoJson);
    }

    if (input.locationMode === 'enforce') {
      if (!accuracyValid) {
        return {
          allowed: false,
          accuracyValid: false,
          insideBoundary,
          reason: `Accuracy (${Math.round(input.accuracyM)}m) exceeds threshold (${threshold}m).`,
        };
      }

      if (!insideBoundary) {
        return {
          allowed: false,
          accuracyValid,
          insideBoundary: false,
          reason: 'Current location is outside the authorized Admiralty University campus boundary.',
        };
      }
    }

    // If evidence_only or all checks passed
    return {
      allowed: true,
      accuracyValid,
      insideBoundary,
    };
  }

  static distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return haversineDistanceMeters(lat1, lon1, lat2, lon2);
  }
}
