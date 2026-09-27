"""Branded email rendering (Part 3 §3): Jinja2 templates with inline CSS + plain-text alternatives."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from markdown_it import MarkdownIt

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates" / "email"
LINK_REMOVED = "[link removed]"

_html_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=select_autoescape(["html"]),
                        undefined=StrictUndefined, trim_blocks=False)
_text_env = Environment(loader=FileSystemLoader(TEMPLATE_DIR), autoescape=False, undefined=StrictUndefined)

# Markdown without raw HTML (html=False) and without images; markdown-it's validateLink already refuses
# javascript:/vbscript:/file:/data: links.
_md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False}).disable("image")

_INLINE_STYLES = {
    "p": "margin:0 0 14px 0;",
    "h1": "margin:18px 0 10px 0;font-size:20px;line-height:1.3;",
    "h2": "margin:18px 0 10px 0;font-size:18px;line-height:1.3;",
    "h3": "margin:16px 0 8px 0;font-size:16px;line-height:1.3;",
    "ul": "margin:0 0 14px 18px;padding:0;",
    "ol": "margin:0 0 14px 18px;padding:0;",
    "li": "margin:0 0 6px 0;",
    "blockquote": "margin:0 0 14px 0;padding:4px 0 4px 14px;border-left:3px solid #d4d4d8;color:#6b6b76;",
    "code": "font-family:Menlo,Consolas,monospace;font-size:13px;background:#f1f1f4;padding:1px 4px;border-radius:4px;",
    "pre": "margin:0 0 14px 0;padding:12px;background:#f1f1f4;border-radius:8px;overflow:auto;",
    "hr": "border:0;border-top:1px solid #e6e6ea;margin:18px 0;",
}


def render_markdown(markdown: str, accent: str) -> str:
    html = _md.render(markdown or "")
    for tag, style in _INLINE_STYLES.items():
        html = re.sub(rf"<{tag}(?=[\s>])", f'<{tag} style="{style}"', html)
    html = re.sub(r'<a href="', f'<a class="link" target="_blank" rel="noopener" style="color:{accent};" href="', html)
    return html


def markdown_to_text(markdown: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r"\1 (\2)", markdown or "")
    return re.sub(r"[*_`#>]+", "", text).strip()


@dataclass
class Rendered:
    subject: str
    html: str
    text: str


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    description: str
    heading: str
    action_label: str | None
    reason: str


TEMPLATES: dict[str, TemplateSpec] = {
    "verify_email": TemplateSpec("verify_email", "Email address verification link (sent at sign-up / on request).",
                                 "Confirm your email address", "Verify email",
                                 "You're receiving this because an account was created with this email address."),
    "password_reset": TemplateSpec("password_reset", "One-time password reset link (valid 60 minutes).",
                                   "Reset your password", "Reset password",
                                   "You're receiving this because a password reset was requested for your account."),
    "invitation": TemplateSpec("invitation", "Invitation to join a business workspace (valid 7 days).",
                               "You're invited", "Accept invitation",
                               "You're receiving this because a team member invited this email address."),
    "welcome": TemplateSpec("welcome", "Welcome message after the email address is verified.",
                            "Welcome aboard", "Open the dashboard",
                            "You're receiving this because you created an account."),
    "admin_message": TemplateSpec("admin_message", "Message composed by a platform administrator (markdown).",
                                  "", None,
                                  "You're receiving this because you have an account on our platform."),
    "digital_card_invite": TemplateSpec("digital_card_invite", "A business issued the recipient an employee digital card.",
                                        "Your digital business card", "Accept your card",
                                        "You're receiving this because a business invited this email address."),
    "login_code": TemplateSpec("login_code", "One-time sign-in code (new device / email-code sign-in, valid 10 minutes).",
                               "Your sign-in code", None,
                               "You're receiving this because someone is signing in to your account."),
    "password_changed": TemplateSpec("password_changed", "Security notice after a password change or reset.",
                                     "Your password was changed", None,
                                     "You're receiving this security notice because your account password changed."),
}

SUBJECTS = {
    "verify_email": "Verify your {product} email",
    "password_reset": "Reset your {product} password",
    "invitation": "You're invited to {business_name} on {product}",
    "welcome": "Welcome to {product}",
    "password_changed": "Your {product} password was changed",
    "login_code": "{code} is your {product} sign-in code",
    "digital_card_invite": "{business_name} issued you a digital business card",
}


def brand_context(branding: dict[str, Any]) -> dict[str, Any]:
    from app.services.branding import public

    pub = public(branding)
    logo = pub["logo_url"]
    if logo and logo.lower().endswith(".svg"):  # most email clients can't render SVG
        logo = None
    body_font = branding["fonts"]["body"]
    return {
        "product_name": pub["product_name"],
        "logo_url": logo,
        "accent": branding["theme"]["accent_light"],
        "accent_dark": branding["theme"]["accent_dark"],
        "support_email": pub["support_email"],
        "company_address": pub["company_address"],
        "social_links": pub["social_links"],
        "font_stack": f"'{body_font}', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    }


def render(name: str, context: dict[str, Any], branding: dict[str, Any], subject: str | None = None) -> Rendered:
    spec = TEMPLATES[name]
    brand = brand_context(branding)
    ctx: dict[str, Any] = {
        "brand": brand,
        "recipient_name": None,
        "action_url": None,
        "action_label": spec.action_label,
        "heading": spec.heading,
        "reason": spec.reason,
        "preheader": "",
        "email": "",
        **context,
    }
    if subject is None:
        subject = SUBJECTS[name].format(product=brand["product_name"], **{k: v for k, v in context.items()
                                                                           if isinstance(v, str)})
    if name == "admin_message":
        ctx["heading"] = context.get("heading") or subject
        ctx["body_html"] = render_markdown(context.get("body_markdown", ""), brand["accent"])
        ctx["body_text"] = markdown_to_text(context.get("body_markdown", ""))
        cta = context.get("cta") or None
        if cta:
            ctx["action_url"], ctx["action_label"] = cta["url"], cta["label"]
    ctx["subject"] = subject
    ctx.setdefault("preheader", "")
    if not ctx["preheader"]:
        ctx["preheader"] = {
            "verify_email": "One click to confirm your email address.",
            "password_reset": "Use this link to choose a new password.",
            "invitation": f"Join {context.get('business_name', 'the team')}.",
            "welcome": "Your account is ready — here's how to get started.",
            "password_changed": "Security notice about your account.",
            "login_code": f"Your code is {context.get('code', '')}. It expires in {context.get('expires_minutes', 10)} minutes.",
            "digital_card_invite": f"Accept your {context.get('business_name', 'company')} digital card.",
        }.get(name, ctx.get("body_text", "")[:120])
    html = _html_env.get_template(f"{name}.html").render(**ctx)
    text = _text_env.get_template(f"{name}.txt").render(**ctx)
    return Rendered(subject=subject, html=html, text=text.strip() + "\n")


def redact(content: str, secrets: list[str]) -> str:
    """Removes one-time links (raw and HTML-escaped) from stored copies."""
    import html as html_lib

    for secret in secrets:
        if not secret:
            continue
        for variant in {secret, html_lib.escape(secret), html_lib.escape(secret, quote=False)}:
            content = content.replace(variant, LINK_REMOVED)
    return content


def sample_context(name: str) -> dict[str, Any]:
    from app.core.config import settings

    web = settings.public_web_url
    return {
        "verify_email": {"recipient_name": "Alex", "email": "alex@example.com", "expires_hours": 48,
                         "action_url": f"{web}/verify-email?token=SAMPLE_TOKEN"},
        "password_reset": {"recipient_name": "Alex", "expires_minutes": 60,
                           "action_url": f"{web}/reset-password?token=SAMPLE_TOKEN"},
        "invitation": {"recipient_name": None, "business_name": "Acme Café", "role": "manager",
                       "inviter_name": "Grace Mukamana", "action_url": f"{web}/invite/SAMPLE_TOKEN"},
        "welcome": {"recipient_name": "Alex", "account_type": "developer", "action_url": f"{web}/dashboard"},
        "admin_message": {"recipient_name": "Alex", "body_markdown":
                          "We're rolling out **scheduled maintenance** on Saturday.\n\n"
                          "- Dashboard read-only for ~10 minutes\n- Deliveries are queued, nothing is lost\n\n"
                          "Questions? Just reply to this email.",
                          "cta": {"label": "View status page", "url": f"{web}/status"}},
        "digital_card_invite": {"recipient_name": None, "business_name": "Acme Café", "employee_name": "John Doe",
                                "action_url": f"{web}/register?card_invite=SAMPLE_TOKEN"},
        "login_code": {"recipient_name": "Alex", "code": "482913", "expires_minutes": 10, "device_name": "Chrome on Computer",
                       "signs_out": "Safari on iPhone"},
        "password_changed": {"recipient_name": "Alex", "email": "alex@example.com",
                             "changed_at": "2026-09-25 08:30 UTC", "reset_url": f"{web}/forgot-password"},
    }[name]
