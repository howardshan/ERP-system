from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.db import get_db
from app.helpers import sub_lot_to_out
from app.models import AppUser, DryingSubLot, InspectionRecord, InspectionTemplate, ProductionLot, QualityEvent
from app.schemas import DryingSubLotOut, InspectionOut, InspectionSubmit
from app.services.inspection_judge import judge_aw
from app.services.state_machine import can_transition, next_status

router = APIRouter(tags=["inspections"])


@router.get("/pending-inspections", response_model=list[DryingSubLotOut])
def pending_inspections(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    subs = (
        db.query(DryingSubLot)
        .options(joinedload(DryingSubLot.location))
        .filter(DryingSubLot.status.in_(["pending", "inspecting"]))
        .order_by(DryingSubLot.out_time.asc().nulls_last())
        .all()
    )
    return [sub_lot_to_out(s, db) for s in subs]


@router.get("/inspections/template-for-sub-lot/{sub_lot_id}")
def template_for_sub_lot(
    sub_lot_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    sub = db.get(DryingSubLot, sub_lot_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")
    lot = db.get(ProductionLot, sub.production_lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Production lot not found")
    templates = db.query(InspectionTemplate).filter(InspectionTemplate.sku_id == lot.sku_id).all()
    if not templates:
        raise HTTPException(status_code=404, detail="No inspection template for SKU")
    t = templates[0]
    return {
        "sub_lot": sub_lot_to_out(
            db.query(DryingSubLot).options(joinedload(DryingSubLot.location)).get(sub_lot_id),
            db,
        ),
        "template": {
            "id": str(t.id),
            "item_name": t.item_name,
            "lower_limit": float(t.lower_limit),
            "upper_limit": float(t.upper_limit),
        },
    }


@router.post("/inspections", response_model=InspectionOut)
def submit_inspection(
    body: InspectionSubmit,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("qc", "manager"))],
):
    sub = db.query(DryingSubLot).filter(DryingSubLot.id == body.drying_sub_lot_id).with_for_update().first()
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")

    if sub.status == "pending":
        if not can_transition(sub.status, "start_inspection"):
            raise HTTPException(status_code=400, detail="Cannot start inspection")
        sub.status = next_status(sub.status, "start_inspection")

    if sub.status != "inspecting":
        raise HTTPException(status_code=400, detail=f"Sub-lot not inspectable (status={sub.status})")

    lot = db.get(ProductionLot, sub.production_lot_id)
    templates = db.query(InspectionTemplate).filter(InspectionTemplate.sku_id == lot.sku_id).all()
    if not templates:
        raise HTTPException(status_code=400, detail="No template")
    t = templates[0]
    lo, hi = float(t.lower_limit), float(t.upper_limit)
    result = judge_aw(body.aw, lo, hi)

    record = InspectionRecord(
        drying_sub_lot_id=sub.id,
        inspector_id=user.id,
        values_json={"aw": body.aw},
        result=result,
    )
    db.add(record)

    if result == "pass":
        sub.status = next_status("inspecting", "submit_pass")
        event_type = "inspection_passed"
    else:
        sub.status = next_status("inspecting", "submit_fail")
        event_type = "inspection_failed_hold"

    sub.updated_at = datetime.now(timezone.utc)
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type=event_type,
            payload={"aw": body.aw, "result": result, "limits": [lo, hi]},
            actor_id=user.id,
        )
    )
    db.commit()
    db.refresh(record)

    return InspectionOut(
        id=record.id,
        drying_sub_lot_id=record.drying_sub_lot_id,
        result=record.result,
        values_json=record.values_json,
        submitted_at=record.submitted_at,
        new_status=sub.status,
    )
