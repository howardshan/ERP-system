from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import DryingSubLot, ProductionLot, ProductSku


def sub_lot_to_out(sub: DryingSubLot, db: Session) -> dict:
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
    return {
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
    }


def lot_to_out(lot: ProductionLot, db: Session) -> dict:
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
    }
