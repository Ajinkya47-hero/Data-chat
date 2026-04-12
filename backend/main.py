import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load env vars first
load_dotenv()

from routers import upload, preview, chat, insights, workspace, analysis

app = FastAPI(title="DataChat MVP API")

# CORS: allow frontend origins (localhost for dev, production domain for deploy)
_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router, prefix="/upload", tags=["upload"])
app.include_router(preview.router, prefix="/dataset", tags=["dataset"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(insights.router, prefix="/insights", tags=["insights"])
app.include_router(workspace.router, prefix="/workspace", tags=["workspace"])
app.include_router(analysis.router, prefix="/analysis", tags=["analysis"])

@app.get("/health")
def health():
    return {"status": "ok"}
