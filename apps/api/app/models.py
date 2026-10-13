import uuid
from decimal import Decimal
from datetime import date, datetime

from sqlalchemy import JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .core.db import Base


def uid() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uid()
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))
    role: Mapped[str] = mapped_column(String(30), default="MEMBER")
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Role(TimestampMixin, Base):
    __tablename__ = "roles"
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(100), unique=True)
    module: Mapped[str] = mapped_column(String(50), index=True)
    action: Mapped[str] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RolePermission(Base):
    __tablename__ = "role_permissions"
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = uid()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_ip: Mapped[str | None] = mapped_column(String(64))


class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    id: Mapped[uuid.UUID] = uid()
    customer_code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    carrier_name: Mapped[str | None] = mapped_column(String(200))
    carrier_phone: Mapped[str | None] = mapped_column(String(30))
    customer_group: Mapped[str | None] = mapped_column(String(50), default="Khách lẻ")
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OrderGroup(Base):
    __tablename__ = "order_groups"
    id: Mapped[uuid.UUID] = uid()
    group_no: Mapped[str] = mapped_column(String(40), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    id: Mapped[uuid.UUID] = uid()
    order_no: Mapped[str] = mapped_column(String(40), unique=True)
    order_group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("order_groups.id"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"), index=True)
    # NORMAL | CUSTOMER_ORDER (Khách đặt)
    order_type: Mapped[str] = mapped_column(String(30), default="NORMAL")
    created_date: Mapped[date] = mapped_column(Date)
    delivery_date: Mapped[date | None] = mapped_column(Date)
    is_urgent: Mapped[bool] = mapped_column(Boolean, default=False)
    customer_note: Mapped[str | None] = mapped_column(Text)
    staff_note: Mapped[str | None] = mapped_column(Text)
    # NEW | PICKING | PICKED | DEBT_ORDER | SHIPPING | COMPLETED | CANCELLED | DELETED
    status: Mapped[str] = mapped_column(String(30), default="NEW", index=True)
    source_channel: Mapped[str] = mapped_column(String(20), default="ZALO")
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    picked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    billing_status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    invoice_balance_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # The deployed database has a named FK added by migration 0004. It is kept
    # out of ORM metadata to avoid a metadata-level cycle orders <-> batches.
    production_batch_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str | None] = mapped_column(String(100), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)

    customer: Mapped[Customer] = relationship(lazy="joined")
    warehouse: Mapped[Warehouse] = relationship(lazy="joined")
    claimer: Mapped[User | None] = relationship(foreign_keys=[claimed_by], lazy="joined")
    media: Mapped[list["MediaObject"]] = relationship(secondary="order_media", lazy="selectin")


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"
    id: Mapped[uuid.UUID] = uid()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str] = mapped_column(String(30))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = uid()
    product_code: Mapped[str] = mapped_column(String(80), unique=True)
    pattern_code: Mapped[str | None] = mapped_column(String(100), index=True)
    brand: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(300), index=True)
    category: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    notes: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)


class Color(Base):
    __tablename__ = "colors"
    id: Mapped[uuid.UUID] = uid()
    color_code: Mapped[str] = mapped_column(String(80), unique=True)
    canonical_name: Mapped[str] = mapped_column(String(150), index=True)
    aliases: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")


class ProductVariant(TimestampMixin, Base):
    __tablename__ = "product_variants"
    __table_args__ = (UniqueConstraint("product_id", "color_id", "size", name="uq_product_variant_dimensions"),)
    id: Mapped[uuid.UUID] = uid()
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    internal_code: Mapped[str] = mapped_column(String(100), unique=True)
    sales_code: Mapped[str | None] = mapped_column(String(100), index=True)
    color_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("colors.id", ondelete="RESTRICT"), index=True)
    size: Mapped[str] = mapped_column(String(30))
    display_name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    version: Mapped[int] = mapped_column(Integer, default=1)

    product: Mapped[Product] = relationship(lazy="joined")
    color: Mapped[Color | None] = relationship(lazy="joined")


