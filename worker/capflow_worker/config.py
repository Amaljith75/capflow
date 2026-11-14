"""Worker configuration, read from environment variables (see worker/.env.example)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Direct Postgres connection string for the Supabase database (session pooler, port 5432).
    database_url: str = Field(default="postgresql://postgres:postgres@127.0.0.1:5432/postgres")
    redis_url: str = Field(default="redis://127.0.0.1:6379/0")
    app_url: str = Field(default="http://localhost:3000")
    # Shared with the web app; decrypts tenant integration secrets and signs unsubscribe links.
    app_encryption_key: str | None = None

    resend_api_key: str | None = None
    email_from: str | None = None

    # Bearer token for the worker's admin endpoints. Admin endpoints are disabled when unset.
    worker_admin_token: str | None = None

    dispatch_batch_size: int = 50
    max_send_attempts: int = 3
    ai_timeout_seconds: float = 25.0
    log_level: str = "INFO"

    @property
    def email_live(self) -> bool:
        return bool(self.resend_api_key and self.email_from)


@lru_cache
def get_settings() -> Settings:
    return Settings()
