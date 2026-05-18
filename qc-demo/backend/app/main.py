from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import check_db_connection
from app.routers import auth_router, dashboard, demo, inspections, lots, master, products

app = FastAPI(title="QC Demo API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(master.router)
app.include_router(products.router)
app.include_router(lots.router)
app.include_router(inspections.router)
app.include_router(dashboard.router)
app.include_router(demo.router)


@app.get("/health")
def health():
    db_ok = check_db_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "unavailable",
        "app_env": settings.app_env,
    }