class WarehouseLocation(Base):
    __tablename__ = "warehouse_locations"
    __table_args__ = (UniqueConstraint("warehouse_id", "code", name="uq_warehouse_location_code"),)
    id: Mapped[uuid.UUID] = uid()
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    code: Mapped[str] = mapped_column(String(80))
    display_name: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class OrderItem(TimestampMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "line_no", "revision_no", name="uq_order_item_line_revision"),
        CheckConstraint("quantity > 0", name="ck_order_item_quantity_positive"),
        CheckConstraint("unit_price_amount >= 0", name="ck_order_item_price_nonnegative"),
        CheckConstraint("line_total_amount >= 0", name="ck_order_item_total_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    product_variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"), index=True)
    product_name_snapshot: Mapped[str] = mapped_column(String(300))
    sales_code_snapshot: Mapped[str | None] = mapped_column(String(100))
    internal_code_snapshot: Mapped[str | None] = mapped_column(String(100))
    color_snapshot: Mapped[str | None] = mapped_column(String(150))
    size_snapshot: Mapped[str | None] = mapped_column(String(30))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    line_total_amount: Mapped[int] = mapped_column(BigInteger)
    sale_type: Mapped[str | None] = mapped_column(String(50))
    product_image_url_snapshot: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    revision_no: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    variant: Mapped[ProductVariant | None] = relationship(lazy="joined")
    warehouse: Mapped[Warehouse] = relationship(lazy="joined")


class OrderItemRevision(Base):
    __tablename__ = "order_item_revisions"
    __table_args__ = (UniqueConstraint("order_id", "revision_no", name="uq_order_item_revision"),)
    id: Mapped[uuid.UUID] = uid()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer)
    items_snapshot: Mapped[list] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryBalance(Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (
        UniqueConstraint("variant_id", "warehouse_id", "location_id", name="uq_inventory_balance_scope"),
        CheckConstraint("on_hand >= 0", name="ck_inventory_on_hand_nonnegative"),
        CheckConstraint("reserved >= 0", name="ck_inventory_reserved_nonnegative"),
        CheckConstraint("reserved <= on_hand", name="ck_inventory_reserved_lte_on_hand"),
    )
    id: Mapped[uuid.UUID] = uid()
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"), index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), index=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("warehouse_locations.id", ondelete="RESTRICT"))
    on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    reserved: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    available: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    pending_finish: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    cut_separated: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    defective: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    variant: Mapped[ProductVariant] = relationship(lazy="joined")
    warehouse: Mapped[Warehouse] = relationship(lazy="joined")


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"
    id: Mapped[uuid.UUID] = uid()
    transaction_no: Mapped[str] = mapped_column(String(80), unique=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    transaction_type: Mapped[str] = mapped_column(String(50), index=True)
    reference_type: Mapped[str | None] = mapped_column(String(50))
    reference_id: Mapped[uuid.UUID | None] = mapped_column()
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("warehouse_locations.id", ondelete="RESTRICT"))
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    reservation_delta: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("inventory_transactions.id"))
    idempotency_key: Mapped[str | None] = mapped_column(String(100))


class InventoryReservation(Base):
    __tablename__ = "inventory_reservations"
    id: Mapped[uuid.UUID] = uid()
    reservation_no: Mapped[str] = mapped_column(String(80), unique=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)


