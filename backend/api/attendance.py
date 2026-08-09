from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.security import verify_supabase_token, supabase_anon, supabase_admin
import numpy as np
import base64
import io
import face_recognition

router = APIRouter(prefix="/attendance", tags=["attendance"])

class GeofenceSetupRequest(BaseModel):
    course_id: str
    coordinates: list[list[float]] # List of [lng, lat] pairs forming a polygon

class CheckInRequest(BaseModel):
    course_id: str
    session_id: str
    lat: float
    lng: float
    image_base64: str

@router.post("/setup-geofence")
def setup_geofence(request: GeofenceSetupRequest, user = Depends(verify_supabase_token)):
    # Verify the user is a lecturer for this course
    role = user.user_metadata.get("role")
    if role != "lecturer" and role != "admin":
        raise HTTPException(status_code=403, detail="Only lecturers can setup geofence")
    
    # Format to PostGIS POLYGON string e.g. POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))
    # Close the polygon if not closed
    coords = request.coordinates
    if coords[0] != coords[-1]:
       coords.append(coords[0])
    
    polygon_str = "POLYGON((" + ", ".join([f"{c[0]} {c[1]}" for c in coords]) + "))"

    # Update course using admin client or if RLS allows using anon client
    response = supabase_anon.table("courses").update({
        "geofence_polygon": polygon_str
    }).eq("id", request.course_id).execute()

    return {"message": "Geofence updated", "data": response.data}


@router.post("/check-in")
def check_in(request: CheckInRequest, user = Depends(verify_supabase_token)):
    student_id = user.id

    # 1. Check Geofence using Postgres function (Remote Procedure Call)
    # The function check_geofence takes UUID course_id, lng, lat
    rpc_res = supabase_anon.rpc(
        "check_geofence", 
        {"p_course_id": request.course_id, "p_lng": request.lng, "p_lat": request.lat}
    ).execute()
    is_inside = rpc_res.data
    
    # 2. Extract face encoding from the incoming base64 image
    try:
        # Determine if there's a data URI scheme header and separate it
        header, encoded = request.image_base64.split(",", 1) if "," in request.image_base64 else ("", request.image_base64)
        image_bytes = base64.b64decode(encoded)
        image = face_recognition.load_image_file(io.BytesIO(image_bytes))
        face_locations = face_recognition.face_locations(image)
        
        if not face_locations:
            raise HTTPException(status_code=400, detail="No face detected in the image.")
            
        incoming_embedding = face_recognition.face_encodings(image, face_locations)[0].tolist()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process face image: {str(e)}")

    # 3. Check face cosine similarity using database RPC
    distance_res = supabase_anon.rpc(
        "match_face_embedding",
        {"p_user_id": student_id, "p_embedding": incoming_embedding}
    ).execute()
    
    if distance_res.data is None:
        raise HTTPException(status_code=400, detail="Student has no registered face embedding.")

    cosine_distance = distance_res.data
    
    # Matching thresholds (e.g. cosine distance < 0.4 implies match)
    FACE_MATCH_THRESHOLD = 0.40
    face_match = cosine_distance < FACE_MATCH_THRESHOLD

    # Assess status
    if not is_inside:
        status = "GEOFENCE_FAILED"
    elif not face_match:
        status = "FACE_FAILED"
    else:
        status = "COMPLETED"

    # Insert attendance record
    try:
        att_res = supabase_anon.table("attendance").insert({
            "session_id": request.session_id,
            "student_id": student_id,
            "gps_point": f"POINT({request.lng} {request.lat})",
            "face_match_score": float(cosine_distance),
            "status": status
        }).execute()
        return {"message": "Check-in attempted", "status": status, "data": att_res.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
