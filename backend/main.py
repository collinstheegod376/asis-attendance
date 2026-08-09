from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import auth, attendance

app = FastAPI(title="Attendance System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(attendance.router)

@app.get("/")
def read_root():
    return {"message": "Welcome to the Attendance System API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
