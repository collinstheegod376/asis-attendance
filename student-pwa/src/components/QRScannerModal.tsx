import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, AlertCircle } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannerReady, setScannerReady] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isRunningRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    const qrRegionId = 'adun-qr-scanner-region';
    const scanner = new Html5Qrcode(qrRegionId);
    scannerRef.current = scanner;

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
    };

    scanner
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          // Success
          if (isRunningRef.current) {
            isRunningRef.current = false;
            scanner
              .stop()
              .then(() => {
                onScanSuccess(decodedText);
              })
              .catch(() => {
                onScanSuccess(decodedText);
              });
          }
        },
        () => {
          // Frame scan error (ignored, continuous scanning)
        }
      )
      .then(() => {
        isRunningRef.current = true;
        setScannerReady(true);
      })
      .catch((err) => {
        console.error('QR scanner start error:', err);
        setScanError('Unable to open camera for scanning. Please check camera permissions.');
      });

    return () => {
      if (scannerRef.current && isRunningRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current?.clear();
          })
          .catch(() => {});
      }
    };
  }, [isOpen, onScanSuccess]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Scan Classroom QR</h3>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewport */}
        <div className="p-4 flex flex-col items-center">
          <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black flex items-center justify-center">
            <div id="adun-qr-scanner-region" className="w-full h-full" />
            {!scannerReady && !scanError && (
              <div className="absolute inset-0 flex items-center justify-center text-white text-xs">
                Starting scanner...
              </div>
            )}
          </div>

          {scanError && (
            <div className="mt-3 p-3 bg-red-50 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{scanError}</span>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-500 text-center">
            Point camera at the attendance code displayed by your lecturer on the projector.
          </p>
        </div>
      </div>
    </div>
  );
};
