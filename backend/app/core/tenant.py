"""Multi-tenant: одна БД, изоляция по колонке company_slug (совпадает с X-Company-Slug)."""

from typing import Type, TypeVar

from sqlalchemy.orm import Query
from sqlalchemy.sql import ColumnElement

from app.db.database import get_request_company

T = TypeVar("T")


def current_company_slug() -> str:
    return get_request_company()


def filter_by_company(query: Query, model: Type[T]) -> Query:
    """Добавляет .filter(model.company_slug == текущая компания), если у модели есть поле company_slug."""
    if not hasattr(model, "company_slug"):
        return query
    return query.filter(model.company_slug == current_company_slug())
