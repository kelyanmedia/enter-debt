import logging
from contextvars import ContextVar, Token
from typing import Any, Dict, Iterator, Optional, Tuple
from urllib.parse import urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from app.core.companies import COMPANY_SLUG_ORDER, normalize_company_slug
from app.core.config import settings

log = logging.getLogger(__name__)

Base = declarative_base()

_company_ctx: ContextVar[str] = ContextVar("company_slug", default="kelyanmedia")


def _swap_postgres_dbname(url: str, new_db: str) -> str:
    u = urlparse(url)
    return urlunparse((u.scheme, u.netloc, f"/{new_db}", u.params, u.query, u.fragment))


def _build_company_urls() -> Dict[str, str]:
    base = (settings.DATABASE_URL or "").strip()
    km = (settings.DATABASE_URL_KELYANMEDIA or "").strip() or base
    ww_opt = (settings.DATABASE_URL_WHITEWAY or "").strip()
    eg_opt = (settings.DATABASE_URL_ENTER_GROUP_MEDIA or "").strip()
    lower = base.lower()
    is_pg = "postgresql" in lower or lower.startswith("postgres:")

    if is_pg:
        ww = ww_opt or _swap_postgres_dbname(base, "enterdebt_whiteway")
        eg = eg_opt or _swap_postgres_dbname(base, "enterdebt_enter_group_media")
    else:
        ww = ww_opt or "sqlite:///./data_whiteway.db"
        eg = eg_opt or "sqlite:///./data_enter_group_media.db"

    urls = {"kelyanmedia": km, "whiteway": ww, "enter_group_media": eg}
    if urls["kelyanmedia"] == urls["whiteway"] == urls["enter_group_media"]:
        log.warning(
            "Все три компании указывают на один и тот же DATABASE_URL — данные не изолированы. "
            "Задайте DATABASE_URL_WHITEWAY и DATABASE_URL_ENTER_GROUP_MEDIA (или отдельные имена БД в PostgreSQL)."
        )
    return urls


_COMPANY_URLS = _build_company_urls()
_engines: Dict[str, object] = {}
_sessionmakers: Dict[str, sessionmaker] = {}

for _slug in COMPANY_SLUG_ORDER:
    _url = _COMPANY_URLS.get(_slug)
    if not _url:
        continue
    eng = create_engine(_url, pool_pre_ping=True)
    _engines[_slug] = eng
    _sessionmakers[_slug] = sessionmaker(autocommit=False, autoflush=False, bind=eng)

# Обратная совместимость: «основной» движок = KelyanMedia
engine = _engines.get("kelyanmedia") or next(iter(_engines.values()))


def iter_company_engines() -> Iterator[tuple[str, object]]:
    for s in COMPANY_SLUG_ORDER:
        if s in _engines:
            yield s, _engines[s]


def iter_company_sessionmakers() -> Iterator[Tuple[str, Any]]:
    for s in COMPANY_SLUG_ORDER:
        if s in _sessionmakers:
            yield s, _sessionmakers[s]


def is_registered_company_slug(slug: str) -> bool:
    return slug in _engines


def set_company_context(slug: str) -> Token:
    return _company_ctx.set(slug)


def reset_company_context(token: Token) -> None:
    _company_ctx.reset(token)


def get_request_company() -> str:
    return _company_ctx.get()


def get_db() -> Iterator[Session]:
    slug = get_request_company()
    if slug not in _sessionmakers:
        raise RuntimeError(f"No database for company slug: {slug}")
    SessionLocal = _sessionmakers[slug]
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    for _, eng in iter_company_engines():
        Base.metadata.create_all(bind=eng)


def open_request_company_session() -> Session:
    """Отдельная сессия для текущей компании (лента событий и т.п.)."""
    slug = get_request_company()
    if slug not in _sessionmakers:
        raise RuntimeError(f"No database for company slug: {slug}")
    return _sessionmakers[slug]()
