"""Loads per-organisation integration settings and decrypted secrets."""

from __future__ import annotations

from typing import Any

from .ai import AIClient, ProviderConfig
from .config import Settings
from .crypto import decrypt_secret
from .db import Conn
from .providers import ResendSender, SandboxSender, Sender, TwilioSmsSender, WhatsAppCloudSender


def load_integration(conn: Conn, org_id: str, kind: str, settings: Settings) -> tuple[dict[str, Any], str | None] | None:
    row = conn.execute(
        """select c.enabled, c.settings, s.ciphertext from integration_configs c
           left join integration_secrets s on s.organisation_id = c.organisation_id and s.kind = c.kind
           where c.organisation_id = %s and c.kind = %s""",
        [org_id, kind],
    ).fetchone()
    if not row or not row["enabled"]:
        return None
    secret = None
    if row["ciphertext"] and settings.app_encryption_key:
        secret = decrypt_secret(row["ciphertext"], settings.app_encryption_key)
    return dict(row["settings"] or {}), secret


def email_settings(conn: Conn, org_id: str) -> dict[str, Any]:
    row = conn.execute("select settings from integration_configs where organisation_id = %s and kind = 'email'", [org_id]).fetchone()
    return dict(row["settings"]) if row and row["settings"] else {}


def ai_client(conn: Conn, org_id: str, settings: Settings) -> AIClient | None:
    loaded = load_integration(conn, org_id, "ai", settings)
    if not loaded or not loaded[1]:
        return None
    cfg, key = loaded
    return AIClient(
        ProviderConfig(provider=str(cfg.get("provider", "openrouter")), model=str(cfg.get("model", "")), api_key=key or "", base_url=cfg.get("base_url") or None),
        timeout=settings.ai_timeout_seconds,
    )


def sender_for(conn: Conn, org_id: str, channel: str, settings: Settings) -> Sender:
    if channel == "email":
        if settings.resend_api_key and settings.email_from:
            return ResendSender(settings.resend_api_key, settings.email_from)
        return SandboxSender("resend")
    if channel == "whatsapp":
        loaded = load_integration(conn, org_id, "whatsapp", settings)
        if loaded and loaded[1]:
            cfg, token = loaded
            return WhatsAppCloudSender(token or "", str(cfg["phone_number_id"]), str(cfg["template_name"]), str(cfg.get("template_language", "en")))
        return SandboxSender("whatsapp")
    if channel == "sms":
        loaded = load_integration(conn, org_id, "sms", settings)
        if loaded and loaded[1]:
            cfg, token = loaded
            return TwilioSmsSender(str(cfg["account_sid"]), token or "", str(cfg["from_number"]), f"{settings.app_url}/api/webhooks/twilio")
        return SandboxSender("twilio")
    raise ValueError(f"unknown channel {channel}")
