"""Справочник GEO клиентов для CRM-сделок и аналитики."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

DEFAULT_CLIENT_GEO = "UZ"

CLIENT_GEO: Dict[str, Dict[str, Any]] = {
    "UZ": {"name": "Узбекистан", "lat": 41.38, "lng": 64.59},
    "KZ": {"name": "Казахстан", "lat": 48.02, "lng": 66.92},
    "RU": {"name": "Россия", "lat": 55.76, "lng": 37.62},
    "KG": {"name": "Кыргызстан", "lat": 41.20, "lng": 74.77},
    "TJ": {"name": "Таджикистан", "lat": 38.86, "lng": 71.28},
    "TM": {"name": "Туркменистан", "lat": 37.96, "lng": 58.33},
    "AZ": {"name": "Азербайджан", "lat": 40.41, "lng": 49.87},
    "TR": {"name": "Турция", "lat": 39.93, "lng": 32.86},
    "AE": {"name": "ОАЭ", "lat": 23.42, "lng": 53.85},
    "SA": {"name": "Саудовская Аравия", "lat": 23.89, "lng": 45.08},
    "DE": {"name": "Германия", "lat": 51.17, "lng": 10.45},
    "US": {"name": "США", "lat": 37.09, "lng": -95.71},
    "CA": {"name": "Канада", "lat": 56.13, "lng": -106.35},
    "AU": {"name": "Австралия", "lat": -25.27, "lng": 133.78},
    "NP": {"name": "Непал", "lat": 28.39, "lng": 84.12},
    "CN": {"name": "Китай", "lat": 35.86, "lng": 104.20},
    "IN": {"name": "Индия", "lat": 20.59, "lng": 78.96},
    "GB": {"name": "Великобритания", "lat": 55.38, "lng": -3.44},
    "FR": {"name": "Франция", "lat": 46.23, "lng": 2.21},
    "OTHER": {"name": "Другое", "lat": 20.0, "lng": 0.0},
}


def normalize_client_geo(value: Optional[str]) -> str:
    code = (value or DEFAULT_CLIENT_GEO).strip().upper()
    if code not in CLIENT_GEO:
        return DEFAULT_CLIENT_GEO
    return code


def geo_meta(code: str) -> Tuple[str, float, float]:
    row = CLIENT_GEO.get(code, CLIENT_GEO[DEFAULT_CLIENT_GEO])
    return str(row["name"]), float(row["lat"]), float(row["lng"])
