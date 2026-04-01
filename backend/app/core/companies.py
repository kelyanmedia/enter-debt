"""Справочник компаний (slug → отображаемое имя). Slug совпадает с ключами в multi-DB."""

from typing import Dict, Optional, Tuple

COMPANY_LABELS: Dict[str, str] = {
    "kelyanmedia": "KelyanMedia",
    "whiteway": "WhiteWay",
    "enter_group_media": "Enter Group Media",
}

# Порядок в UI и при перечислении движков
COMPANY_SLUG_ORDER: Tuple[str, ...] = ("kelyanmedia", "whiteway", "enter_group_media")


def normalize_company_slug(raw: Optional[str]) -> str:
    """Заголовок X-Company-Slug → внутренний slug. Пусто = KelyanMedia (бот и старые клиенты)."""
    if raw is None or not str(raw).strip():
        return "kelyanmedia"
    s = str(raw).strip().lower().replace("-", "_")
    aliases = {
        "enter": "enter_group_media",
        "egm": "enter_group_media",
        "entergroup": "enter_group_media",
        "enter_group": "enter_group_media",
    }
    return aliases.get(s, s)
