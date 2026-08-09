from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field, validator
import re
from core.security import supabase_anon, verify_supabase_token

router = APIRouter(prefix="/auth", tags=["auth"])

class SignUpRequest(BaseModel):
    name: str
    matric_number: str
    password: str
    role: str = "student"
    
    @validator('matric_number')
    def validate_matric(cls, v):
        pattern = r"^ADUN/FS/COM/25/(00[1-9]|0[1-8][0-9]|089)$"
        if not re.match(pattern, v):
            raise ValueError("Invalid matric number format.")
        return v

class SignInRequest(BaseModel):
    email: str = None
    matric_number: str = None
    password: str

@router.post("/signup")
def sign_up(request: SignUpRequest):
    # Construct an email from the matric number automatically
    email = f"{request.matric_number.replace('/', '_')}@adun.edu.ng".lower()
    try:
        res = supabase_anon.auth.sign_up({
            "email": email,
            "password": request.password,
            "options": {
                "data": {
                    "name": request.name,
                    "matric_number": request.matric_number,
                    "role": request.role
                }
            }
        })
        return {"message": "User registered successfully", "user": res.user}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login")
def login(request: SignInRequest):
    # Construct the corresponding email if matric provided, else use email
    if request.email:
        email = request.email.lower()
    elif request.matric_number:
        email = f"{request.matric_number.replace('/', '_')}@adun.edu.ng".lower()
    else:
         raise HTTPException(status_code=400, detail="Must provide email or matric_number")
         
    try:
        res = supabase_anon.auth.sign_in_with_password({
            "email": email,
            "password": request.password
        })
        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": res.user
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid credentials or login failed")

@router.get("/me")
def get_me(user = Depends(verify_supabase_token)):
    """
    Test endpoint to verify JWT extraction and decoding functionality
    """
    return {"user": user}
