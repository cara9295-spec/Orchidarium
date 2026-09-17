#!/usr/bin/env python3
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
CONFIG = ROOT / "data" / "genera.json"
OUT_DIR = ROOT / "data" / "genera"
MASTER_JSON = ROOT / "data" / "orchid_master_catalog.json"
MASTER_CSV = ROOT / "data" / "orchid_master_catalog.csv"
USER_AGENT = "Orchidarium/1.1 (https://github.com/cara9295-spec/Orchidarium)"


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
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        payload = get_json(path, {**params, "limit": page_size, "offset": offset})
        batch = payload.get("results", [])
        rows.extend(batch)
        if payload.get("endOfRecords", True) or not batch:
            return rows
        offset += len(batch)


def compact_name(row: dict[str, Any]) -> str:
    return row.get("canonicalName") or row.get("scientificName") or ""


def build_genus(genus: str) -> dict[str, Any]:
    match = get_json("/species/match", {"name": genus, "rank": "GENUS", "strict": "true"})
    genus_key = match.get("usageKey") or match.get("acceptedUsageKey")
    if not genus_key:
        raise RuntimeError(f"GBIF did not resolve genus {genus}")

    raw = all_pages(
        "/species/search",
        {
            "highertaxon_key": genus_key,
            "status": "ACCEPTED",
            "rank": ["SPECIES", "SUBSPECIES", "VARIETY", "FORM"],
        },
    )

    taxa: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row in raw:
        key = row.get("key")
        if not key or key in seen:
            continue
        seen.add(key)
        name = compact_name(row)
        if not name.startswith(genus + " "):
            continue

        synonyms = get_json(f"/species/{key}/synonyms").get("results", [])
        vernacular = get_json(f"/species/{key}/vernacularNames").get("results", [])
        distributions = get_json(f"/species/{key}/distributions").get("results", [])
        occurrence = get_json("/occurrence/search", {"taxon_key": key, "limit": 0})

        taxa.append({
            "gbifKey": key,
            "scientificName": row.get("scientificName"),
            "canonicalName": name,
            "authorship": row.get("authorship"),
            "rank": row.get("rank"),
            "taxonomicStatus": row.get("taxonomicStatus") or row.get("status"),
            "acceptedName": row.get("accepted") or row.get("scientificName"),
            "species": row.get("species"),
            "genus": row.get("genus") or genus,
            "family": row.get("family"),
            "synonyms": sorted({compact_name(s) for s in synonyms if compact_name(s)}),
            "vernacularNames": sorted({v.get("vernacularName") for v in vernacular if v.get("vernacularName")}),
            "countries": sorted({d.get("country") for d in distributions if d.get("country")}),
            "occurrenceCount": occurrence.get("count", 0),
            "links": {
                "gbif": f"https://www.gbif.org/species/{key}",
                "powoSearch": "https://powo.science.kew.org/results?q=" + name.replace(" ", "%20"),
                "ipniSearch": "https://www.ipni.org/?q=" + name.replace(" ", "%20"),
            },
            "source": "GBIF Backbone Taxonomy and related GBIF API endpoints",
        })
        time.sleep(0.05)

    taxa.sort(key=lambda x: (x["canonicalName"].lower(), x.get("rank") or ""))
    return {
        "metadata": {
            "genus": genus,
            "genusKey": genus_key,
            "recordCount": len(taxa),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "GBIF public API",
            "scopeNote": "Automated catalogue; verify accepted names against Kew POWO/WCVP before editorial publication.",
        },
        "taxa": taxa,
    }


def write_catalog(path: Path, catalog: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    genera = [g["name"] for g in config["genera"] if g.get("enabled")]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    master_taxa: list[dict[str, Any]] = []
    summaries = []
    for genus in genera:
        print(f"Building {genus}…", flush=True)
        catalog = build_genus(genus)
        write_catalog(OUT_DIR / f"{genus.lower()}.json", catalog)
        master_taxa.extend(catalog["taxa"])
        summaries.append({
            "genus": genus,
            "recordCount": catalog["metadata"]["recordCount"],
            "genusKey": catalog["metadata"]["genusKey"],
        })

    master_taxa.sort(key=lambda x: (x.get("genus", ""), x["canonicalName"].lower()))
    master = {
        "metadata": {
            "title": "Orchidarium master orchid catalogue",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "recordCount": len(master_taxa),
            "genusCount": len(genera),
            "genera": summaries,
            "source": "GBIF public API",
        },
        "taxa": master_taxa,
    }
    write_catalog(MASTER_JSON, master)

    fields = ["gbifKey", "genus", "canonicalName", "scientificName", "authorship", "rank", "taxonomicStatus", "countries", "synonyms", "vernacularNames", "occurrenceCount", "gbifUrl", "powoSearchUrl", "ipniSearchUrl"]
    with MASTER_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for taxon in master_taxa:
            writer.writerow({
                "gbifKey": taxon["gbifKey"],
                "genus": taxon.get("genus"),
                "canonicalName": taxon["canonicalName"],
                "scientificName": taxon.get("scientificName"),
                "authorship": taxon.get("authorship"),
                "rank": taxon.get("rank"),
                "taxonomicStatus": taxon.get("taxonomicStatus"),
                "countries": " | ".join(taxon.get("countries", [])),
                "synonyms": " | ".join(taxon.get("synonyms", [])),
                "vernacularNames": " | ".join(taxon.get("vernacularNames", [])),
                "occurrenceCount": taxon.get("occurrenceCount", 0),
                "gbifUrl": taxon["links"]["gbif"],
                "powoSearchUrl": taxon["links"]["powoSearch"],
                "ipniSearchUrl": taxon["links"]["ipniSearch"],
            })

    print(f"Wrote {len(master_taxa)} records across {len(genera)} genera")


if __name__ == "__main__":
    main()
