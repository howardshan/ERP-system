from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.db import get_db
from app.helpers import build_sub_lot_counts, empty_sub_lot_counts, lot_to_out, sub_lot_to_out
from app.models import (
    AppUser,
    Disposition,
    DryingSubLot,
    InspectionRecord,
    ProductSku,
    ProductionLot,
    QualityEvent,
)
from app.schemas import (
    DryingSubLotCheckIn,
    DryingSubLotCheckOut,
    DryingSubLotOut,
    DryingSubLotUpdate,
    ProductionLotCreate,
    ProductionLotDetail,
    ProductionLotOut,
    ProductionLotUpdate,
    QualityEventOut,
)
from app.services.event_display import quality_event_summary
from app.services.state_machine import next_status

router = APIRouter(tags=["lots"])

VALID_SUB_LOT_STATUSES = frozenset(
    {"drying", "pending", "inspecting", "passed", "hold", "disposing", "closed"}
)


def _counts_by_lot_id(db: Session, lot_ids: list[UUID]) -> dict[UUID, dict]:
    if not lot_ids:
        return {}
    rows = (
        db.query(DryingSubLot.production_lot_id, DryingSubLot.status, func.count())
        .filter(DryingSubLot.production_lot_id.in_(lot_ids))
        .group_by(DryingSubLot.production_lot_id, DryingSubLot.status)
        .all()
    )
    grouped: dict[UUID, list[tuple[str, int]]] = {}
    for lot_id, status, n in rows:
        grouped.setdefault(lot_id, []).append((status, int(n)))
    return {lid: build_sub_lot_counts(grouped.get(lid, [])) for lid in lot_ids}


@router.get("/production-lots", response_model=list[ProductionLotOut])
def list_production_lots(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    lots = db.query(ProductionLot).order_by(ProductionLot.created_at.desc()).all()
    lot_ids = [lot.id for lot in lots]
    counts_map = _counts_by_lot_id(db, lot_ids)
    return [lot_to_out(lot, db, sub_lot_counts=counts_map.get(lot.id, empty_sub_lot_counts())) for lot in lots]


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


@router.put("/production-lots/{lot_id}", response_model=ProductionLotOut)
def update_production_lot(
    lot_id: UUID,
    body: ProductionLotUpdate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    lot = db.get(ProductionLot, lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")

    if body.lot_number is not None:
        num = body.lot_number.strip()
        if not num:
            raise HTTPException(status_code=400, detail="Lot number cannot be empty")
        other = db.query(ProductionLot).filter(
            ProductionLot.lot_number == num, ProductionLot.id != lot_id
        ).first()
        if other:
            raise HTTPException(status_code=400, detail="Lot number already exists")
        lot.lot_number = num

    if body.lot_barcode is not None:
        bc = body.lot_barcode.strip()
        if not bc:
            raise HTTPException(status_code=400, detail="Lot barcode cannot be empty")
        lot.lot_barcode = bc

    if body.work_order_barcode is not None:
        wo = body.work_order_barcode.strip()
        if not wo:
            raise HTTPException(status_code=400, detail="Work order barcode cannot be empty")
        lot.work_order_barcode = wo

    if body.sku_id is not None:
        if not db.get(ProductSku, body.sku_id):
            raise HTTPException(status_code=400, detail="SKU not found")
        lot.sku_id = body.sku_id

    db.commit()
    db.refresh(lot)
    counts_map = _counts_by_lot_id(db, [lot.id])
    return lot_to_out(lot, db, sub_lot_counts=counts_map.get(lot.id, empty_sub_lot_counts()))


@router.delete("/production-lots/{lot_id}")
def delete_production_lot(
    lot_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    lot = db.get(ProductionLot, lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")
    db.delete(lot)
    db.commit()
    return {"ok": True}


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
    sub_codes = {s.id: s.sub_lot_code for s in subs}
    sub_ids = list(sub_codes.keys())
    events: list[QualityEventOut] = []
    if sub_ids:
        qevents = (
            db.query(QualityEvent)
            .filter(QualityEvent.drying_sub_lot_id.in_(sub_ids))
            .order_by(QualityEvent.created_at.desc())
            .limit(50)
            .all()
        )
        for ev in qevents:
            code = sub_codes.get(ev.drying_sub_lot_id) if ev.drying_sub_lot_id else None
            payload = ev.payload or {}
            events.append(
                QualityEventOut(
                    id=ev.id,
                    event_type=ev.event_type,
                    payload=payload,
                    created_at=ev.created_at,
                    sub_lot_code=code,
                    summary=quality_event_summary(ev.event_type, payload, code),
                )
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


@router.post("/drying-sub-lots/check-in", response_model=DryingSubLotOut)
def check_in_sub_lot(
    body: DryingSubLotCheckIn,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("qc", "manager"))],
):
    lot = db.get(ProductionLot, body.production_lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")

    code = (body.sub_lot_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Sub-lot code is required")

    if db.query(DryingSubLot).filter(DryingSubLot.sub_lot_code == code).first():
        raise HTTPException(status_code=400, detail="Sub-lot code already exists")

    in_time = body.in_time or datetime.now(timezone.utc)
    status = next_status(None, "register_in")
    sub = DryingSubLot(
        production_lot_id=body.production_lot_id,
        sub_lot_code=code,
        location_id=body.location_id,
        in_time=in_time,
        out_time=None,
        status=status,
    )
    db.add(sub)
    db.flush()
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type="check_in",
            payload={"sub_lot_code": code, "in_time": in_time.isoformat()},
            actor_id=user.id,
        )
    )
    db.commit()
    sub = db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub.id)
    return sub_lot_to_out(sub, db)


@router.post("/drying-sub-lots/{sub_lot_id}/check-out", response_model=DryingSubLotOut)
def check_out_sub_lot(
    sub_lot_id: UUID,
    body: DryingSubLotCheckOut,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("qc", "manager"))],
):
    sub = db.query(DryingSubLot).filter(DryingSubLot.id == sub_lot_id).with_for_update().first()
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")
    if sub.status != "drying":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot check out: sub-lot status is {sub.status}",
        )

    out_time = body.out_time or datetime.now(timezone.utc)
    sub.out_time = out_time
    sub.status = next_status("drying", "register_out")
    sub.updated_at = datetime.now(timezone.utc)
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type="check_out",
            payload={"out_time": out_time.isoformat(), "status": sub.status},
            actor_id=user.id,
        )
    )
    db.commit()
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


