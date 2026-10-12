"""Tạo dữ liệu DEMO; không dùng module này để nhập dữ liệu production.

    python -m app.seed --mode demo
    python -m app.seed --mode demo --reset
    python -m app.seed --mode production  # kiểm tra an toàn, không ghi dữ liệu

Toàn bộ mật khẩu ở đây là mật khẩu DEMO, không phải thông tin thật.
"""

import argparse
import random
import sys
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.db import Base, SessionLocal, engine
from .core.security import hash_password
from .models import (
    Color, Customer, DebtLedgerEntry, InventoryBalance, Order, OrderGroup, OrderStatusEvent,
    Permission, Product, ProductVariant, Role, RolePermission, User, UserRole, Warehouse,
)
from .core.rbac import ALL_PERMISSIONS, LEGACY_ROLE_PERMISSIONS
from .services.orders import TZ

DEMO_USERS = [
    ("owner", "owner123", "Trang Hà", "OWNER"),
    ("thupham", "demo123", "Thư Phạm", "KHO"),
    ("thunho", "demo123", "Thư Nhỏ", "KHO"),
    ("hoang", "demo123", "Hoàng", "KHO"),
]

CUSTOMER_NAMES = [
    "khánh ngọc", "1046 Lạc Long Quân", "cường âu cơ", "hiền đà nẵng", "xe thành nhân.a phát",
    "Nguyên lào 2026", "Nguyên Lào 2025", "a thạo bt", "ad trang đài", "Vân Gò Dầu", "kb pat",
    "chị My", "Khách Hưng 5 Châu", "teEtyz thái lan", "13 Đoàn Hồng Phước", "We chị nhàn 7d",
    "BT Đào Trần", "khách 388 trường chinh", "AD Nhiên", "huỳnh thái q10", "nguyễn đông si",
    "AD HANH", "Bích Bình Tân", "Quân thể thao chị Hảo", "campuchia sileap", "Đức Long An",
]
LEGACY_DEMO_CUSTOMER_CODES = {
    *(f"KH170000000{i:04d}" for i in range(len(CUSTOMER_NAMES))),
    "KH1700000009999",
}


def demo_customer_generation(codes: set[str]) -> str | None:
    """Recognize only known demo generations; never infer from names or phones."""
    if codes and all(code.startswith("DEMO-KH-") for code in codes):
        return "CURRENT"
    if codes == LEGACY_DEMO_CUSTOMER_CODES:
        return "LEGACY"
    return None


def seed_demo_inventory(db: Session, warehouses: tuple[Warehouse, Warehouse]) -> None:
    """Idempotently add only the clearly prefixed DEMO catalog and balances."""
    tx, ck = warehouses
    colors: dict[str, Color] = {}
    for code, name, aliases in (
        ("DEMO-DEN", "Đen", "den,black"),
        ("DEMO-DO", "Đỏ đô", "do do,đỏ"),
    ):
        color = db.scalar(select(Color).where(Color.color_code == code))
        if not color:
            color = Color(color_code=code, canonical_name=name, aliases=aliases)
            db.add(color); db.flush()
        colors[code] = color

    product = db.scalar(select(Product).where(Product.product_code == "DEMO-SP-001"))
    if not product:
        product = Product(product_code="DEMO-SP-001", pattern_code="RAP-DEMO-01", brand="AZALAS",
                          name="Quần thể thao demo", category="Quần")
        db.add(product); db.flush()

    variants = []
    for color_code, short_code in (("DEMO-DEN", "DEN"), ("DEMO-DO", "DODO")):
        color = colors[color_code]
        for size in ("M", "L", "XL"):
            internal_code = f"DEMO-NB-{short_code}-{size}"
            variant = db.scalar(select(ProductVariant).where(ProductVariant.internal_code == internal_code))
            if not variant:
                variant = ProductVariant(
                    product_id=product.id, internal_code=internal_code,
                    sales_code=f"DEMO-BH-{short_code}", color_id=color.id, size=size,
                    display_name=f"Quần thể thao demo {color.canonical_name} {size}",
                )
                db.add(variant); db.flush()
            variants.append(variant)

    for warehouse in (tx, ck):
        for index, variant in enumerate(variants):
            existing = db.scalar(select(InventoryBalance.id).where(
                InventoryBalance.variant_id == variant.id,
                InventoryBalance.warehouse_id == warehouse.id,
                InventoryBalance.location_id.is_(None),
            ).limit(1))
            if existing:
                continue
            on_hand = 40 + index * 5
            db.add(InventoryBalance(
                variant_id=variant.id, warehouse_id=warehouse.id,
                on_hand=on_hand, reserved=0, available=on_hand,
                pending_finish=0, cut_separated=0, defective=0,
            ))