class InventoryReservationLine(Base):
    __tablename__ = "inventory_reservation_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_reservation_line_quantity_positive"),)
    id: Mapped[uuid.UUID] = uid()
    reservation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_reservations.id", ondelete="RESTRICT"), index=True)
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id", ondelete="RESTRICT"))
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("warehouse_locations.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = uid()
    entity_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    action: Mapped[str] = mapped_column(String(80))
    module: Mapped[str | None] = mapped_column(String(80))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    request_id: Mapped[str | None] = mapped_column(String(100), index=True)
    before_data: Mapped[dict | list | None] = mapped_column(JSON)
    after_data: Mapped[dict | list | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DebtLedgerEntry(Base):
    """Nguồn sự thật công nợ: số dư = SUM(amount_delta)."""

    __tablename__ = "debt_ledger_entries"
    id: Mapped[uuid.UUID] = uid()
    party_type: Mapped[str] = mapped_column(String(20), default="CUSTOMER")
    party_id: Mapped[uuid.UUID] = mapped_column(index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    entry_type: Mapped[str] = mapped_column(String(30))
    amount_delta: Mapped[int] = mapped_column(BigInteger)
    reference_type: Mapped[str | None] = mapped_column(String(30))
    reference_id: Mapped[uuid.UUID | None] = mapped_column()
    description: Mapped[str | None] = mapped_column(Text)
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("debt_ledger_entries.id"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invoice(TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("subtotal_amount >= 0", name="ck_invoice_subtotal_nonnegative"),
        CheckConstraint("surcharge_amount >= 0", name="ck_invoice_surcharge_nonnegative"),
        CheckConstraint("return_credit_amount >= 0", name="ck_invoice_return_credit_nonnegative"),
        CheckConstraint("paid_amount >= 0", name="ck_invoice_paid_nonnegative"),
        CheckConstraint("balance_amount >= 0", name="ck_invoice_balance_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    invoice_no: Mapped[str] = mapped_column(String(80), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="SENT", index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    subtotal_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    surcharge_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    return_credit_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    debt_before_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    debt_after_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    note: Mapped[str | None] = mapped_column(Text)
    template_version: Mapped[str] = mapped_column(String(30), default="1")
    snapshot: Mapped[dict] = mapped_column(JSON)
    captured_invoice_media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_objects.id", ondelete="SET NULL"))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    void_idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)


class InvoiceCapture(Base):
    """Bản chụp ảnh hóa đơn tạm, gắn với nhóm đơn của một khách trước khi invoice tồn tại."""

    __tablename__ = "invoice_captures"
    id: Mapped[uuid.UUID] = uid()
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    order_ids: Mapped[list] = mapped_column(JSON)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_objects.id", ondelete="CASCADE"))
    captured_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InvoiceOrder(Base):
    __tablename__ = "invoice_orders"
    __table_args__ = (UniqueConstraint("order_id", name="uq_invoice_order_order"),)
    id: Mapped[uuid.UUID] = uid()
    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_payment_amount_positive"),)
    id: Mapped[uuid.UUID] = uid()
    payment_no: Mapped[str] = mapped_column(String(80), unique=True)
    party_type: Mapped[str] = mapped_column(String(30), default="CUSTOMER")
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    workshop_id: Mapped[uuid.UUID | None] = mapped_column()
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    amount: Mapped[int] = mapped_column(BigInteger)
    method: Mapped[str] = mapped_column(String(30))
    direction: Mapped[str] = mapped_column(String(20), default="RECEIPT")
    received_or_paid_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="POSTED")
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    __table_args__ = (
        UniqueConstraint("payment_id", "target_type", "target_id", name="uq_payment_allocation_target"),
        CheckConstraint("allocated_amount > 0", name="ck_payment_allocation_positive"),
    )
    id: Mapped[uuid.UUID] = uid()
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id", ondelete="RESTRICT"), index=True)
    target_type: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    allocated_amount: Mapped[int] = mapped_column(BigInteger)


class PartyDebtBalance(Base):
    __tablename__ = "party_debt_balances"
    __table_args__ = (UniqueConstraint("party_type", "party_id", name="uq_party_debt_balance"),)
    id: Mapped[uuid.UUID] = uid()
    party_type: Mapped[str] = mapped_column(String(30))
    party_id: Mapped[uuid.UUID] = mapped_column(index=True)
    opening: Mapped[int] = mapped_column(BigInteger, default=0)
    debit: Mapped[int] = mapped_column(BigInteger, default=0)
    credit: Mapped[int] = mapped_column(BigInteger, default=0)
    current: Mapped[int] = mapped_column(BigInteger, default=0)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    version: Mapped[int] = mapped_column(Integer, default=1)


class ReturnRecord(TimestampMixin, Base):
    __tablename__ = "returns"
    __table_args__ = (CheckConstraint("total_credit_amount >= 0", name="ck_return_credit_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    return_no: Mapped[str] = mapped_column(String(80), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(30), default="NEW", index=True)
    total_credit_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    restock_posted: Mapped[bool] = mapped_column(Boolean, default=False)
    credit_posted: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approval_idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    cancel_idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_return_item_quantity_positive"),
        CheckConstraint("unit_credit_amount >= 0", name="ck_return_item_credit_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    return_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("returns.id", ondelete="RESTRICT"), index=True)
    product_variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    description_snapshot: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    unit_credit_amount: Mapped[int] = mapped_column(BigInteger)
    line_credit_amount: Mapped[int] = mapped_column(BigInteger)
    condition: Mapped[str | None] = mapped_column(String(80))
    restock: Mapped[bool] = mapped_column(Boolean, default=True)


class Workshop(TimestampMixin, Base):
    __tablename__ = "workshops"
    id: Mapped[uuid.UUID] = uid()
    workshop_code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(250), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    notes: Mapped[str | None] = mapped_column(Text)


class CuttingTeam(TimestampMixin, Base):
    __tablename__ = "cutting_teams"
    id: Mapped[uuid.UUID] = uid()
    team_code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(250), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    default_unit_price_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class FabricType(TimestampMixin, Base):
    __tablename__ = "fabric_types"
    id: Mapped[uuid.UUID] = uid()
    code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    notes: Mapped[str | None] = mapped_column(Text)


class PatternPrice(TimestampMixin, Base):
    __tablename__ = "pattern_prices"
    __table_args__ = (CheckConstraint("unit_price_amount >= 0", name="ck_pattern_price_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    pattern_code: Mapped[str] = mapped_column(String(100), index=True)
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class WorkshopPatternPrice(TimestampMixin, Base):
    __tablename__ = "workshop_pattern_prices"
    __table_args__ = (CheckConstraint("unit_price_amount >= 0", name="ck_workshop_pattern_price_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    pattern_code: Mapped[str] = mapped_column(String(100), index=True)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"), index=True)
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    valid_from: Mapped[date] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class ProductionBatch(TimestampMixin, Base):
    __tablename__ = "production_batches"
    __table_args__ = (
        CheckConstraint("planned_quantity > 0", name="ck_production_batch_planned_positive"),
        CheckConstraint("delivered_quantity >= 0", name="ck_production_batch_delivered_nonnegative"),
        CheckConstraint("remaining_quantity >= 0", name="ck_production_batch_remaining_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    batch_no: Mapped[str] = mapped_column(String(80), unique=True)
    cut_date: Mapped[date] = mapped_column(Date)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"), index=True)
    cutting_team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cutting_teams.id", ondelete="RESTRICT"), index=True)
    pattern_code: Mapped[str] = mapped_column(String(100), index=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    product_name_snapshot: Mapped[str] = mapped_column(String(300))
    size_expression: Mapped[str | None] = mapped_column(Text)
    ratio_expression: Mapped[str | None] = mapped_column(Text)
    layer_expression: Mapped[str] = mapped_column(Text)
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    delivered_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    remaining_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    imported_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    expected_delivery_date: Mapped[date | None] = mapped_column(Date)
    batch_type: Mapped[str] = mapped_column(String(30))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    synced_order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), unique=True)
    workshop_unit_price_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    workshop_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    production_status: Mapped[str] = mapped_column(String(40), default="CUTTING_INCOMPLETE", index=True)
    receipt_status: Mapped[str] = mapped_column(String(40), default="NOT_RECEIVED", index=True)
    settlement_status: Mapped[str] = mapped_column(String(40), default="UNPAID", index=True)
    workshop_settlement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workshop_settlements.id"))
    cutting_settlement_id: Mapped[uuid.UUID | None] = mapped_column()
    planned_warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    fabric_type_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("fabric_types.id", ondelete="RESTRICT"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)


class ProductionBatchMedia(Base):
    """Ảnh rập/sản phẩm gắn với mâm sản xuất; nhiều ảnh cho một mâm, nhiều mâm dùng chung một ảnh."""

    __tablename__ = "production_batch_media"
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="CASCADE"), primary_key=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_objects.id", ondelete="CASCADE"), primary_key=True)


class ProductionBatchSizePlan(Base):
    __tablename__ = "production_batch_size_plans"
    __table_args__ = (
        UniqueConstraint("batch_id", "color_id", "size", "variant_code", name="uq_batch_size_plan"),
        CheckConstraint("planned_quantity >= 0", name="ck_batch_size_planned_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"), index=True)
    color_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("colors.id", ondelete="RESTRICT"))
    variant_code: Mapped[str | None] = mapped_column(String(80))
    size: Mapped[str] = mapped_column(String(30))
    layers: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    ratio: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)
    product_variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    planned_warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    notes: Mapped[str | None] = mapped_column(Text)


class ProductionReceipt(TimestampMixin, Base):
    __tablename__ = "production_receipts"
    id: Mapped[uuid.UUID] = uid()
    receipt_no: Mapped[str] = mapped_column(String(80), unique=True)
    receipt_date: Mapped[date] = mapped_column(Date)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"), index=True)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"))
    color_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("colors.id", ondelete="RESTRICT"))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"))
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    actual_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    difference_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    status: Mapped[str] = mapped_column(String(30), default="POSTED")
    receiver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    inventory_receipt_id: Mapped[uuid.UUID | None] = mapped_column()
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class ProductionReceiptLine(Base):
    __tablename__ = "production_receipt_lines"
    id: Mapped[uuid.UUID] = uid()
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_receipts.id", ondelete="RESTRICT"), index=True)
    batch_size_plan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("production_batch_size_plans.id", ondelete="RESTRICT"))
    product_variant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_variants.id", ondelete="RESTRICT"))
    planned_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    previously_received: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    received_now: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    total_received: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    remaining_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    difference_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    imported_to_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class WorkshopSettlement(TimestampMixin, Base):
    __tablename__ = "workshop_settlements"
    id: Mapped[uuid.UUID] = uid()
    settlement_no: Mapped[str] = mapped_column(String(80), unique=True)
    settlement_date: Mapped[date] = mapped_column(Date)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"), index=True)
    total_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    total_amount: Mapped[int] = mapped_column(BigInteger)
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(30), default="UNPAID", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    settled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class SupplementalWorkshopDelivery(TimestampMixin, Base):
    __tablename__ = "supplemental_workshop_deliveries"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_supplemental_quantity_positive"),
        CheckConstraint("unit_price_amount > 0", name="ck_supplemental_price_positive"),
    )
    id: Mapped[uuid.UUID] = uid()
    delivery_no: Mapped[str] = mapped_column(String(80), unique=True)
    delivery_date: Mapped[date] = mapped_column(Date)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"), index=True)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"), index=True)
    original_settlement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshop_settlements.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[int] = mapped_column(BigInteger)
    entered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    supplemental_settlement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workshop_settlements.id"))
    status: Mapped[str] = mapped_column(String(40), default="WAITING_SETTLEMENT", index=True)
    quantity_before: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    quantity_after: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    amount_before: Mapped[int] = mapped_column(BigInteger)
    amount_after: Mapped[int] = mapped_column(BigInteger)
    version: Mapped[int] = mapped_column(Integer, default=1)


class WorkshopSettlementLine(Base):
    __tablename__ = "workshop_settlement_lines"
    __table_args__ = (
        CheckConstraint("(production_batch_id IS NOT NULL) <> (supplemental_delivery_id IS NOT NULL)", name="ck_workshop_settlement_one_source"),
    )
    id: Mapped[uuid.UUID] = uid()
    settlement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshop_settlements.id", ondelete="RESTRICT"), index=True)
    production_batch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"))
    supplemental_delivery_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("supplemental_workshop_deliveries.id", ondelete="RESTRICT"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[int] = mapped_column(BigInteger)
    original_settlement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workshop_settlements.id"))


class CuttingReport(TimestampMixin, Base):
    __tablename__ = "cutting_reports"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_cutting_report_quantity_positive"),)
    id: Mapped[uuid.UUID] = uid()
    report_no: Mapped[str] = mapped_column(String(80), unique=True)
    report_date: Mapped[date] = mapped_column(Date)
    cutting_team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cutting_teams.id", ondelete="RESTRICT"), index=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"), index=True)
    pattern_code: Mapped[str] = mapped_column(String(100))
    color: Mapped[str | None] = mapped_column(String(150))
    layers: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(30), default="UNPAID")
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class BatchMaterialDelivery(TimestampMixin, Base):
    __tablename__ = "batch_material_deliveries"
    id: Mapped[uuid.UUID] = uid()
    delivery_no: Mapped[str] = mapped_column(String(80), unique=True)
    delivery_date: Mapped[date] = mapped_column(Date)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("production_batches.id", ondelete="RESTRICT"), index=True)
    workshop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workshops.id", ondelete="RESTRICT"))
    delivered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    received_by: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class BatchMaterialDeliveryLine(Base):
    __tablename__ = "batch_material_delivery_lines"
    __table_args__ = (
        UniqueConstraint("delivery_id", "material_name_key", name="uq_batch_material_delivery_name"),
        CheckConstraint("quantity_delivered > 0", name="ck_batch_material_delivery_positive"),
        CheckConstraint("total_required > 0", name="ck_batch_material_required_positive"),
    )
    id: Mapped[uuid.UUID] = uid()
    delivery_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("batch_material_deliveries.id", ondelete="RESTRICT"), index=True)
    material_id: Mapped[uuid.UUID | None] = mapped_column()
    material_name_snapshot: Mapped[str] = mapped_column(String(120))
    material_name_key: Mapped[str] = mapped_column(String(120))
    quantity_delivered: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    total_required: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    delivery_mode: Mapped[str] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)


