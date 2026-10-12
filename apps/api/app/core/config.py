from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: str = "postgresql+psycopg://azalas:azalas_dev@localhost:5433/azalas"
    test_database_url: str = "postgresql+psycopg://azalas:azalas_dev@localhost:5433/azalas_test"
    jwt_secret: str = "dev-only-change-me-use-a-32-byte-minimum-key"
    jwt_expire_minutes: int = 12 * 60
    jwt_refresh_days: int = 14
    upload_dir: str = "uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    money_rounding_tolerance_vnd: int = 1
    s3_bucket: str | None = None
    s3_region: str | None = None


settings = Settings()
