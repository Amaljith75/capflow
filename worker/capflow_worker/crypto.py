"""Mirrors src/lib/crypto.ts: AES-256-GCM secrets and HMAC unsubscribe tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key(raw: str) -> bytes:
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded")
    return key


def decrypt_secret(envelope: str, raw_key: str) -> str:
    data = base64.b64decode(envelope)
    iv, tag, ciphertext = data[:12], data[12:28], data[28:]
    return AESGCM(_key(raw_key)).decrypt(iv, ciphertext + tag, None).decode()


def encrypt_secret(plaintext: str, raw_key: str) -> str:
    iv = os.urandom(12)
    sealed = AESGCM(_key(raw_key)).encrypt(iv, plaintext.encode(), None)
    ciphertext, tag = sealed[:-16], sealed[-16:]
    return base64.b64encode(iv + tag + ciphertext).decode()


def unsubscribe_token(customer_id: str, raw_key: str) -> str:
    mac = hmac.new(_key(raw_key), f"unsubscribe:{customer_id}".encode(), hashlib.sha256).digest()
    return f"{customer_id}.{base64.urlsafe_b64encode(mac).decode().rstrip('=')}"
