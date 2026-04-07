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

    if getattr(settings, "USE_SINGLE_DATABASE_MULTITENANT", True):
        # Одна строка подключения для всех slug — изоляция по company_slug в таблицах
        u = km
        return {"kelyanmedia": u, "whiteway": u, "enter_group_media": u}

    use_derived = settings.DATABASE_SEPARATE_DBS or bool(ww_opt) or bool(eg_opt)

    if is_pg:
        if use_derived:
            ww = ww_opt or _swap_postgres_dbname(base, "enterdebt_whiteway")
            eg = eg_opt or _swap_postgres_dbname(base, "enterdebt_enter_group_media")
        else:
            ww = ww_opt or km
            eg = eg_opt or km
    elif use_derived:
        ww = ww_opt or "sqlite:///./data_whiteway.db"
        eg = eg_opt or "sqlite:///./data_enter_group_media.db"
    else:
        ww = ww_opt or km
        eg = eg_opt or km

    urls = {"kelyanmedia": km, "whiteway": ww, "enter_group_media": eg}
    if urls["kelyanmedia"] == urls["whiteway"] == urls["enter_group_media"]:
        log.warning(
            "Все три компании указывают на один и тот же DATABASE_URL — данные не изолированы. "
            "Для раздельных БД задайте DATABASE_URL_WHITEWAY / DATABASE_URL_ENTER_GROUP_MEDIA "
            "или DATABASE_SEPARATE_DBS=true и создайте базы enterdebt_whiteway и enterdebt_enter_group_media."
        )
    return urls


def _mask_database_url(url: str) -> str:
    try:
        u = urlparse(url)
        if u.password and u.hostname:
            user = u.username or ""
            port = f":{u.port}" if u.port else ""
            netloc = f"{user}:****@{u.hostname}{port}"
            return urlunparse((u.scheme, netloc, u.path or "", u.params, u.query, u.fragment))
    except Exception:
        pass
    return url


def log_company_database_binding() -> None:
    masked = {slug: _mask_database_url(u) for slug, u in _COMPANY_URLS.items()}
    log.info("БД по компаниям (пароль скрыт): %s", masked)
    uniq = set(_COMPANY_URLS.values())
    if len(uniq) != 1:
        return
    if getattr(settings, "USE_SINGLE_DATABASE_MULTITENANT", True):
        log.info(
            "Режим single-DB multi-tenant: одна база, изоляция по company_slug (заголовок X-Company-Slug)."
        )
        return
    base = (settings.DATABASE_URL or "").strip().lower()
    is_pg = "postgresql" in base or base.startswith("postgres:")
    if not is_pg:
        return
    log.error(
        "ENTERDEBT: kelyanmedia, whiteway и enter_group_media используют ОДНУ PostgreSQL-базу — "
        "переключатель компании в панели не изолирует данные. "
        "Исправление: в .env на сервере задайте DATABASE_SEPARATE_DBS=true "
        "(и создайте БД enterdebt_whiteway и enterdebt_enter_group_media тем же пользователем, что и основная БД) "
        "или укажите отдельные DATABASE_URL_WHITEWAY и DATABASE_URL_ENTER_GROUP_MEDIA. "
        "После перезапуска таблицы создадутся в каждой базе автоматически."
    )


_COMPANY_URLS = _build_company_urls()
_engines: Dict[str, object] = {}
_sessionmakers: Dict[str, Any] = {}

if getattr(settings, "USE_SINGLE_DATABASE_MULTITENANT", True):
    _single_url = _COMPANY_URLS.get("kelyanmedia") or next(iter(_COMPANY_URLS.values()))
    _eng = create_engine(_single_url, pool_pre_ping=True)
    _sm = sessionmaker(autocommit=False, autoflush=False, bind=_eng)
    for _slug in COMPANY_SLUG_ORDER:
        if _slug in _COMPANY_URLS:
            _engines[_slug] = _eng
            _sessionmakers[_slug] = _sm
else:
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
    seen = set()
    for s in COMPANY_SLUG_ORDER:
        if s in _engines:
            e = _engines[s]
            if id(e) not in seen:
                seen.add(id(e))
                yield s, e


def iter_company_sessionmakers() -> Iterator[Tuple[str, Any]]:
    seen = set()
    for s in COMPANY_SLUG_ORDER:
        if s in _sessionmakers:
            sm = _sessionmakers[s]
            if id(sm) not in seen:
                seen.add(id(sm))
                yield s, sm


def is_registered_company_slug(slug: str) -> bool:
    return slug in _engines


def iter_registered_company_slugs() -> Iterator[str]:
    """Все slug с зарегистрированной сессией (для сидов в single-DB — по одному разу на компанию)."""
    for s in COMPANY_SLUG_ORDER:
        if s in _sessionmakers:
            yield s


def get_engine_for_slug(slug: str) -> object:
    if slug not in _engines:
        raise RuntimeError(f"No engine for company slug: {slug}")
    return _engines[slug]


def set_company_context(slug: str) -> Token:
    return _company_ctx.set(normalize_company_slug(slug))


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
    seen = set()
    for _, eng in iter_company_engines():
        if id(eng) in seen:
            continue
        seen.add(id(eng))
        Base.metadata.create_all(bind=eng)


def open_request_company_session() -> Session:
    slug = get_request_company()
    if slug not in _sessionmakers:
        raise RuntimeError(f"No database for company slug: {slug}")
    return _sessionmakers[slug]()
