#!/usr/bin/env python3
"""Build a consultable Cattleya catalogue from the GBIF public API.

The script resolves the genus, retrieves accepted species and infraspecific taxa,
adds synonyms, vernacular names, distributions and occurrence counts, and writes
JSON/CSV outputs for Orchidarium.
"""
from __future__ import annotations

import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://api.gbif.org/v1"
ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "data" / "cattleya_catalog.json"
OUT_CSV = ROOT / "data" / "cattleya_catalog.csv"
USER_AGENT = "Orchidarium/1.0 (https://github.com/cara9295-spec/Orchidarium)"


def get_json(path: str, params: dict[str, Any] | None = None, retries: int = 3) -> Any:
    url = f"{API}{path}"
    if params:
        url += "?" + urlencode(params, doseq=True)
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(retries):
        try:
            with urlopen(req, timeout=45) as response:
                return json.load(response)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def all_pages(path: str, params: dict[str, Any], page_size: int = 300) -> list[dict[str, Any]]:
    offset = 0
    rows: list[dict[str, Any]] = []
    while True:
        payload = get_json(path, {**params, "limit": page_size, "offset": offset})
        batch = payload.get("results", [])
        rows.extend(batch)
        if payload.get("endOfRecords", True) or not batch:
            return rows
        offset += len(batch)


def compact_name(row: dict[str, Any]) -> str:
    return row.get("canonicalName") or row.get("scientificName") or ""


def build() -> dict[str, Any]:
    match = get_json("/species/match", {"name": "Cattleya", "rank": "GENUS", "strict": "true"})
    genus_key = match.get("usageKey") or match.get("acceptedUsageKey")
    if not genus_key:
        raise RuntimeError("GBIF did not resolve the genus Cattleya")

    raw = all_pages(
        "/species/search",
        {
            "highertaxon_key": genus_key,
            "status": "ACCEPTED",
            "rank": ["SPECIES", "SUBSPECIES", "VARIETY", "FORM"],
        },
    )

    taxa = []
    seen: set[int] = set()
    for row in raw:
        key = row.get("key")
        if not key or key in seen:
            continue
        seen.add(key)
        name = compact_name(row)
        if not name.startswith("Cattleya "):
            continue

        synonyms = get_json(f"/species/{key}/synonyms").get("results", [])
        vernacular = get_json(f"/species/{key}/vernacularNames").get("results", [])
        distributions = get_json(f"/species/{key}/distributions").get("results", [])
        occurrence = get_json("/occurrence/search", {"taxon_key": key, "limit": 0})

        countries = sorted({d.get("country") for d in distributions if d.get("country")})
        synonym_names = sorted({compact_name(s) for s in synonyms if compact_name(s)})
        common_names = sorted({v.get("vernacularName") for v in vernacular if v.get("vernacularName")})

        taxa.append(
            {
                "gbifKey": key,
                "scientificName": row.get("scientificName"),
                "canonicalName": name,
                "authorship": row.get("authorship"),
                "rank": row.get("rank"),
                "taxonomicStatus": row.get("taxonomicStatus") or row.get("status"),
                "acceptedName": row.get("accepted") or row.get("scientificName"),
                "species": row.get("species"),
                "genus": row.get("genus"),
                "family": row.get("family"),
                "synonyms": synonym_names,
                "vernacularNames": common_names,
                "countries": countries,
                "occurrenceCount": occurrence.get("count", 0),
                "links": {
                    "gbif": f"https://www.gbif.org/species/{key}",
                    "powoSearch": "https://powo.science.kew.org/results?q=" + name.replace(" ", "%20"),
                    "ipniSearch": "https://www.ipni.org/?q=" + name.replace(" ", "%20"),
                },
                "source": "GBIF Backbone Taxonomy and related GBIF API endpoints",
            }
        )
        time.sleep(0.08)

    taxa.sort(key=lambda x: (x["canonicalName"].lower(), x["rank"] or ""))
    generated = datetime.now(timezone.utc).isoformat()
    return {
        "metadata": {
            "title": "Orchidarium Cattleya catalogue",
            "generatedAt": generated,
            "genusKey": genus_key,
            "recordCount": len(taxa),
            "source": "GBIF public API",
            "sourceUrl": "https://www.gbif.org/developer/species",
            "scopeNote": "Automated catalogue; botanical names should be cross-checked against Kew POWO/WCVP before editorial publication.",
        },
        "taxa": taxa,
    }


def write_outputs(catalog: dict[str, Any]) -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    fields = [
        "gbifKey", "canonicalName", "scientificName", "authorship", "rank",
        "taxonomicStatus", "countries", "synonyms", "vernacularNames",
        "occurrenceCount", "gbifUrl", "powoSearchUrl", "ipniSearchUrl",
    ]
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for taxon in catalog["taxa"]:
            writer.writerow({
                "gbifKey": taxon["gbifKey"],
                "canonicalName": taxon["canonicalName"],
                "scientificName": taxon["scientificName"],
                "authorship": taxon["authorship"],
                "rank": taxon["rank"],
                "taxonomicStatus": taxon["taxonomicStatus"],
                "countries": " | ".join(taxon["countries"]),
                "synonyms": " | ".join(taxon["synonyms"]),
                "vernacularNames": " | ".join(taxon["vernacularNames"]),
                "occurrenceCount": taxon["occurrenceCount"],
                "gbifUrl": taxon["links"]["gbif"],
                "powoSearchUrl": taxon["links"]["powoSearch"],
                "ipniSearchUrl": taxon["links"]["ipniSearch"],
            })


if __name__ == "__main__":
    result = build()
    write_outputs(result)
    print(f"Wrote {result['metadata']['recordCount']} records to {OUT_JSON} and {OUT_CSV}")
