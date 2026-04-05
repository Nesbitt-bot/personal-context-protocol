import unittest

from src.pcp.protocol import (
    AccessMode,
    DataAsset,
    PersonalContextController,
    Sensitivity,
    TaskRequest,
    TrustTier,
)


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.assets = {
            "public": DataAsset("public", "hello world", Sensitivity.PUBLIC),
            "private": DataAsset("private", "private task routing notes", Sensitivity.PRIVATE),
            "secret": DataAsset("secret", "token=password-123", Sensitivity.SECRET),
        }
        self.controller = PersonalContextController(self.assets)

    def test_remote_request_gets_minimized_private_data(self):
        bundle = self.controller.request_context(TaskRequest(
            requester="remote-b",
            trust_tier=TrustTier.REMOTE,
            purpose="summarize",
            asset_ids=["private"],
        ))
        self.assertTrue(bundle.requires_human_approval)
        self.assertEqual(bundle.items[0].mode, AccessMode.SUMMARY)
        self.assertNotIn("routing", bundle.items[0].payload.lower())

    def test_secret_data_is_not_released(self):
        bundle = self.controller.request_context(TaskRequest(
            requester="remote-b",
            trust_tier=TrustTier.REMOTE,
            purpose="credential help",
            asset_ids=["secret"],
        ))
        self.assertEqual(bundle.items[0].mode, AccessMode.SUMMARY)
        self.assertIn("withheld", bundle.items[0].payload)
        self.assertTrue(bundle.requires_human_approval)

    def test_credential_requests_return_lease_only(self):
        bundle = self.controller.request_context(TaskRequest(
            requester="remote-b",
            trust_tier=TrustTier.REMOTE,
            purpose="open issue",
            asset_ids=["public"],
            needs_credentials_for="github",
        ))
        self.assertIsNotNone(bundle.credential_lease_id)
        self.assertEqual(len(bundle.credential_lease_id), 16)
        self.assertTrue(any("lease" in note.lower() for note in bundle.notes))

    def test_write_requests_require_approval(self):
        bundle = self.controller.request_context(TaskRequest(
            requester="partner-agent",
            trust_tier=TrustTier.PARTNER,
            purpose="propose memory patch",
            asset_ids=["public"],
            requires_write=True,
        ))
        self.assertTrue(bundle.requires_human_approval)
        self.assertTrue(any("write requests" in note.lower() for note in bundle.notes))


if __name__ == "__main__":
    unittest.main()
