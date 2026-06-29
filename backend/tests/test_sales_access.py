"""Проверка прав CRM: МОП, РОП, can_view_crm vs can_view_sales."""
from types import SimpleNamespace

from app.services.sales_access import (
    deal_visible_for_user,
    has_crm_pipeline_access,
    has_sales_companies_access,
    is_sales_rop,
    normalize_deal_scope,
)


def _user(**kw):
    defaults = dict(
        id=1,
        role="manager",
        is_sales_rop=False,
        can_view_sales=False,
        can_view_crm=False,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def test_mop_has_pipeline_and_companies():
    u = _user(role="mop")
    assert has_crm_pipeline_access(u)
    assert has_sales_companies_access(u)


def test_crm_only_manager_no_companies():
    u = _user(role="manager", can_view_crm=True, can_view_sales=False)
    assert has_crm_pipeline_access(u)
    assert not has_sales_companies_access(u)


def test_sales_flag_opens_companies():
    u = _user(role="manager", can_view_crm=False, can_view_sales=True)
    assert not has_crm_pipeline_access(u)
    assert has_sales_companies_access(u)


def test_rop_scope_and_team_deals():
    rop = _user(id=10, role="manager", is_sales_rop=True)
    assert is_sales_rop(rop)
    assert normalize_deal_scope(None, rop) == "team"
    assert normalize_deal_scope("mine", rop) == "mine"

    own = SimpleNamespace(id=1, assigned_user_id=10)
    team = SimpleNamespace(id=2, assigned_user_id=20)
    other = SimpleNamespace(id=3, assigned_user_id=99)
    mop_ids = {10, 20}

    assert deal_visible_for_user(own, rop, mop_ids, "team") is False
    assert deal_visible_for_user(team, rop, mop_ids, "team") is True
    assert deal_visible_for_user(other, rop, mop_ids, "team") is False
    assert deal_visible_for_user(own, rop, mop_ids, "mine") is True
