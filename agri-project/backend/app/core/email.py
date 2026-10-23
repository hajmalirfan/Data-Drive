import html
import logging
import smtplib
from email.message import EmailMessage

import httpx

from .config import settings

logger = logging.getLogger("smartag.email")


def mailtrap_configured() -> bool:
    return bool(settings.MAILTRAP_API_TOKEN and settings.MAILTRAP_FROM_EMAIL)


def smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and (settings.SMTP_FROM or settings.SMTP_USER))


def email_configured() -> bool:
    return mailtrap_configured() or smtp_configured()


def _build_bodies(full_name: str, otp: str, expires_minutes: int) -> tuple[str, str]:
    name = html.escape((full_name or "there").strip())
    text_body = (
        f"Hello {full_name or 'there'},\n\n"
        f"Your {settings.APP_NAME} password reset code is: {otp}\n\n"
        f"This code expires in {expires_minutes} minutes. "
        "If you did not request a password reset, you can ignore this email.\n\n"
        f"- {settings.APP_NAME}"
    )
    html_body = f"""\
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b2d22">
  <h2 style="color:#157347;margin:0 0 12px">Reset your password</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.6">Hello {name},</p>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
    Use the code below to verify your identity and set a new {html.escape(settings.APP_NAME)} password.
  </p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#157347;background:#edf8ee;border:1px solid #cfe8d6;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">
    {otp}
  </div>
  <p style="margin:0 0 8px;font-size:13px;color:#58685e">
    This code expires in {expires_minutes} minutes.
  </p>
  <p style="margin:0;font-size:13px;color:#58685e">
    If you did not request a password reset, you can safely ignore this email.
  </p>
</div>"""
    return text_body, html_body


def _send_with_mailtrap(to_email: str, full_name: str, otp: str, expires_minutes: int) -> bool:
    text_body, html_body = _build_bodies(full_name, otp, expires_minutes)
    payload = {
        "from": {
            "email": settings.MAILTRAP_FROM_EMAIL,
            "name": settings.MAILTRAP_FROM_NAME,
        },
        "to": [{"email": to_email}],
        "subject": f"{settings.APP_NAME} password reset code",
        "text": text_body,
        "html": html_body,
        "category": "Password Reset",
    }
    headers = {
        "Api-Token": settings.MAILTRAP_API_TOKEN,
        "Content-Type": "application/json",
    }
    try:
        response = httpx.post(
            settings.MAILTRAP_API_URL,
            json=payload,
            headers=headers,
            timeout=20.0,
        )
        response.raise_for_status()
        logger.info("Password reset OTP email sent via Mailtrap to %s", to_email)
        return True
    except Exception:
        logger.exception("Mailtrap could not send the password reset OTP to %s", to_email)
        return False


def _send_with_smtp(to_email: str, full_name: str, otp: str, expires_minutes: int) -> bool:
    text_body, html_body = _build_bodies(full_name, otp, expires_minutes)
    message = EmailMessage()
    message["Subject"] = f"{settings.APP_NAME} password reset code"
    message["From"] = settings.SMTP_FROM or settings.SMTP_USER
    message["To"] = to_email
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        if settings.SMTP_USE_SSL:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        with server:
            server.ehlo()
            if settings.SMTP_USE_TLS and not settings.SMTP_USE_SSL:
                server.starttls()
                server.ehlo()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(message)
        logger.info("Password reset OTP email sent via SMTP to %s", to_email)
        return True
    except Exception:
        logger.exception("SMTP could not send the password reset OTP to %s", to_email)
        return False


def send_password_reset_email(to_email: str, full_name: str, otp: str, expires_minutes: int) -> bool:
    """Send the password-reset OTP.

    Mailtrap's Email Sending API is used when a token is configured, then SMTP,
    and finally the OTP is logged for local development without a mail provider.
    """
    if mailtrap_configured():
        return _send_with_mailtrap(to_email, full_name, otp, expires_minutes)
    if smtp_configured():
        return _send_with_smtp(to_email, full_name, otp, expires_minutes)

    logger.warning(
        "No email provider is configured. Password reset OTP for %s is %s (valid for %s minutes).",
        to_email,
        otp,
        expires_minutes,
    )
    return False
