from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.db import get_db
from app.models import AppUser, InspectionTemplate, ProductSku
from app.schemas import SkuCreate, SkuOut, SkuUpdate, TemplateOut

router = APIRouter(prefix="/products", tags=["products"])


def sku_to_out(sku: ProductSku) -> SkuOut:
    templates = [
        TemplateOut(
            id=t.id,
            sku_id=t.sku_id,
            item_name=t.item_name,
            unit=t.unit,
            lower_limit=float(t.lower_limit),
            upper_limit=float(t.upper_limit),
        )
        for t in sku.templates
    ]
    return SkuOut(
        id=sku.id,
        code=sku.code,
        name=sku.name,
        standard_drying_minutes=sku.standard_drying_minutes,
        templates=templates,
    )


@router.get("", response_model=list[SkuOut])
def list_products(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    skus = (
        db.query(ProductSku)
        .options(joinedload(ProductSku.templates))
        .order_by(ProductSku.code)
        .all()
    )
    return [sku_to_out(s) for s in skus]


@router.get("/{sku_id}", response_model=SkuOut)
def get_product(
    sku_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    sku = (
        db.query(ProductSku)
        .options(joinedload(ProductSku.templates))
        .filter(ProductSku.id == sku_id)
        .first()
    )
    if not sku:
        raise HTTPException(status_code=404, detail="Product not found")
    return sku_to_out(sku)


@router.post("", response_model=SkuOut)
def create_product(
    body: SkuCreate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    if db.query(ProductSku).filter(ProductSku.code == body.code).first():
        raise HTTPException(status_code=400, detail="SKU code already exists")
    if body.template.lower_limit > body.template.upper_limit:
        raise HTTPException(status_code=400, detail="下限不能大于上限")

    sku = ProductSku(
        code=body.code,
        name=body.name,
        standard_drying_minutes=body.standard_drying_minutes,
    )
    db.add(sku)
    db.flush()
    db.add(
        InspectionTemplate(
            sku_id=sku.id,
            item_name=body.template.item_name,
            unit=body.template.unit,
            lower_limit=body.template.lower_limit,
            upper_limit=body.template.upper_limit,
        )
    )
    db.commit()
    sku = db.query(ProductSku).options(joinedload(ProductSku.templates)).get(sku.id)
    return sku_to_out(sku)


@router.put("/{sku_id}", response_model=SkuOut)
def update_product(
    sku_id: UUID,
    body: SkuUpdate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    sku = (
        db.query(ProductSku)
        .options(joinedload(ProductSku.templates))
        .filter(ProductSku.id == sku_id)
        .first()
    )
    if not sku:
        raise HTTPException(status_code=404, detail="Product not found")

    if body.code and body.code != sku.code:
        if db.query(ProductSku).filter(ProductSku.code == body.code).first():
            raise HTTPException(status_code=400, detail="SKU code already exists")
        sku.code = body.code
    if body.name is not None:
        sku.name = body.name
    if body.standard_drying_minutes is not None:
        sku.standard_drying_minutes = body.standard_drying_minutes

    if body.template:
        if body.template.lower_limit > body.template.upper_limit:
            raise HTTPException(status_code=400, detail="下限不能大于上限")
        if sku.templates:
            t = sku.templates[0]
            t.item_name = body.template.item_name
            t.unit = body.template.unit
            t.lower_limit = body.template.lower_limit
            t.upper_limit = body.template.upper_limit
        else:
            db.add(
                InspectionTemplate(
                    sku_id=sku.id,
                    item_name=body.template.item_name,
                    unit=body.template.unit,
                    lower_limit=body.template.lower_limit,
                    upper_limit=body.template.upper_limit,
                )
            )

    db.commit()
    sku = db.query(ProductSku).options(joinedload(ProductSku.templates)).get(sku.id)
    return sku_to_out(sku)


@router.delete("/{sku_id}")
def delete_product(
    sku_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    sku = db.get(ProductSku, sku_id)
    if not sku:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(sku)
    db.commit()
    return {"ok": True}