def seed_demo_rbac(db: Session, users: list[User]) -> None:
    """Install the same normalized role graph used by migration 0007 for isolated demo/test databases."""
    permissions: dict[str, Permission] = {}
    for code in sorted(ALL_PERMISSIONS):
        row = db.scalar(select(Permission).where(Permission.code == code))
        if not row:
            module, action = code.split(".", 1)
            row = Permission(code=code, module=module.upper(), action=action.upper(), description=code)
            db.add(row); db.flush()
        permissions[code] = row
    role_codes = {"OWNER", "ADMIN", "KHO", "KE_TOAN", "NHAN_SU", "MEMBER"}
    roles: dict[str, Role] = {}
    for code in sorted(role_codes):
        row = db.scalar(select(Role).where(Role.code == code))
        if not row:
            row = Role(code=code, name=code.replace("_", " ").title(), description=f"Vai trò hệ thống {code}", is_system=True)
            db.add(row); db.flush()
            allowed = ALL_PERMISSIONS if code in ("OWNER", "ADMIN") else LEGACY_ROLE_PERMISSIONS.get(code, set())
            for permission_code in allowed:
                db.add(RolePermission(role_id=row.id, permission_id=permissions[permission_code].id))
        roles[code] = row
    for user in users:
        db.add(UserRole(user_id=user.id, role_id=roles[user.role].id, assigned_by=users[0].id))