class PatternNote(TimestampMixin, Base):
    __tablename__ = "pattern_notes"
    id: Mapped[uuid.UUID] = uid()
    note_no: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    client_token: Mapped[str] = mapped_column(String(100), unique=True)
    folder_legacy_id: Mapped[str | None] = mapped_column(String(255))
    media_ids: Mapped[list] = mapped_column(JSON, default=list)


class MediaObject(Base):
    """Metadata file; database never stores a presigned/object URL."""

    __tablename__ = "media_objects"
    id: Mapped[uuid.UUID] = uid()
    storage_provider: Mapped[str] = mapped_column(String(20), default="local", server_default="local")
    storage: Mapped[str] = mapped_column(String(20), default="LOCAL")
    bucket: Mapped[str | None] = mapped_column(String(255))
    object_key: Mapped[str] = mapped_column(Text)
    version_id: Mapped[str | None] = mapped_column(String(255))
    original_name: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum: Mapped[str] = mapped_column(String(64), default="")
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="READY")
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Partner(TimestampMixin, Base):
    __tablename__ = "partners"
    id: Mapped[uuid.UUID] = uid()
    partner_code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(250), index=True)
    partner_type: Mapped[str] = mapped_column(String(40), index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True)
    notes: Mapped[str | None] = mapped_column(Text)


