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

    def test_large_inaturalist_image_preserves_thumbnail(self):
        square = "https://inaturalist-open-data.s3.amazonaws.com/photos/42/square.jpeg"
        payload = {"results": [{
            "id": 42,
            "taxon": {"name": "Cattleya trianae", "rank": "species"},
            "photos": [{"id": 42, "url": square, "license_code": "cc-by"}],
            "quality_grade": "research",
        }]}
        with patch.object(sync, "get_json", return_value=payload):
            result = sync.inaturalist_images(object(), "Cattleya trianae")
        self.assertEqual(result[0]["url"], "https://inaturalist-open-data.s3.amazonaws.com/photos/42/large.jpeg")
        self.assertEqual(result[0]["thumbnailUrl"], square)
        self.assertEqual(sync.inaturalist_large_url("https://example.org/photos/42/square.jpeg"),
                         "https://example.org/photos/42/square.jpeg")

    def test_no_photo_level_licence_means_no_image(self):
        payload = {"results": [{
            "id": 3, "taxon": {"name": "Cattleya trianae", "rank": "species"},
            "license_code": "cc-by",
            "photos": [{"url": "https://example.org/unlicensed.jpg", "license_code": None}],
        }]}
        with patch.object(sync, "get_json", return_value=payload):
            self.assertEqual(sync.inaturalist_images(object(), "Cattleya trianae"), [])

    def test_commons_title_recheck_fetches_fresh_licences(self):
        """A prior Commons photo is recoverable only with a CURRENT open licence."""
        payload = {"query": {"pages": {
            "10": {
                "title": "File:Cattleya wilsoniana 298-1.jpg",
                "imageinfo": [{
                    "url": "https://upload.wikimedia.org/open.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Cattleya_wilsoniana_298-1.jpg",
                    "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 2.5 dk"}},
                }],
            },
            "11": {
                "title": "File:Cattleya wilsoniana restricted.jpg",
                "imageinfo": [{
                    "url": "https://upload.wikimedia.org/restricted.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Cattleya_wilsoniana_restricted.jpg",
                    "extmetadata": {"LicenseShortName": {"value": "CC BY-NC 4.0"}},
                }],
            },
        }}}
        titles = ["File:Cattleya wilsoniana 298-1.jpg",
                  "File:Cattleya wilsoniana restricted.jpg"]
        with patch.object(sync, "get_json", return_value=payload) as request:
            images = sync.commons_images(object(), "Cattleya wilsoniana", titles=titles)
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["licence"], "CC BY-SA 2.5 dk")
        self.assertEqual(request.call_args.args[2]["titles"], "|".join(titles))
        self.assertNotIn("generator", request.call_args.args[2])

    def test_reject_restricted_licences(self):
        for value in ("CC BY-NC 4.0", "CC-BY-ND", "All rights reserved"):
            self.assertFalse(sync.licence_allowed(value))
        for value in ("CC0", "CC BY 4.0", "CC-BY-SA", "Public domain"):
            self.assertTrue(sync.licence_allowed(value))


if __name__ == "__main__":
    unittest.main()