def seed_demo(db: Session) -> None:
    rnd = random.Random(2026)
    now = datetime.now(TZ)
    today = now.date()

    users = []
    for username, pw, name, role in DEMO_USERS:
        u = User(username=username, password_hash=hash_password(pw), display_name=name, role=role)
        db.add(u)
        users.append(u)
    owner, pickers = users[0], users[1:]

    tx = Warehouse(code="TAN_XUAN", name="Tân Xuân", sort_order=1)
    ck = Warehouse(code="CA_KOI", name="Cá Koi", sort_order=2)
    db.add_all([tx, ck])
    db.flush()
    seed_demo_rbac(db, users)

    # Catalog/tồn DEMO phục vụ đúng workflow soạn và giữ hàng.
    seed_demo_inventory(db, (tx, ck))

    customers = []
    for i, name in enumerate(CUSTOMER_NAMES):
        # Dữ liệu DEMO không được trông giống số điện thoại khách hàng thật.
        c = Customer(customer_code=f"DEMO-KH-{i + 1:04d}", name=name, phone=None)
        db.add(c)
        customers.append(c)
    # Hai khách trùng tên nhưng khác người: phải hiện thành 2 thẻ riêng
    twin = Customer(customer_code="DEMO-KH-9999", name="chị My", phone=None, address="Địa chỉ demo")
    db.add(twin)
    customers.append(twin)
    db.flush()

    # Nợ đầu kỳ + phát sinh qua ledger
    for c in customers:
        if rnd.random() < 0.2:
            continue
        opening = rnd.randint(5, 650) * 1000
        db.add(DebtLedgerEntry(party_id=c.id, entry_type="OPENING", amount_delta=opening,
                               description="Nợ đầu kỳ (dữ liệu demo)", occurred_at=now - timedelta(days=60)))
        if rnd.random() < 0.5:
            db.add(DebtLedgerEntry(party_id=c.id, entry_type="PAYMENT", amount_delta=-rnd.randint(1, opening // 1000) * 1000,
                                   description="Khách thanh toán", occurred_at=now - timedelta(days=rnd.randint(1, 30))))

    seq = 0

    def make_order(c: Customer, wh: Warehouse, status: str, days_ago: int, *, order_type="NORMAL",
                   suffix="", group=None, base_no=None) -> Order:
        nonlocal seq
        seq += 1
        created = now - timedelta(days=days_ago, minutes=rnd.randint(0, 600))
        no = base_no or f"HD{created:%y%m%d%H%M%S}{seq % 10}"
        o = Order(
            order_no=no + suffix,
            order_group_id=group.id if group else None,
            customer_id=c.id,
            warehouse_id=wh.id,
            order_type=order_type,
            created_date=created.date(),
            delivery_date=created.date() + timedelta(days=rnd.randint(0, 7)),
            is_urgent=rnd.random() < 0.25,
            customer_note=rnd.choice([None, "Giao sớm giúp em", "Size theo ảnh Zalo", "Lấy màu đỏ đô", "Gửi chành xe"]),
            status=status,
            created_by=owner.id,
            total_amount=rnd.randint(20, 900) * 1000 if status in ("SHIPPING", "COMPLETED", "PICKED") else 0,
        )
        if status in ("PICKING", "PICKED", "SHIPPING", "COMPLETED"):
            o.claimed_by = rnd.choice(pickers).id
            o.claimed_at = created + timedelta(hours=1)
            if status != "PICKING":
                o.picked_at = min(created + timedelta(hours=3), now)
        o.created_at = created
        db.add(o)
        db.flush()
        db.add(OrderStatusEvent(order_id=o.id, to_status=status, actor_user_id=owner.id, occurred_at=created))
        return o

    # Đơn mới: nhiều khách có nhiều đơn ở các thời điểm khác nhau
    for i in range(34):
        c = customers[i % 14] if i < 28 else customers[rnd.randrange(len(customers))]
        make_order(c, tx if rnd.random() < 0.65 else ck, "NEW", rnd.randint(0, 12))
    # Khách trùng tên "chị My" (người khác) cũng có đơn mới ở Tân Xuân
    make_order(twin, tx, "NEW", 1)
    make_order(twin, tx, "NEW", 3)

    for _ in range(10):
        make_order(rnd.choice(customers), rnd.choice([tx, ck]), "PICKING", rnd.randint(0, 8))
    for _ in range(8):
        make_order(rnd.choice(customers), rnd.choice([tx, ck]), "DEBT_ORDER", rnd.randint(10, 60))
    for _ in range(6):
        make_order(rnd.choice(customers), tx, "NEW", rnd.randint(5, 40), order_type="CUSTOMER_ORDER")
    for status, n in (("PICKED", 5), ("SHIPPING", 4), ("COMPLETED", 12)):
        for _ in range(n):
            make_order(rnd.choice(customers), rnd.choice([tx, ck]), status, rnd.randint(0, 25))

    # Đơn hai kho: hai order con chung order_group_id
    for c in (customers[1], customers[4]):
        base = f"HD{now - timedelta(days=2):%y%m%d%H%M%S}{rnd.randint(0, 9)}"
        g = OrderGroup(group_no=base, customer_id=c.id)
        db.add(g)
        db.flush()
        make_order(c, tx, "NEW", 2, suffix="-TX", group=g, base_no=base)
        make_order(c, ck, "NEW", 2, suffix="-CK", group=g, base_no=base)

    db.commit()


def main() -> None:
    def announce(text: str) -> None:
        """Do not fail a completed seed because an old Windows console is cp1252."""
        try:
            print(text)
        except UnicodeEncodeError:
            encoding = sys.stdout.encoding or "ascii"
            print(text.encode(encoding, errors="replace").decode(encoding))

    parser = argparse.ArgumentParser(description="Seed AZALAS theo chế độ an toàn")
    parser.add_argument("--mode", choices=("demo", "production"), required=True)
    parser.add_argument("--reset", action="store_true", help="Chỉ dành cho DEMO; xóa toàn bộ bảng")
    args = parser.parse_args()

    if args.mode == "production":
        if args.reset:
            parser.error("--reset bị cấm trong chế độ production")
        announce("PRODUCTION mode: không tạo dữ liệu demo. Dùng app.import_customers để nhập tbl_KhachHang.")
        return

    if args.reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        # Không chỉ kiểm tra users: bất kỳ dữ liệu nghiệp vụ nào cũng khiến demo seed dừng.
        occupied = any(
            db.scalar(select(model.id).limit(1)) is not None
            for model in (User, Customer, Warehouse, Order)
        )
        if occupied:
            customer_codes = set(db.scalars(select(Customer.customer_code)))
            demo_generation = demo_customer_generation(customer_codes)
            warehouses = {row.code: row for row in db.scalars(select(Warehouse))}
            if demo_generation and {"TAN_XUAN", "CA_KOI"}.issubset(warehouses):
                if demo_generation == "LEGACY":
                    # Chỉ tập mã demo cũ cố định mới được làm sạch. Tuyệt đối
                    # không suy luận/ghi đè customer production.
                    for customer in db.scalars(select(Customer).where(Customer.customer_code.in_(customer_codes))):
                        customer.phone = None
                before = db.scalar(select(Product.id).where(Product.product_code == "DEMO-SP-001"))
                seed_demo_inventory(db, (warehouses["TAN_XUAN"], warehouses["CA_KOI"]))
                db.commit()
                if not before:
                    announce("DB demo cũ: đã bỏ số mẫu và bổ sung catalog/tồn DEMO; không đụng dữ liệu thật.")
                else:
                    announce("DB demo đã có dữ liệu, không có khách hàng hoặc đơn hàng nào bị ghi đè.")
                return
            announce("DB đã có dữ liệu, bỏ qua toàn bộ DEMO seed. Không có bản ghi nào bị ghi đè.")
            return
        seed_demo(db)
        announce("Đã tạo dữ liệu demo. Đăng nhập: owner / owner123")


if __name__ == "__main__":
    main()
