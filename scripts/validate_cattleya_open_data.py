#!/usr/bin/env python3
"""Validate generated Cattleya catalogue and media index before publication."""
import json
import re
from collections import Counter
from pathlib import Path

DATA = Path("data")
catalogue = json.loads((DATA / "cattleya_open_catalog.json").read_text(encoding="utf-8"))
media = json.loads((DATA / "cattleya_open_media.json").read_text(encoding="utf-8"))
species = catalogue["records"]
photos = media["records"]
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

require(bool(species), "Species catalogue is empty")
require(bool(photos), "Media index is empty; refusing to replace the published images")
require(catalogue["metadata"]["recordCount"] == len(species), "Species metadata count mismatch")
require(media["metadata"]["recordCount"] == len(photos), "Media metadata count mismatch")
keys = [row.get("taxonomy", {}).get("gbifTaxonKey") for row in species]
require(all(keys), "Missing GBIF taxon key")
require(len(keys) == len(set(keys)), "Duplicate GBIF taxon keys")
key_set = set(keys)
urls = []
embedded = Counter()
indexed = Counter()
unattributed = 0
for row in species:
    taxon = row.get("taxonomy", {})
    require(bool(taxon.get("canonicalName")), "Missing canonical species name")
    for item in row.get("media", []):
        embedded[(taxon.get("gbifTaxonKey"), item.get("url"))] += 1
for item in photos:
    key, url = item.get("taxonKey"), item.get("url")
    require(key in key_set, f"Orphan media taxon key: {key}")
    require(bool(url and item.get("sourceUrl") and item.get("licence")), f"Missing media URL/source/licence: {key}")
    licence = (item.get("licence") or "").upper()
    require(not re.search(r"\b(NC|ND|NONCOMMERCIAL|NO DERIVATIVES)\b", licence), f"Restricted licence: {url}")
    require(bool(re.search(r"CC\s*0\b|CC[- ]BY(?:[- ]SA)?\b|PUBLIC DOMAIN|\bPDM\b", licence)), f"Unrecognized licence: {url}")
    if not (item.get("creator") or item.get("rightsHolder") or item.get("credit")):
        unattributed += 1
    urls.append(url)
    indexed[(key, url)] += 1
require(len(urls) == len(set(urls)), "Duplicate image URLs")
require(embedded == indexed, "Media embedded in catalogue differs from media index")
if errors:
    raise SystemExit("Cattleya validation FAILED:\n- " + "\n- ".join(errors))
print(f"Cattleya validation OK: {len(species)} species; {len(photos)} licensed media; "
      f"{len(set(item['taxonKey'] for item in photos))} species with images; "
      f"{unattributed} media records missing creator/credit (review required).")
