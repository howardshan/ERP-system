from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
    display_name: str | None = None


class InspectionTemplateInput(BaseModel):
    item_name: str = "水活 Aw"
    unit: str | None = None
    lower_limit: float
    upper_limit: float


class SkuOut(BaseModel):
    id: UUID
    code: str
    name: str
    standard_drying_minutes: int | None = None
    templates: list["TemplateOut"] = []

    model_config = {"from_attributes": True}


class SkuCreate(BaseModel):
    code: str
    name: str
    standard_drying_minutes: int | None = Field(None, ge=1, le=24 * 60)
    template: InspectionTemplateInput


class SkuUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    standard_drying_minutes: int | None = Field(None, ge=1, le=24 * 60)
    template: InspectionTemplateInput | None = None


class TemplateOut(BaseModel):
    id: UUID
    sku_id: UUID
    item_name: str
    unit: str | None
    lower_limit: float
    upper_limit: float

    model_config = {"from_attributes": True}


class LocationOut(BaseModel):
    id: UUID
    code: str
    display_name: str

    model_config = {"from_attributes": True}


class ProductionLotCreate(BaseModel):
    lot_number: str | None = None
    lot_barcode: str
    work_order_barcode: str
    sku_id: UUID


class ProductionLotOut(BaseModel):
    id: UUID
    lot_number: str
    lot_barcode: str
    work_order_barcode: str
    sku_id: UUID
    sku_code: str | None = None
    sku_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DryingSubLotCheckIn(BaseModel):
    production_lot_id: UUID
    sub_lot_code: str | None = None
    location_id: UUID | None = None
    in_time: datetime | None = None


class DryingSubLotCheckOut(BaseModel):
    out_time: datetime | None = None


class DryingSubLotOut(BaseModel):
    id: UUID
    production_lot_id: UUID
    sub_lot_code: str
    location_id: UUID | None
    location_name: str | None = None
    in_time: datetime | None
    out_time: datetime | None
    status: str
    lot_barcode: str | None = None
    sku_name: str | None = None
    wait_minutes: float | None = None
    hold_reason: str | None = None
    hold_aw: float | None = None
    hold_item_name: str | None = None
    hold_lower_limit: float | None = None
    hold_upper_limit: float | None = None
    hold_inspected_at: datetime | None = None

    model_config = {"from_attributes": True}


class InspectionSubmit(BaseModel):
    drying_sub_lot_id: UUID
    aw: float = Field(..., ge=0, le=2)


class InspectionOut(BaseModel):
    id: UUID
    drying_sub_lot_id: UUID
    result: str
    values_json: dict
    submitted_at: datetime
    new_status: str

    model_config = {"from_attributes": True}


class DispositionCreate(BaseModel):
    drying_sub_lot_id: UUID
    type: str = Field(..., pattern="^(rework|grind|scrap|concession)$")
    remark: str | None = None


class DispositionOut(BaseModel):
    id: UUID
    drying_sub_lot_id: UUID
    type: str
    remark: str | None
    created_at: datetime
    new_status: str

    model_config = {"from_attributes": True}


class TodayInspectionItem(BaseModel):
    sub_lot_id: UUID
    sub_lot_code: str
    sku_name: str | None
    aw: float | None
    result: str
    submitted_at: datetime
    status: str
    fail_reason: str | None = None


class DashboardSummary(BaseModel):
    pending_count: int
    longest_wait_minutes: float | None
    hold_count: int
    today_passed: int
    today_failed: int
    pass_rate: float | None
    pending_items: list[DryingSubLotOut]
    holds: list[DryingSubLotOut]
    today_passed_items: list[TodayInspectionItem]
    today_failed_items: list[TodayInspectionItem]


class TraceSubLot(BaseModel):
    sub_lot: DryingSubLotOut
    inspections: list[InspectionOut]
    dispositions: list[DispositionOut]


class QualityEventOut(BaseModel):
    id: UUID
    event_type: str
    payload: dict
    created_at: datetime
    sub_lot_code: str | None = None
    summary: str
    actor_username: str | None = None


class ProductionLotDetail(BaseModel):
    lot: ProductionLotOut
    sub_lots: list[DryingSubLotOut]
    events: list[QualityEventOut]