class Material(TimestampMixin, Base):
    __tablename__ = "materials"
    id: Mapped[uuid.UUID] = uid()
    material_code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(250), index=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    unit: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True)
    unit_price_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class MaterialPriceHistory(Base):
    """Lịch sử giá phụ liệu (dây kéo) theo ngày hiệu lực; không xóa giá cũ."""

    __tablename__ = "material_price_history"
    __table_args__ = (CheckConstraint("unit_price_amount >= 0", name="ck_material_price_history_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"), index=True)
    effective_date: Mapped[date] = mapped_column(Date, index=True)
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    previous_unit_price_amount: Mapped[int | None] = mapped_column(BigInteger)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ZipperMonthTransaction(Base):
    """Giao dịch tiền dây kéo theo tháng (Ứng / Thanh toán), tham chiếu debt ledger chung."""

    __tablename__ = "zipper_month_transactions"
    id: Mapped[uuid.UUID] = uid()
    month: Mapped[str] = mapped_column(String(7), index=True)
    transaction_type: Mapped[str] = mapped_column(String(30), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    occurred_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    partner_transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partner_transactions.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmbroideryMonthTransaction(Base):
    """Giao dịch tiền thêu theo tháng (Ứng / Thanh toán), tham chiếu debt ledger chung."""

    __tablename__ = "embroidery_month_transactions"
    id: Mapped[uuid.UUID] = uid()
    month: Mapped[str] = mapped_column(String(7), index=True)
    transaction_type: Mapped[str] = mapped_column(String(30), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    occurred_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    partner_transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partner_transactions.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NhatInMonthTransaction(Base):
    """Giao dịch ứng/thanh toán theo tháng cho từng đối tác in."""

    __tablename__ = "nhat_in_month_transactions"
    id: Mapped[uuid.UUID] = uid()
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True)
    transaction_type: Mapped[str] = mapped_column(String(30), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    occurred_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    partner_transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partner_transactions.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MaterialVariant(TimestampMixin, Base):
    __tablename__ = "material_variants"
    __table_args__ = (UniqueConstraint("material_id", "color_id", "size", name="uq_material_variant"),)
    id: Mapped[uuid.UUID] = uid()
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"), index=True)
    color_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("colors.id", ondelete="RESTRICT"))
    size: Mapped[str | None] = mapped_column(String(80))
    display_name: Mapped[str] = mapped_column(String(300), index=True)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")


class MaterialReceipt(TimestampMixin, Base):
    __tablename__ = "material_receipts"
    __table_args__ = (
        CheckConstraint("freight_amount >= 0", name="ck_material_receipt_freight_nonnegative"),
        CheckConstraint("total_amount >= 0", name="ck_material_receipt_total_nonnegative"),
        CheckConstraint("paid_amount >= 0", name="ck_material_receipt_paid_nonnegative"),
        CheckConstraint("balance_amount >= 0", name="ck_material_receipt_balance_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    receipt_no: Mapped[str] = mapped_column(String(80), unique=True)
    receipt_date: Mapped[date] = mapped_column(Date)
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    freight_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    subtotal_amount: Mapped[int] = mapped_column(BigInteger)
    total_amount: Mapped[int] = mapped_column(BigInteger)
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(30), default="POSTED", index=True)
    received_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class MaterialReceiptLine(Base):
    __tablename__ = "material_receipt_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_material_receipt_line_quantity_positive"),
        CheckConstraint("unit_price_amount > 0", name="ck_material_receipt_line_price_positive"),
        CheckConstraint("amount > 0", name="ck_material_receipt_line_amount_positive"),
    )
    id: Mapped[uuid.UUID] = uid()
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_receipts.id", ondelete="RESTRICT"), index=True)
    material_variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("material_variants.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    weight: Mapped[Decimal | None] = mapped_column(Numeric(18, 3))
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    amount: Mapped[int] = mapped_column(BigInteger)
    notes: Mapped[str | None] = mapped_column(Text)


class FabricReceipt(TimestampMixin, Base):
    __tablename__ = "fabric_receipts"
    id: Mapped[uuid.UUID] = uid()
    receipt_no: Mapped[str] = mapped_column(String(80), unique=True)
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    total_amount: Mapped[int] = mapped_column(BigInteger)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(String(30), default="POSTED", index=True)


class FabricReceiptLine(Base):
    __tablename__ = "fabric_receipt_lines"
    __table_args__ = (
        UniqueConstraint("receipt_id", "line_number", name="uq_fabric_receipt_line_number"),
        CheckConstraint("entry_type IN ('PURCHASE', 'RETURN')", name="ck_fabric_receipt_line_type"),
        CheckConstraint("unit IN ('KG', 'METER')", name="ck_fabric_receipt_line_unit"),
        CheckConstraint("roll_count >= 0", name="ck_fabric_receipt_line_roll_count_nonnegative"),
        CheckConstraint("gross_quantity > 0", name="ck_fabric_receipt_line_quantity_positive"),
        CheckConstraint("wastage_quantity >= 0", name="ck_fabric_receipt_line_wastage_nonnegative"),
        CheckConstraint("net_quantity >= 0", name="ck_fabric_receipt_line_net_nonnegative"),
        CheckConstraint("unit_price_amount >= 0", name="ck_fabric_receipt_line_price_nonnegative"),
        CheckConstraint("entry_type = 'PURCHASE' OR transport_amount = 0", name="ck_fabric_receipt_line_return_transport_zero"),
    )
    id: Mapped[uuid.UUID] = uid()
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fabric_receipts.id", ondelete="RESTRICT"), index=True)
    line_number: Mapped[int] = mapped_column(Integer)
    entry_type: Mapped[str] = mapped_column(String(20))
    receipt_date: Mapped[date] = mapped_column(Date)
    fabric_name: Mapped[str] = mapped_column(String(250))
    unit: Mapped[str] = mapped_column(String(20))
    roll_count: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    gross_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    wastage_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    net_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    deduction_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    unit_price_amount: Mapped[int] = mapped_column(BigInteger)
    transport_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    amount: Mapped[int] = mapped_column(BigInteger)


class PartnerSettlement(TimestampMixin, Base):
    __tablename__ = "partner_settlements"
    __table_args__ = (
        Index(
            "uq_partner_settlement_period_non_printing",
            "partner_id",
            "period_month",
            "settlement_type",
            unique=True,
            sqlite_where=text("settlement_type NOT IN ('NHAT_IN', 'TUNG_IN')"),
            postgresql_where=text("settlement_type NOT IN ('NHAT_IN', 'TUNG_IN')"),
        ),
    )
    id: Mapped[uuid.UUID] = uid()
    settlement_no: Mapped[str] = mapped_column(String(80), unique=True)
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    period_month: Mapped[date] = mapped_column(Date, index=True)
    settlement_type: Mapped[str] = mapped_column(String(40))
    total_amount: Mapped[int] = mapped_column(BigInteger)
    paid_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(30), default="UNPAID", index=True)
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media_objects.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class PartnerTransaction(TimestampMixin, Base):
    __tablename__ = "partner_transactions"
    id: Mapped[uuid.UUID] = uid()
    transaction_no: Mapped[str] = mapped_column(String(80), unique=True)
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    direction: Mapped[str] = mapped_column(String(20))
    transaction_type: Mapped[str] = mapped_column(String(40), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    reference_type: Mapped[str | None] = mapped_column(String(40))
    reference_id: Mapped[uuid.UUID | None] = mapped_column()
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    settlement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partner_settlements.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="POSTED")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class PartnerSettlementLine(Base):
    __tablename__ = "partner_settlement_lines"
    __table_args__ = (UniqueConstraint("partner_transaction_id", name="uq_partner_settlement_transaction"),)
    id: Mapped[uuid.UUID] = uid()
    settlement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partner_settlements.id", ondelete="RESTRICT"), index=True)
    partner_transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partner_transactions.id", ondelete="RESTRICT"))
    amount: Mapped[int] = mapped_column(BigInteger)


