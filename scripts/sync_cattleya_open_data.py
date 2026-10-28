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
INATURALIST = "https://api.inaturalist.org/v1/observations"
INAT_ALLOWED_LICENSES = {"cc0", "cc-by", "cc-by-sa"}
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
    upper = clean_html(value).upper().strip() if clean_html(value) else ""
    if re.search(r"\b(NC|ND|NONCOMMERCIAL|NO DERIVATIVES)\b", upper):
        return False
    return bool(re.search(r"CC\s*0\b|CC[- ]BY(?:[- ]SA)?(?:[- ]\d(?:\.\d)?)?\b|PUBLIC DOMAIN|\bPDM\b", upper))


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
            # Occurrence licences do not necessarily cover attached photographs.
            # Only ingest media with an explicit licence on the media object.
            licence = media.get("license")
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


def commons_images(
    s: requests.Session,
    scientific_name: str,
    maximum: int = 2,
    titles: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Search Commons or recheck previously indexed files by exact page title.

    Title lookups re-fetch the current file licence rather than trusting cached
    metadata when a transient search-index change hides a known photograph.
    """
    params: dict[str, Any] = {
        "action": "query",
        "format": "json",
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime|size",
        "iiurlwidth": 1200,
        "iiextmetadatafilter": "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|ImageDescription|AttributionRequired|Copyrighted",
    }
    if titles:
        params["titles"] = "|".join(titles)
    else:
        params.update({
            "generator": "search",
            "gsrsearch": f'intitle:"{scientific_name}" filetype:bitmap',
            "gsrnamespace": 6,
            "gsrlimit": 10,
        })
    payload = get_json(s, COMMONS, params)
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



def inaturalist_images(s: requests.Session, scientific_name: str, maximum: int = 1) -> list[dict[str, Any]]:
    """Find research-grade observations, accepting only photos with their own open licence.

    iNaturalist taxon names are checked against the exact requested species to
    avoid accidentally selecting another taxon or an infraspecific hybrid.
    """
    payload = get_json(
        s,
        INATURALIST,
        {
            "taxon_name": scientific_name,
            "quality_grade": "research",
            "photo_license": "cc0,cc-by,cc-by-sa",
            "per_page": 30,
            "order_by": "votes",
        },
    )
    images: list[dict[str, Any]] = []
    for observation in payload.get("results", []):
        taxon = observation.get("taxon") or {}
        if (
            (taxon.get("name") or "").casefold() != scientific_name.casefold()
            or taxon.get("rank") != "species"
        ):
            continue
        for photo in observation.get("photos") or []:
            licence = (photo.get("license_code") or "").strip().lower()
            url = photo.get("url")
            if licence not in INAT_ALLOWED_LICENSES or not url:
                continue
            images.append(
                {
                    "source": "iNaturalist",
                    "scientificName": scientific_name,
                    "url": url,
                    "thumbnailUrl": url,
                    "sourceUrl": observation.get("uri") or (
                        f"https://www.inaturalist.org/observations/{observation.get('id')}"
                    ),
                    "creator": photo.get("attribution") or (
                        (observation.get("user") or {}).get("login")
                    ),
                    "licence": licence.upper(),
                    "observationId": observation.get("id"),
                    "photoId": photo.get("id"),
                    "qualityGrade": observation.get("quality_grade"),
                    "reviewStatus": "automatically-ingested-needs-editorial-review",
                }
            )
            if len(images) >= maximum:
                return images
    return images


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = session()
    # Keep only Commons page titles as recovery candidates. Their current
    # licences are rechecked via the Commons API before any reuse.
    previous_commons_titles: dict[int, list[str]] = {}
    previous_index = OUT / "cattleya_open_media.json"
    if previous_index.exists():
        for item in json.loads(previous_index.read_text(encoding="utf-8")).get("records", []):
            if item.get("source") == "Wikimedia Commons" and item.get("title") and item.get("taxonKey"):
                previous_commons_titles.setdefault(int(item["taxonKey"]), []).append(item["title"])
    species = gbif_species(s)
    if not species:
        raise RuntimeError("GBIF returned zero accepted Cattleya species; refusing to publish empty catalogue")
    records: list[dict[str, Any]] = []
    media_index: list[dict[str, Any]] = []
    inat_attempted = 0
    inat_added = 0
    inat_errors = 0
    inat_disabled = False
    commons_recovered = 0

    for index, row in enumerate(species, start=1):
        key = int(row.get("nubKey") or row["key"])
        name = row.get("canonicalName") or row.get("scientificName")
        synonyms = gbif_synonyms(s, key)
        gbif_media = gbif_images(s, key, name)
        commons_media = commons_images(s, name)
        media = gbif_media + commons_media
        if not media and not inat_disabled:
            inat_attempted += 1
            try:
                found = inaturalist_images(s, name)
                media.extend(found)
                inat_added += len(found)
            except (requests.RequestException, ValueError) as exc:
                inat_errors += 1
                response = getattr(exc, "response", None)
                status = getattr(response, "status_code", None)
                print(f"WARNING: iNaturalist search failed for {name}: {exc}")
                if status in (403, 429):
                    inat_disabled = True
                    print("WARNING: iNaturalist access limited; skipping remaining lookups.")
            time.sleep(1.1)  # Respect iNaturalist's recommended API request rate.
        # Commons search is not stable: re-query known file titles when a taxon
        # would otherwise lose every photo. Do NOT reuse old licence metadata.
        if not media and previous_commons_titles.get(key):
            try:
                recovered = commons_images(
                    s, name, maximum=2, titles=previous_commons_titles[key][:20],
                )
                for item in recovered:
                    item["reviewStatus"] = "recovered-by-title-needs-editorial-review"
                media.extend(recovered)
                commons_recovered += len(recovered)
                if recovered:
                    print(f"Recovered {len(recovered)} currently licensed Commons images for {name} by title.")
            except (requests.RequestException, ValueError) as exc:
                print(f"WARNING: Commons title recheck failed for {name}: {exc}")
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
            "sources": ["GBIF Species API", "GBIF Occurrence API", "Wikimedia Commons Action API", "iNaturalist observations API"],
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
    covered = sum(bool(row["media"]) for row in records)
    print(f"Wrote {len(records)} species and {len(media_index)} licensed media records.")
    print(f"Image coverage: {covered}/{len(records)} species; {len(records) - covered} without images.")
    print(f"iNaturalist: {inat_attempted} lookups, {inat_added} licensed photos added, "
          f"{inat_errors} errors, disabled={inat_disabled}.")
    print(f"Commons title rechecks: {commons_recovered} currently licensed images recovered.")


if __name__ == "__main__":
    build()
