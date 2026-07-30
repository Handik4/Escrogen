"""Live StudioNet verification against the DEPLOYED Escrogen instance.

Unlike test_escrogen.py (which deploys a fresh contract per run and drives the
full write-consensus lifecycle), this suite binds to the already-deployed
address and performs read-only liveness checks — confirming the on-chain
contract responds and exposes the expected ABI shape.

    gltest tests/integration/test_escrogen_live.py -v -s --network studionet
"""

from gltest import get_contract_factory

# Deployed Escrogen contract on StudioNet.
CONTRACT_ADDRESS = "0x03Ee4A40b3550D7D3E1E559296bEcF668B9CB2d3"

# Canonical enums the deployed contract must agree with.
STATES = {"CREATED", "RELEASED", "REFUNDED", "DISPUTED", "RESOLVED"}
VERDICTS = {"", "RELEASE_TO_SELLER", "REFUND_TO_BUYER", "SPLIT_FEE_50_50"}


def _contract():
    factory = get_contract_factory("Escrogen")
    return factory.build_contract(contract_address=CONTRACT_ADDRESS)


def test_live_contract_is_reachable_and_stats_shape():
    contract = _contract()
    stats = contract.get_stats(args=[]).call()

    # All platform-metric fields the frontend depends on must be present.
    for key in (
        "owner",
        "paused",
        "fee_bps",
        "total_escrows",
        "platform_fees_collected",
        "contract_balance",
    ):
        assert key in stats, f"missing stats field: {key}"

    # Fee rate must respect the 2% ceiling invariant.
    assert 0 <= int(stats["fee_bps"]) <= 200
    assert int(stats["total_escrows"]) >= 0
    assert int(stats["platform_fees_collected"]) >= 0


def test_live_recent_escrows_conform_to_enums():
    contract = _contract()
    stats = contract.get_stats(args=[]).call()
    total = int(stats["total_escrows"])

    recent = contract.get_recent_escrows(args=[10]).call()
    assert isinstance(recent, list)
    assert len(recent) == min(total, 10)

    # Newest-first ordering + enum conformance for anything already on-chain.
    ids = [int(e["id"]) for e in recent]
    assert ids == sorted(ids, reverse=True)
    for e in recent:
        assert e["state"] in STATES
        assert e["verdict"] in VERDICTS
        assert int(e["amount"]) >= 0


def test_live_get_escrow_matches_recent():
    contract = _contract()
    stats = contract.get_stats(args=[]).call()
    if int(stats["total_escrows"]) == 0:
        # Fresh deployment with no escrows yet — nothing more to assert.
        return

    recent = contract.get_recent_escrows(args=[1]).call()
    newest_id = int(recent[0]["id"])
    single = contract.get_escrow(args=[newest_id]).call()
    assert int(single["id"]) == newest_id
    assert single["state"] in STATES