class PartnerFile(Base):
    __tablename__ = "partner_files"
    __table_args__ = (UniqueConstraint("partner_id", "media_id", "purpose", name="uq_partner_file"),)
    id: Mapped[uuid.UUID] = uid()
    partner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("partners.id", ondelete="RESTRICT"), index=True)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("partner_transactions.id", ondelete="RESTRICT"))
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_objects.id", ondelete="RESTRICT"))
    purpose: Mapped[str] = mapped_column(String(80))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (CheckConstraint("daily_rate_amount >= 0", name="ck_employee_daily_rate_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    employee_code: Mapped[str] = mapped_column(String(80), unique=True)
    full_name: Mapped[str] = mapped_column(String(250), index=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    position: Mapped[str] = mapped_column(String(100), index=True)
    daily_rate_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    start_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), unique=True)


class AttendanceRecord(TimestampMixin, Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("work_date", "employee_id", "shift", name="uq_attendance_day_employee_shift"),
        CheckConstraint("work_units >= 0", name="ck_attendance_work_units_nonnegative"),
        CheckConstraint("overtime_hours >= 0", name="ck_attendance_overtime_nonnegative"),
    )
    id: Mapped[uuid.UUID] = uid()
    work_date: Mapped[date] = mapped_column(Date, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    shift: Mapped[str] = mapped_column(String(30))
    work_units: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=0)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=0)
    bonus_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    entered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class EmployeeRateHistory(Base):
    """Lịch sử đổi giá công; không xóa lịch sử lương cũ."""

    __tablename__ = "employee_rate_history"
    __table_args__ = (CheckConstraint("new_daily_rate_amount >= 0", name="ck_rate_history_new_nonnegative"),)
    id: Mapped[uuid.UUID] = uid()
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    effective_date: Mapped[date] = mapped_column(Date)
    old_daily_rate_amount: Mapped[int] = mapped_column(BigInteger)
    new_daily_rate_amount: Mapped[int] = mapped_column(BigInteger)
    reason: Mapped[str | None] = mapped_column(Text)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SalaryAdvance(TimestampMixin, Base):
    __tablename__ = "salary_advances"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_salary_advance_positive"),)
    id: Mapped[uuid.UUID] = uid()
    advance_no: Mapped[str] = mapped_column(String(80), unique=True)
    advance_date: Mapped[date] = mapped_column(Date, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="APPROVED", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)


