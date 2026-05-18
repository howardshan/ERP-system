from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.db import get_db
from app.helpers import lot_to_out, sub_lot_to_out
from app.models import (
    AppUser,
    Disposition,
    DryingSubLot,
    InspectionRecord,
    ProductionLot,
    QualityEvent,
)
from app.schemas import (
    DryingSubLotCreate,
    DryingSubLotOut,
    ProductionLotCreate,
    ProductionLotDetail,
    ProductionLotOut,
)
from app.services.state_machine import can_transition, next_status

router = APIRouter(tags=["lots"])


@router.get("/production-lots", response_model=list[ProductionLotOut])
def list_production_lots(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    lots = db.query(ProductionLot).order_by(ProductionLot.created_at.desc()).all()
    return [lot_to_out(lot, db) for lot in lots]


@router.post("/production-lots", response_model=ProductionLotOut)
def create_production_lot(
    body: ProductionLotCreate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("qc", "manager"))],
):
    lot_number = body.lot_number or body.lot_barcode
    existing = db.query(ProductionLot).filter(ProductionLot.lot_number == lot_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Lot number already exists")
    lot = ProductionLot(
        lot_number=lot_number,
        lot_barcode=body.lot_barcode,
        work_order_barcode=body.work_order_barcode,
        sku_id=body.sku_id,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot_to_out(lot, db)


@router.get("/production-lots/{lot_id}", response_model=ProductionLotDetail)
def get_production_lot_detail(
    lot_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    lot = db.get(ProductionLot, lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")
    subs = (
        db.query(DryingSubLot)
        .options(joinedload(DryingSubLot.location))
        .filter(DryingSubLot.production_lot_id == lot_id)
        .order_by(DryingSubLot.created_at)
        .all()
    )
    sub_ids = [s.id for s in subs]
    events = []
    if sub_ids:
        qevents = (
            db.query(QualityEvent)
            .filter(QualityEvent.drying_sub_lot_id.in_(sub_ids))
            .order_by(QualityEvent.created_at.desc())
            .limit(50)
            .all()
        )
        for ev in qevents:
            events.append(
                {
                    "id": str(ev.id),
                    "event_type": ev.event_type,
                    "payload": ev.payload,
                    "created_at": ev.created_at.isoformat(),
                }
            )
    return ProductionLotDetail(
        lot=lot_to_out(lot, db),
        sub_lots=[sub_lot_to_out(s, db) for s in subs],
        events=events,
    )


@router.get("/drying-sub-lots", response_model=list[DryingSubLotOut])
def list_sub_lots(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
    production_lot_id: UUID | None = None,
):
    q = db.query(DryingSubLot).options(joinedload(DryingSubLot.location))
    if production_lot_id:
        q = q.filter(DryingSubLot.production_lot_id == production_lot_id)
    subs = q.order_by(DryingSubLot.created_at.desc()).all()
    return [sub_lot_to_out(s, db) for s in subs]


@router.post("/drying-sub-lots", response_model=DryingSubLotOut)
def create_sub_lot(
    body: DryingSubLotCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("qc", "manager"))],
):
    lot = db.get(ProductionLot, body.production_lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")

    existing_count = (
        db.query(DryingSubLot).filter(DryingSubLot.production_lot_id == body.production_lot_id).count()
    )
    seq = existing_count + 1
    code = body.sub_lot_code or f"{lot.lot_barcode}-D{seq:02d}"

    if db.query(DryingSubLot).filter(DryingSubLot.sub_lot_code == code).first():
        raise HTTPException(status_code=400, detail="Sub-lot code already exists")

    status = "pending" if body.register_pending else "pending"
    sub = DryingSubLot(
        production_lot_id=body.production_lot_id,
        sub_lot_code=code,
        location_id=body.location_id,
        in_time=body.in_time,
        out_time=body.out_time,
        status=status,
    )
    db.add(sub)
    db.flush()
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type="sub_lot_registered",
            payload={"sub_lot_code": code, "status": status},
            actor_id=user.id,
        )
    )
    db.commit()
    db.refresh(sub)
    sub = db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub.id)
    return sub_lot_to_out(sub, db)


@router.get("/drying-sub-lots/{sub_lot_id}", response_model=DryingSubLotOut)
def get_sub_lot(
    sub_lot_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    sub = db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub_lot_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")
    return sub_lot_to_out(sub, db)
