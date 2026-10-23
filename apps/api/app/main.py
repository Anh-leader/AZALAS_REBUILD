import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import settings
from .core.db import engine
from .core.errors import ApiError, api_error_handler
from .routers import admin, auth, customers, dashboard, debt, embroidery, fabric, hr, inventory, invoices, materials, media, orders, payments, printing_partners, production, reports, returns, shipping, zippers

app = FastAPI(title="AZALAS SPORT API", version="0.1.0-mvp")
app.add_exception_handler(ApiError, api_error_handler)

_logger = logging.getLogger("azalas")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Trả lỗi 500 dạng JSON đồng nhất để frontend hiển thị message, không lộ chi tiết nội bộ."""
    _logger.exception("Unhandled error at %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {
            "code": "INTERNAL_SERVER_ERROR",
            "message": "Lỗi máy chủ nội bộ. Vui lòng kiểm tra log backend.",
            "details": {"path": request.url.path},
            "field_errors": [],
        }},
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, admin.router, dashboard.router, customers.router, orders.router, inventory.router, media.router,
          shipping.router, invoices.router, payments.router, debt.router, returns.router, production.router, materials.router,
          zippers.router, embroidery.router, printing_partners.router, fabric.router, hr.router, reports.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    """Readiness has an actual database probe; live stays dependency-free."""
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except Exception as exc:
        return {"status": "not_ready", "database": "unavailable", "detail": str(exc)}
    return {"status": "ok", "database": "ok"}
