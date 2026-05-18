from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, require_role
from app.db import get_db
from app.helpers import sub_lot_to_out
from app.models import AppUser, Disposition, DryingSubLot, InspectionRecord, ProductSku, ProductionLot, QualityEvent
from app.schemas import DashboardSummary, DispositionCreate, DispositionOut, TodayInspectionItem
from app.services.state_machine import can_transition, next_status

router = APIRouter(tags=["dashboard"])


def _today_inspection_item(rec: InspectionRecord, db: Session) -> TodayInspectionItem:
    sub = db.get(DryingSubLot, rec.drying_sub_lot_id)
    sku_name = None
    code = "—"
    status = "unknown"
    if sub:
        code = sub.sub_lot_code
        status = sub.status
        lot = db.get(ProductionLot, sub.production_lot_id)
        if lot:
            sku = db.get(ProductSku, lot.sku_id)
            if sku:
                sku_name = sku.name
    aw_val = rec.values_json.get("aw") if rec.values_json else None
    return TodayInspectionItem(
        sub_lot_id=rec.drying_sub_lot_id,
        sub_lot_code=code,
        sku_name=sku_name,
        aw=float(aw_val) if aw_val is not None else None,
        result=rec.result,
        submitted_at=rec.submitted_at,
        status=status,
    )


@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[AppUser, Depends(get_current_user)],
):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    pending = (
        db.query(DryingSubLot)
        .options(joinedload(DryingSubLot.location))
        .filter(DryingSubLot.status.in_(["pending", "inspecting"]))
        .order_by(DryingSubLot.out_time.asc().nulls_last())
        .all()
    )
    holds = (
        db.query(DryingSubLot)
        .options(joinedload(DryingSubLot.location))
        .filter(DryingSubLot.status == "hold")
        .order_by(DryingSubLot.updated_at.desc())
        .all()
    )

    longest = None
    now = datetime.now(timezone.utc)
    for s in pending:
        if s.out_time:
            ot = s.out_time.replace(tzinfo=timezone.utc) if s.out_time.tzinfo is None else s.out_time
            mins = (now - ot).total_seconds() / 60
            if longest is None or mins > longest:
                longest = mins

    today_records = (
        db.query(InspectionRecord)
        .filter(InspectionRecord.submitted_at >= today_start)
        .order_by(InspectionRecord.submitted_at.desc())
        .all()
    )
    passed_records = [r for r in today_records if r.result == "pass"]
    failed_records = [r for r in today_records if r.result == "fail"]
    passed = len(passed_records)
    failed = len(failed_records)
    total = passed + failed
    rate = round(passed / total * 100, 1) if total else None

    return DashboardSummary(
        pending_count=len(pending),
        longest_wait_minutes=round(longest, 1) if longest is not None else None,
        hold_count=len(holds),
        today_passed=passed,
        today_failed=failed,
        pass_rate=rate,
        pending_items=[sub_lot_to_out(s, db) for s in pending],
        holds=[sub_lot_to_out(h, db) for h in holds],
        today_passed_items=[_today_inspection_item(r, db) for r in passed_records],
        today_failed_items=[_today_inspection_item(r, db) for r in failed_records],
    )


@router.post("/dispositions", response_model=DispositionOut)
def create_disposition(
    body: DispositionCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[AppUser, Depends(require_role("manager"))],
):
    sub = db.query(DryingSubLot).filter(DryingSubLot.id == body.drying_sub_lot_id).with_for_update().first()
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-lot not found")

    if sub.status == "hold":
        if not can_transition(sub.status, "start_disposition"):
            raise HTTPException(status_code=400, detail="Cannot start disposition")
        sub.status = next_status(sub.status, "start_disposition")

    if sub.status != "disposing":
        raise HTTPException(status_code=400, detail=f"Sub-lot not in disposition flow (status={sub.status})")

    disp = Disposition(
        drying_sub_lot_id=sub.id,
        type=body.type,
        remark=body.remark,
        operator_id=user.id,
    )
    db.add(disp)
    sub.status = next_status("disposing", "complete_disposition")
    sub.updated_at = datetime.now(timezone.utc)
    db.add(
        QualityEvent(
            drying_sub_lot_id=sub.id,
            event_type="disposition_completed",
            payload={"type": body.type, "remark": body.remark},
            actor_id=user.id,
        )
    )
    db.commit()
    db.refresh(disp)

    return DispositionOut(
        id=disp.id,
        drying_sub_lot_id=disp.drying_sub_lot_id,
        type=disp.type,
        remark=disp.remark,
        created_at=disp.created_at,
        new_status=sub.status,
    )