def _sub_lot_has_audit_trail(db: Session, sub_lot_id: UUID) -> bool:
    if db.query(InspectionRecord).filter(InspectionRecord.drying_sub_lot_id == sub_lot_id).first():
        return True
    if db.query(Disposition).filter(Disposition.drying_sub_lot_id == sub_lot_id).first():
        return True
    return False


@router.put("/drying-sub-lots/{sub_lot_id}", response_model=DryingSubLotOut)
def update_sub_lot(
    sub_lot_id: UUID,
    body: DryingSubLotUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("manager"))],
):
    sub = db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub_lot_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")

    if body.sub_lot_code is not None:
        code = body.sub_lot_code.strip()
        if not code:
            raise HTTPException(status_code=400, detail="Sub-lot code is required")
        other = db.query(DryingSubLot).filter(
            DryingSubLot.sub_lot_code == code, DryingSubLot.id != sub_lot_id
        ).first()
        if other:
            raise HTTPException(status_code=400, detail="Sub-lot code already exists")
        sub.sub_lot_code = code

    if body.location_id is not None:
        sub.location_id = body.location_id

    if body.in_time is not None:
        sub.in_time = body.in_time
    if body.out_time is not None:
        sub.out_time = body.out_time

    if sub.in_time and sub.out_time and sub.out_time < sub.in_time:
        raise HTTPException(status_code=400, detail="Check-out time cannot be before check-in time")

    if body.status is not None:
        if body.status not in VALID_SUB_LOT_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
        sub.status = body.status

    sub.updated_at = datetime.now(timezone.utc)
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type="admin_sub_lot_updated",
            payload={
                "sub_lot_code": sub.sub_lot_code,
                "status": sub.status,
                "in_time": sub.in_time.isoformat() if sub.in_time else None,
                "out_time": sub.out_time.isoformat() if sub.out_time else None,
            },
            actor_id=user.id,
        )
    )
    db.commit()
    sub = db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub.id)
    return sub_lot_to_out(sub, db)


@router.delete("/drying-sub-lots/{sub_lot_id}")
def delete_sub_lot(
    sub_lot_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(require_role("manager"))],
):
    sub = db.get(DryingSubLot, sub_lot_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")
    if _sub_lot_has_audit_trail(db, sub_lot_id):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete sub-lot with inspection or disposition records",
        )
    db.delete(sub)
    db.commit()
    return {"ok": True}
