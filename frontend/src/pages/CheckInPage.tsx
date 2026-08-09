import React, { useEffect, useRef, useState } from 'react';
import { Camera, MapPin, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

const CheckInPage = () => {
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'fetching' | 'success' | 'error'>('idle');
  const [gpsData, setGpsData] = useState<{lat: number, lng: number} | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState('');
  
  const [photoCaptured, setPhotoCaptured] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{success: boolean, msg: string} | null>(null);

  // Read session ID from URL. For demo, we default to something if none given.
  const queryParameters = new URLSearchParams(window.location.search);
  const sessionId = queryParameters.get("session_id") || "00000000-0000-0000-0000-000000000000";

  useEffect(() => {
    // 1. Get GPS details instantly on mount
    fetchGPS();
    
    // 2. Start Camera feed instantly
    startCamera();

    return () => {
      // Cleanup camera stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const fetchGPS = () => {
    setGpsStatus('fetching');
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsErrorMsg('Geolocation is not supported by your browser');
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsData({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setGpsStatus('success');
      },
      (error) => {
        setGpsStatus('error');
        setGpsErrorMsg(error.message);
      },
      { timeout: 10000 }
    );
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreamActive(true);
      }
    } catch (err) {
      console.error("Error accessing webcam:", err);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0, 320, 240);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
        setPhotoCaptured(dataUrl);
      }
    }
  };

  const resetPhoto = () => {
    setPhotoCaptured(null);
  };

  const submitCheckIn = async () => {
    if (!gpsData || !photoCaptured) return;
    
    setLoading(true);
    setResult(null);
    try {
      // Setup payload matching the backend format
      const payload = {
        session_id: sessionId,
        course_id: "00000000-0000-0000-0000-000000000000", // Would be fetched from actual session
        lat: gpsData.lat,
        lng: gpsData.lng,
        image_base64: photoCaptured
      };

      const response = await fetch("http://localhost:8000/attendance/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // "Authorization": `Bearer ${token}` // Need to pass active session token here
        },
        body: JSON.stringify(payload)
      });
      
      const resData = await response.json();
      
      if (response.ok) {
        if (resData.status === "COMPLETED") {
          setResult({ success: true, msg: "✅ Attendance Checked In Successfully!" });
        } else if (resData.status === "GEOFENCE_FAILED") {
          setResult({ success: false, msg: "❌ ERROR: You are outside the course geofence." });
        } else if (resData.status === "FACE_FAILED") {
          setResult({ success: false, msg: "❌ ERROR: Face mismatch. Are you sure you are the registered student?" });
        } else {
           setResult({ success: false, msg: "❌ ERROR: Unknown status returned." });
        }
      } else {
        setResult({ success: false, msg: resData.detail || "Server error occurred" });
      }
    } catch (error: any) {
      setResult({ success: false, msg: error.message || "Failed to contact verification server." });
    }
    setLoading(false);
  };

  const canCheckIn = gpsStatus === 'success' && photoCaptured !== null;

  return (
    <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ color: 'var(--primary-navy)', marginBottom: 8 }}>Session Check-In</h2>
      <p style={{ color: 'var(--text-gray)', marginBottom: 24, fontSize: '0.9rem' }}>
        Please verify your location and identity to complete attendance for CSC 101.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, marginBottom: 32 }}>
        
        {/* GPS Verification Card */}
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
             <MapPin size={20} color="var(--primary-navy)" />
             1. Location Verification
          </h3>
          
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            {gpsStatus === 'idle' || gpsStatus === 'fetching' ? (
              <div style={{ color: 'var(--text-gray)' }}>
                <Loader2 className="animate-spin inline mr-2" style={{ animation: 'spin 1s linear infinite' }} /> 
                Fetching GPS Lock...
              </div>
            ) : gpsStatus === 'error' ? (
              <div style={{ color: 'var(--danger-red)' }}>
                <AlertTriangle className="inline mr-2" />
                {gpsErrorMsg}
                <button onClick={fetchGPS} style={{ display: 'block', margin: '12px auto 0', padding: '6px 12px', background: '#eee', borderRadius: 4 }}>Retry</button>
              </div>
            ) : (
              <div style={{ color: 'var(--success-green)', fontWeight: 600 }}>
                <CheckCircle className="inline mr-2" />
                GPS Lock Acquired
                <div style={{ fontSize: '0.75rem', color: 'var(--text-gray)', marginTop: 8, fontWeight: 400 }}>
                  Lat: {gpsData?.lat.toFixed(5)}, Lng: {gpsData?.lng.toFixed(5)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Camera Verification Card */}
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
             <Camera size={20} color="var(--primary-navy)" />
             2. Identity Verification
          </h3>

          <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
            <video 
               ref={videoRef} 
               autoPlay 
               playsInline
               style={{ width: '100%', height: '100%', objectFit: 'cover', display: photoCaptured ? 'none' : 'block' }} 
            />
            {photoCaptured && (
               <img src={photoCaptured} alt="Captured face" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            <canvas ref={canvasRef} width="320" height="240" style={{ display: 'none' }}></canvas>
          </div>

          <div style={{ marginTop: 12, textAlign: 'center' }}>
            {!photoCaptured ? (
              <button onClick={capturePhoto} disabled={!streamActive} className="btn" style={{ background: 'var(--primary-navy)', color: 'white', padding: '8px 16px', borderRadius: 4 }}>
                Capture Selfie
              </button>
            ) : (
              <button onClick={resetPhoto} className="btn" style={{ background: '#eee', color: 'var(--text-dark)', padding: '8px 16px', borderRadius: 4 }}>
                Retake Photo
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Action Area */}
      <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '24px 0' }}/>
      
      <div style={{ textAlign: 'center' }}>
        <button 
           className="btn btn-primary" 
           style={{ width: '100%', maxWidth: 300, fontSize: '1.1rem', padding: '16px', opacity: canCheckIn && !loading ? 1 : 0.5 }}
           disabled={!canCheckIn || loading}
           onClick={submitCheckIn}
        >
          {loading ? (
             <><Loader2 className="inline mr-2" style={{ animation: 'spin 1s linear infinite' }} /> Verifying...</>
          ) : (
             "VERIFY & CHECK-IN"
          )}
        </button>
      </div>

      {/* Result Area */}
      {result && (
        <div style={{ 
            marginTop: 24, padding: 16, borderRadius: 8, textAlign: 'center', fontWeight: 600,
            background: result.success ? '#d4edda' : '#f8d7da',
            color: result.success ? 'var(--success-green)' : 'var(--danger-red)',
            border: `1px solid ${result.success ? '#c3e6cb' : '#f5c6cb'}`
        }}>
          {result.msg}
        </div>
      )}

    </div>
  );
};

export default CheckInPage;
