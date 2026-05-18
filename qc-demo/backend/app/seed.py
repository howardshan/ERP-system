"""Demo seed data per QC模块Demo开发计划书 §7."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models import (
    AppUser,
    Disposition,
    DryingLocation,
    DryingSubLot,
    InspectionRecord,
    InspectionTemplate,
    ProductSku,
    ProductionLot,
    QualityEvent,
)

LOCATIONS = [
    ("DRY-A-TOP", "烘干房 A - 上层"),
    ("DRY-A-MID", "烘干房 A - 中层"),
    ("DRY-A-BOT", "烘干房 A - 下层"),
    ("DRY-B-TOP", "烘干房 B - 上层"),
    ("DRY-B-MID", "烘干房 B - 中层"),
    ("DRY-B-BOT", "烘干房 B - 下层"),
]

SKUS = [
    ("SKU-CHICKEN", "鸡肉条（烘干后）", 0.65, 0.75, 240),
    ("SKU-COWHID", "牛皮卷（烘干后）", 0.55, 0.68, 360),
]


def clear_qc_tables(db: Session) -> None:
    db.execute(
        text(
            """
            TRUNCATE TABLE
                qc.quality_event,
                qc.disposition,
                qc.inspection_record,
                qc.drying_sub_lot,
                qc.production_lot,
                qc.inspection_template,
                qc.drying_location,
                qc.product_sku,
                qc.app_user
            RESTART IDENTITY CASCADE
            """
        )
    )


def run_seed(db: Session) -> dict[str, int]:
    clear_qc_tables(db)

    users = [
        AppUser(username="qc", password_hash=hash_password("demo123"), role="qc", display_name="QC 员"),
        AppUser(
            username="manager",
            password_hash=hash_password("demo123"),
            role="manager",
            display_name="质量管理员",
        ),
    ]
    db.add_all(users)
    db.flush()

    locations = [DryingLocation(code=c, display_name=n) for c, n in LOCATIONS]
    db.add_all(locations)
    db.flush()
    loc_by_code = {loc.code: loc for loc in locations}

    skus = []
    templates = []
    for code, name, lo, hi, dry_mins in SKUS:
        sku = ProductSku(code=code, name=name, standard_drying_minutes=dry_mins)
        db.add(sku)
        db.flush()
        skus.append(sku)
        templates.append(
            InspectionTemplate(
                sku_id=sku.id,
                item_name="水活 Aw",
                unit=None,
                lower_limit=lo,
                upper_limit=hi,
            )
        )
    db.add_all(templates)
    db.flush()

    chicken = skus[0]
    now = datetime.now(timezone.utc)

    lot1 = ProductionLot(
        lot_number="DEMO-20250517-01",
        lot_barcode="LOT-DEMO-001",
        work_order_barcode="WO-DEMO-001",
        sku_id=chicken.id,
    )
    lot2 = ProductionLot(
        lot_number="DEMO-20250516-02",
        lot_barcode="LOT-DEMO-002",
        work_order_barcode="WO-DEMO-002",
        sku_id=skus[1].id,
    )
    db.add_all([lot1, lot2])
    db.flush()

    sub_lots = [
        DryingSubLot(
            production_lot_id=lot1.id,
            sub_lot_code="LOT-DEMO-001-D01",
            location_id=loc_by_code["DRY-A-TOP"].id,
            in_time=now - timedelta(hours=4),
            out_time=now - timedelta(hours=1),
            status="pending",
        ),
        DryingSubLot(
            production_lot_id=lot1.id,
            sub_lot_code="LOT-DEMO-001-D02",
            location_id=loc_by_code["DRY-A-MID"].id,
            in_time=now - timedelta(hours=3),
            out_time=now - timedelta(minutes=30),
            status="pending",
        ),
        DryingSubLot(
            production_lot_id=lot2.id,
            sub_lot_code="LOT-DEMO-002-D01",
            location_id=loc_by_code["DRY-B-TOP"].id,
            in_time=now - timedelta(days=1, hours=5),
            out_time=now - timedelta(days=1, hours=2),
            status="passed",
        ),
    ]
    db.add_all(sub_lots)
    db.flush()

    db.add(
        InspectionRecord(
            drying_sub_lot_id=sub_lots[2].id,
            inspector_id=users[0].id,
            values_json={"aw": 0.62},
            result="pass",
            submitted_at=now - timedelta(days=1),
        )
    )

    db.commit()
    return {
        "users": 2,
        "skus": len(skus),
        "locations": len(locations),
        "production_lots": 2,
        "drying_sub_lots": 3,
    }