class PayrollRun(TimestampMixin, Base):
    __tablename__ = "payroll_runs"
    id: Mapped[uuid.UUID] = uid()
    payroll_no: Mapped[str] = mapped_column(String(80), unique=True)
    period_month: Mapped[date] = mapped_column(Date, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_gross_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    total_advance_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    total_net_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class PayrollLine(Base):
    __tablename__ = "payroll_lines"
    __table_args__ = (UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_line_employee"),)
    id: Mapped[uuid.UUID] = uid()
    payroll_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payroll_runs.id", ondelete="RESTRICT"), index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id", ondelete="RESTRICT"), index=True)
    employee_name_snapshot: Mapped[str] = mapped_column(String(250))
    daily_rate_amount: Mapped[int] = mapped_column(BigInteger)
    work_units: Mapped[Decimal] = mapped_column(Numeric(8, 3))
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(8, 3))
    base_amount: Mapped[int] = mapped_column(BigInteger)
    overtime_amount: Mapped[int] = mapped_column(BigInteger)
    advance_amount: Mapped[int] = mapped_column(BigInteger)
    net_amount: Mapped[int] = mapped_column(BigInteger)
    notes: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSON)


class OrderMedia(Base):
    __tablename__ = "order_media"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media_objects.id"), primary_key=True)
