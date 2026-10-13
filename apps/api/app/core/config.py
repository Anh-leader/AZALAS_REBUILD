from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: str = "postgresql+psycopg://azalas:azalas_dev@localhost:5433/azalas"
    test_database_url: str = "postgresql+psycopg://azalas:azalas_dev@localhost:5433/azalas_test"
    jwt_secret: str = "dev-only-change-me-use-a-32-byte-minimum-key"
    jwt_expire_minutes: int = 12 * 60
    jwt_refresh_days: int = 14
    upload_dir: str = "uploads"
    storage_driver: str = "local"
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket: str | None = None
    r2_endpoint_url: str | None = None
    r2_public_base_url: str | None = None
    r2_signed_url_expire_seconds: int = 300
    max_upload_mb: int = 10
    allowed_image_types: str = "image/jpeg,image/png,image/webp"
    money_rounding_tolerance_vnd: int = 1
    s3_bucket: str | None = None
    s3_region: str | None = None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def allowed_image_type_set(self) -> frozenset[str]:
        return frozenset(value.strip().lower() for value in self.allowed_image_types.split(",") if value.strip())


settings = Settings()
