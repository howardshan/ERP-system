from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.seed import run_seed

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/seed")
def seed_database(db: Annotated[Session, Depends(get_db)]):
    if settings.app_env != "demo":
        raise HTTPException(status_code=403, detail="Seed only allowed when APP_ENV=demo")
    try:
        counts = run_seed(db)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Seed failed: {exc}") from exc
    return {"ok": True, "counts": counts}
