"""Outbound email.

Sends via SMTP when ``SMTP_HOST`` is configured; otherwise (dev) it logs the
verification link so the flow stays testable without a mail provider. Works
with any SMTP provider — Resend, Postmark, Mailgun, SES, Gmail, etc.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from .. import config

log = logging.getLogger("trending_table.email")


def verification_link(raw_token: str) -> str:
    return f"{config.APP_BASE_URL}/verify?token={raw_token}"


def _login_and_send(s: smtplib.SMTP, msg: EmailMessage) -> None:
    if config.SMTP_USER:
        s.login(config.SMTP_USER, config.SMTP_PASSWORD)
    s.send_message(msg)


def _send(to: str, subject: str, text: str, html: str) -> None:
    """Deliver one message via SMTP, or log it when SMTP isn't configured."""
    if not config.SMTP_HOST:
        log.info("[email:dev] to=%s subject=%s\n%s", to, subject, text)
        print(f"[email:dev] to={to} :: {text}", flush=True)
        return

    msg = EmailMessage()
    msg["From"] = formataddr((config.MAIL_FROM_NAME, config.MAIL_FROM))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if config.SMTP_SSL:
        with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT,
                              context=ssl.create_default_context()) as s:
            _login_and_send(s, msg)
    else:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as s:
            if config.SMTP_STARTTLS:
                s.starttls(context=ssl.create_default_context())
            _login_and_send(s, msg)
    log.info("[email] sent %r to %s", subject, to)


def send_verification(email: str, raw_token: str) -> None:
    link = verification_link(raw_token)
    subject = "Confirm your email · Trending Table"
    text = (
        "Welcome to Trending Table!\n\n"
        f"Confirm your email address by opening this link:\n{link}\n\n"
        f"The link expires in {config.VERIFY_TOKEN_TTL_HOURS} hours. "
        "If you didn't create an account, you can ignore this message."
    )
    html = f"""\
<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:auto">
  <h2 style="margin:0 0 12px">Confirm your email</h2>
  <p style="color:#444;line-height:1.5">Welcome to Trending Table! Confirm your email
     address to finish setting up your account.</p>
  <p style="margin:24px 0">
    <a href="{link}" style="background:#ff3d86;color:#fff;text-decoration:none;
       padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">
       Confirm email</a>
  </p>
  <p style="color:#888;font-size:13px;line-height:1.5">Or paste this link:<br>
     <a href="{link}" style="color:#2b55ff">{link}</a></p>
  <p style="color:#aaa;font-size:12px">This link expires in {config.VERIFY_TOKEN_TTL_HOURS} hours.</p>
</div>"""
    _send(email, subject, text, html)
