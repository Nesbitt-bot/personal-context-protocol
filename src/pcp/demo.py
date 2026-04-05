from src.pcp.protocol import (
    DataAsset,
    PersonalContextController,
    Sensitivity,
    TaskRequest,
    TrustTier,
)


def main() -> None:
    assets = {
        "repo-summary": DataAsset(
            asset_id="repo-summary",
            content="The private repository contains architecture notes and task routing plans.",
            sensitivity=Sensitivity.PRIVATE,
            tags=["repo", "planning"],
        ),
        "credential-note": DataAsset(
            asset_id="credential-note",
            content="password rotation schedule and token handling checklist",
            sensitivity=Sensitivity.SECRET,
            tags=["credentials"],
        ),
        "public-note": DataAsset(
            asset_id="public-note",
            content="Personal Context Protocol is a local-first HCP controller.",
            sensitivity=Sensitivity.PUBLIC,
            tags=["overview"],
        ),
    }

    controller = PersonalContextController(assets)
    request = TaskRequest(
        requester="remote-ai-b",
        trust_tier=TrustTier.REMOTE,
        purpose="Summarize architecture for a prototype review without leaking credential details.",
        asset_ids=["repo-summary", "credential-note", "public-note"],
        requires_write=False,
        needs_credentials_for="github",
    )

    bundle = controller.request_context(request)

    print(f"request_id={bundle.request_id}")
    print(f"requires_human_approval={bundle.requires_human_approval}")
    print(f"credential_lease_id={bundle.credential_lease_id}")
    print("items:")
    for item in bundle.items:
        print(f"- {item.asset_id} [{item.mode}] {item.payload}")
    print("notes:")
    for note in bundle.notes:
        print(f"- {note}")


if __name__ == "__main__":
    main()
