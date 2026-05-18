import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

SCHEMA = {"schema": "qc"}


class AppUser(Base):
    __tablename__ = "app_user"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class ProductSku(Base):
    __tablename__ = "product_sku"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    standard_drying_minutes: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))

    templates: Mapped[list["InspectionTemplate"]] = relationship(back_populates="sku")


class InspectionTemplate(Base):
    __tablename__ = "inspection_template"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.product_sku.id"), nullable=False)
    item_name: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(Text)
    lower_limit: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    upper_limit: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))

    sku: Mapped["ProductSku"] = relationship(back_populates="templates")


class DryingLocation(Base):
    __tablename__ = "drying_location"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class ProductionLot(Base):
    __tablename__ = "production_lot"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lot_number: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    lot_barcode: Mapped[str] = mapped_column(Text, nullable=False)
    work_order_barcode: Mapped[str] = mapped_column(Text, nullable=False)
    sku_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.product_sku.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))

    sku: Mapped["ProductSku"] = relationship()
    sub_lots: Mapped[list["DryingSubLot"]] = relationship(back_populates="production_lot")


class DryingSubLot(Base):
    __tablename__ = "drying_sub_lot"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    production_lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc.production_lot.id"), nullable=False
    )
    sub_lot_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.drying_location.id"))
    in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    out_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))

    production_lot: Mapped["ProductionLot"] = relationship(back_populates="sub_lots")
    location: Mapped["DryingLocation | None"] = relationship()


class InspectionRecord(Base):
    __tablename__ = "inspection_record"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drying_sub_lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc.drying_sub_lot.id"), nullable=False
    )
    inspector_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.app_user.id"))
    values_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class Disposition(Base):
    __tablename__ = "disposition"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drying_sub_lot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc.drying_sub_lot.id"), nullable=False
    )
    type: Mapped[str] = mapped_column(Text, nullable=False)
    remark: Mapped[str | None] = mapped_column(Text)
    operator_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.app_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class QualityEvent(Base):
    __tablename__ = "quality_event"
    __table_args__ = SCHEMA

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    drying_sub_lot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qc.drying_sub_lot.id")
    )
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("qc.app_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
