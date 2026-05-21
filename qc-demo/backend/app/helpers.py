from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import DryingSubLot, InspectionRecord, InspectionTemplate, ProductionLot, ProductSku
from app.services.inspection_judge import format_fail_reason


def sub_lot_to_out(sub: DryingSubLot, db: Session, *, include_hold_detail: bool = False) -> dict:
    lot = db.get(ProductionLot, sub.production_lot_id)
    sku_name = None
    lot_barcode = None
    if lot:
        lot_barcode = lot.lot_barcode
        sku = db.get(ProductSku, lot.sku_id)
        if sku:
            sku_name = sku.name
    wait_minutes = None
    if sub.out_time and sub.status == "pending":
        delta = datetime.now(timezone.utc) - sub.out_time.replace(tzinfo=timezone.utc)
        wait_minutes = round(delta.total_seconds() / 60, 1)
    location_name = sub.location.display_name if sub.location else None
    out = {
        "id": sub.id,
        "production_lot_id": sub.production_lot_id,
        "sub_lot_code": sub.sub_lot_code,
        "location_id": sub.location_id,
        "location_name": location_name,
        "in_time": sub.in_time,
        "out_time": sub.out_time,
        "status": sub.status,
        "lot_barcode": lot_barcode,
        "sku_name": sku_name,
        "wait_minutes": wait_minutes,
        "hold_reason": None,
        "hold_aw": None,
        "hold_item_name": None,
        "hold_lower_limit": None,
        "hold_upper_limit": None,
        "hold_inspected_at": None,
    }
    if include_hold_detail and sub.status == "hold":
        _attach_hold_detail(out, sub, db)
    return out


def _attach_hold_detail(out: dict, sub: DryingSubLot, db: Session) -> None:
    rec = (
        db.query(InspectionRecord)
        .filter(InspectionRecord.drying_sub_lot_id == sub.id, InspectionRecord.result == "fail")
        .order_by(InspectionRecord.submitted_at.desc())
        .first()
    )
    if not rec:
        out["hold_reason"] = "Inspection failed (no inspection record)"
        return

    aw_val = rec.values_json.get("aw") if rec.values_json else None
    item_name = "Water Activity (Aw)"
    lower: float | None = None
    upper: float | None = None
    lot = db.get(ProductionLot, sub.production_lot_id)
    if lot:
        tmpl = db.query(InspectionTemplate).filter(InspectionTemplate.sku_id == lot.sku_id).first()
        if tmpl:
            item_name = tmpl.item_name
            lower = float(tmpl.lower_limit)
            upper = float(tmpl.upper_limit)

    out["hold_inspected_at"] = rec.submitted_at
    if aw_val is not None:
        out["hold_aw"] = float(aw_val)
    out["hold_item_name"] = item_name
    if lower is not None and upper is not None:
        out["hold_lower_limit"] = lower
        out["hold_upper_limit"] = upper
        if aw_val is not None:
            out["hold_reason"] = format_fail_reason(float(aw_val), lower, upper, item_name)
        else:
            out["hold_reason"] = f"Inspection failed ({item_name} reading missing, spec [{lower}, {upper}])"
    elif aw_val is not None:
        out["hold_reason"] = f"Inspection failed ({item_name} {aw_val})"
    else:
        out["hold_reason"] = "Inspection failed (reading missing)"


def empty_sub_lot_counts() -> dict:
    return {
        "total": 0,
        "drying": 0,
        "pending": 0,
        "passed": 0,
        "hold": 0,
        "disposing": 0,
        "closed": 0,
    }


def build_sub_lot_counts(status_rows: list[tuple[str, int]]) -> dict:
    counts = empty_sub_lot_counts()
    for status, n in status_rows:
        counts["total"] += n
        if status == "inspecting":
            counts["pending"] += n
        elif status in counts:
            counts[status] += n
    return counts


def lot_to_out(lot: ProductionLot, db: Session, *, sub_lot_counts: dict | None = None) -> dict:
    sku = db.get(ProductSku, lot.sku_id)
    return {
        "id": lot.id,
        "lot_number": lot.lot_number,
        "lot_barcode": lot.lot_barcode,
        "work_order_barcode": lot.work_order_barcode,
        "sku_id": lot.sku_id,
        "sku_code": sku.code if sku else None,
        "sku_name": sku.name if sku else None,
        "created_at": lot.created_at,
        "sub_lot_counts": sub_lot_counts or empty_sub_lot_counts(),
    }
