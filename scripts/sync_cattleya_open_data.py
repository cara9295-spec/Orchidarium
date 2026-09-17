#!/usr/bin/env python3
"""Build Orchidarium's Cattleya catalogue from open, traceable sources.

Sources:
- GBIF Species API: accepted names, authorship, taxon keys, synonyms.
- GBIF Occurrence API: openly licensed occurrence media.
- Wikimedia Commons Action API: openly licensed reference images.

The script never invents descriptive fields. Missing values remain null/empty and all
media records retain source, creator and licence metadata.
"""

from __future__ import annotations

import html
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

GBIF = "https://api.gbif.org/v1"
COMMONS = "https://commons.wikimedia.org/w/api.php"
GENUS_KEY = 2800821  # Cattleya Lindl. in the GBIF backbone
OUT = Path("data")
ALLOWED_LICENSE_MARKERS = (
    "CC0",
    "CC BY",
    "CC-BY",
    "CC BY-SA",
    "CC-BY-SA",
    "PUBLIC DOMAIN",
    "PDM",
)


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": "Orchidarium/0.1 (open biodiversity data integration)"})
    return s


def get_json(s: requests.Session, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    r = s.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def clean_html(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text or None


def licence_allowed(value: str | None) -> bool:
    if not value:
        return False
    upper = value.upper()
    return any(marker in upper for marker in ALLOWED_LICENSE_MARKERS)


def gbif_species(s: requests.Session) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = 0
    limit = 300
    while True:
        payload = get_json(
            s,
            f"{GBIF}/species/search",
            {
                "highertaxon_key": GENUS_KEY,
                "rank": "SPECIES",
                "status": "ACCEPTED",
                "limit": limit,
                "offset": offset,
            },
        )
        records.extend(payload.get("results", []))
        if payload.get("endOfRecords", True):
            break
        offset += limit
    # Deduplicate backbone usages and retain true Cattleya combinations only.
    unique: dict[int, dict[str, Any]] = {}
    for row in records:
        key = row.get("nubKey") or row.get("key")
        canonical = row.get("canonicalName") or ""
        if key and canonical.startswith("Cattleya "):
            unique[int(key)] = row
    return sorted(unique.values(), key=lambda x: (x.get("canonicalName") or ""))


def gbif_synonyms(s: requests.Session, key: int) -> list[dict[str, Any]]:
    payload = get_json(s, f"{GBIF}/species/{key}/synonyms", {"limit": 1000})
    return [
        {
            "scientificName": x.get("scientificName"),
            "canonicalName": x.get("canonicalName"),
            "authorship": x.get("authorship"),
            "taxonomicStatus": x.get("taxonomicStatus") or x.get("status"),
            "gbifKey": x.get("key"),
        }
        for x in payload.get("results", [])
    ]


def gbif_images(s: requests.Session, taxon_key: int, scientific_name: str, maximum: int = 3) -> list[dict[str, Any]]:
    payload = get_json(
        s,
        f"{GBIF}/occurrence/search",
        {
            "taxon_key": taxon_key,
            "media_type": "StillImage",
            "limit": 100,
        },
    )
    images: list[dict[str, Any]] = []
    seen: set[str] = set()
    for occurrence in payload.get("results", []):
        for media in occurrence.get("media", []) or []:
            url = media.get("identifier") or media.get("references")
            licence = media.get("license") or occurrence.get("license")
            if not url or url in seen or not licence_allowed(licence):
                continue
            seen.add(url)
            images.append(
                {
                    "source": "GBIF occurrence media",
                    "scientificName": scientific_name,
                    "url": url,
                    "thumbnailUrl": media.get("identifier"),
                    "sourceUrl": occurrence.get("references") or f"https://www.gbif.org/occurrence/{occurrence.get('key')}",
                    "creator": media.get("creator") or occurrence.get("recordedBy"),
                    "licence": licence,
                    "rightsHolder": media.get("rightsHolder") or occurrence.get("rightsHolder"),
                    "occurrenceKey": occurrence.get("key"),
                    "countryCode": occurrence.get("countryCode"),
                    "year": occurrence.get("year"),
                    "type": media.get("type"),
                }
            )
            if len(images) >= maximum:
                return images
    return images


def commons_images(s: requests.Session, scientific_name: str, maximum: int = 2) -> list[dict[str, Any]]:
    payload = get_json(
        s,
        COMMONS,
        {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f'intitle:"{scientific_name}" filetype:bitmap',
            "gsrnamespace": 6,
            "gsrlimit": 10,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|mime|size",
            "iiurlwidth": 1200,
            "iiextmetadatafilter": "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|ImageDescription|AttributionRequired|Copyrighted",
        },
    )
    images: list[dict[str, Any]] = []
    pages = (payload.get("query") or {}).get("pages") or {}
    for page in pages.values():
        info_list = page.get("imageinfo") or []
        if not info_list:
            continue
        info = info_list[0]
        meta = info.get("extmetadata") or {}
        licence = (meta.get("LicenseShortName") or {}).get("value") or (meta.get("UsageTerms") or {}).get("value")
        if not licence_allowed(licence):
            continue
        images.append(
            {
                "source": "Wikimedia Commons",
                "scientificName": scientific_name,
                "title": page.get("title"),
                "url": info.get("url"),
                "thumbnailUrl": info.get("thumburl") or info.get("url"),
                "sourceUrl": info.get("descriptionurl"),
                "creator": clean_html((meta.get("Artist") or {}).get("value")),
                "credit": clean_html((meta.get("Credit") or {}).get("value")),
                "licence": clean_html(licence),
                "licenceUrl": (meta.get("LicenseUrl") or {}).get("value"),
                "description": clean_html((meta.get("ImageDescription") or {}).get("value")),
                "width": info.get("width"),
                "height": info.get("height"),
                "mime": info.get("mime"),
            }
        )
        if len(images) >= maximum:
            break
    return images


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = session()
    species = gbif_species(s)
    records: list[dict[str, Any]] = []
    media_index: list[dict[str, Any]] = []

    for index, row in enumerate(species, start=1):
        key = int(row.get("nubKey") or row["key"])
        name = row.get("canonicalName") or row.get("scientificName")
        synonyms = gbif_synonyms(s, key)
        gbif_media = gbif_images(s, key, name)
        commons_media = commons_images(s, name)
        media = gbif_media + commons_media
        media_index.extend({"taxonKey": key, **m} for m in media)

        records.append(
            {
                "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "entityType": "species",
                "taxonomy": {
                    "scientificName": row.get("scientificName"),
                    "canonicalName": name,
                    "authorship": row.get("authorship"),
                    "genus": row.get("genus"),
                    "specificEpithet": row.get("specificEpithet"),
                    "rank": row.get("rank"),
                    "taxonomicStatus": row.get("taxonomicStatus") or row.get("status"),
                    "gbifTaxonKey": key,
                    "kingdom": row.get("kingdom"),
                    "phylum": row.get("phylum"),
                    "class": row.get("class"),
                    "order": row.get("order"),
                    "family": row.get("family"),
                    "synonyms": synonyms,
                },
                "distribution": {
                    "countries": [],
                    "regions": [],
                    "altitudeMinM": None,
                    "altitudeMaxM": None,
                    "habitat": None,
                    "map": {
                        "provider": "GBIF Maps API v2 / species page",
                        "taxonKey": key,
                        "url": f"https://www.gbif.org/species/{key}",
                    },
                },
                "morphology": {},
                "cultivation": {},
                "hybridization": {},
                "media": media,
                "links": {
                    "gbif": f"https://www.gbif.org/species/{key}",
                    "powoSearch": f"https://powo.science.kew.org/results?q={quote(name)}",
                    "ipniSearch": f"https://www.ipni.org/?q={quote(name)}",
                    "commonsSearch": f"https://commons.wikimedia.org/w/index.php?search={quote(name)}&title=Special:MediaSearch&type=image",
                },
                "provenance": {
                    "taxonomySource": "GBIF Backbone Taxonomy",
                    "retrievedAt": datetime.now(timezone.utc).isoformat(),
                    "reviewStatus": "automatically-ingested-needs-editorial-review",
                    "dataPolicy": "No inferred morphology, cultivation or distribution fields.",
                },
            }
        )
        print(f"[{index}/{len(species)}] {name}: {len(synonyms)} synonyms, {len(media)} open images")
        time.sleep(0.08)

    generated = datetime.now(timezone.utc).isoformat()
    catalogue = {
        "metadata": {
            "title": "Orchidarium automated Cattleya open-data catalogue",
            "generatedAt": generated,
            "recordCount": len(records),
            "genusGbifKey": GENUS_KEY,
            "sources": ["GBIF Species API", "GBIF Occurrence API", "Wikimedia Commons Action API"],
            "reviewStatus": "machine-ingested; editorial validation required",
        },
        "records": records,
    }
    media_catalogue = {
        "metadata": {
            "title": "Orchidarium licensed media index — Cattleya",
            "generatedAt": generated,
            "recordCount": len(media_index),
            "licenceRule": "Only records with explicit CC0, CC BY, CC BY-SA or Public Domain markers are retained.",
        },
        "records": media_index,
    }
    (OUT / "cattleya_open_catalog.json").write_text(json.dumps(catalogue, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "cattleya_open_media.json").write_text(json.dumps(media_catalogue, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} species and {len(media_index)} licensed media records.")


if __name__ == "__main__":
    build()
