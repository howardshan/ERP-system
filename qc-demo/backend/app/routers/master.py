from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import AppUser, DryingLocation, InspectionTemplate, ProductSku
from app.schemas import LocationOut, SkuOut, TemplateOut

router = APIRouter(prefix="/master", tags=["master"])


@router.get("/skus", response_model=list[SkuOut])
def list_skus(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    return db.query(ProductSku).order_by(ProductSku.code).all()


@router.get("/locations", response_model=list[LocationOut])
def list_locations(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    return db.query(DryingLocation).order_by(DryingLocation.code).all()


@router.get("/templates/{sku_id}", response_model=list[TemplateOut])
def list_templates(
    sku_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    return db.query(InspectionTemplate).filter(InspectionTemplate.sku_id == sku_id).all()
