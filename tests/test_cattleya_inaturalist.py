"""Offline regression tests for the iNaturalist image fallback."""
import unittest
from unittest.mock import patch

from scripts import sync_cattleya_open_data as sync


class InaturalistPhotoTests(unittest.TestCase):
    def test_only_exact_species_with_photo_level_open_licence(self):
        payload = {
            "results": [
                {
                    "id": 1,
                    "taxon": {"name": "Cattleya other", "rank": "species"},
                    "photos": [{"id": 11, "url": "https://example.org/wrong.jpg", "license_code": "cc-by"}],
                },
                {
                    "id": 2,
                    "taxon": {"name": "Cattleya trianae", "rank": "species"},
                    "photos": [
                        {"id": 21, "url": "https://example.org/restricted.jpg", "license_code": "cc-by-nc"},
                        {"id": 22, "url": "https://example.org/open.jpg", "license_code": "cc-by-sa", "attribution": "Botanical photographer"},
                    ],
                    "quality_grade": "research",
                },
            ]
        }
        with patch.object(sync, "get_json", return_value=payload) as request:
            result = sync.inaturalist_images(object(), "Cattleya trianae")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["url"], "https://example.org/open.jpg")
        self.assertEqual(result[0]["licence"], "CC-BY-SA")
        self.assertEqual(result[0]["creator"], "Botanical photographer")
        self.assertEqual(result[0]["sourceUrl"], "https://www.inaturalist.org/observations/2")
        self.assertEqual(request.call_args.args[1], sync.INATURALIST)
        self.assertEqual(request.call_args.args[2]["photo_license"], "cc0,cc-by,cc-by-sa")

    def test_no_photo_level_licence_means_no_image(self):
        payload = {"results": [{
            "id": 3, "taxon": {"name": "Cattleya trianae", "rank": "species"},
            "license_code": "cc-by",
            "photos": [{"url": "https://example.org/unlicensed.jpg", "license_code": None}],
        }]}
        with patch.object(sync, "get_json", return_value=payload):
            self.assertEqual(sync.inaturalist_images(object(), "Cattleya trianae"), [])

    def test_reject_restricted_licences(self):
        for value in ("CC BY-NC 4.0", "CC-BY-ND", "All rights reserved"):
            self.assertFalse(sync.licence_allowed(value))
        for value in ("CC0", "CC BY 4.0", "CC-BY-SA", "Public domain"):
            self.assertTrue(sync.licence_allowed(value))


if __name__ == "__main__":
    unittest.main()
