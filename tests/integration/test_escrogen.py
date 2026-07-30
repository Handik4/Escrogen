"""Integration tests for Escrogen against a live GenLayer network.

Verifies real contract deployment and write-consensus execution (leader +
validators) on StudioNet:

    gltest tests/integration/ -v -s --network studionet

These focus on the deterministic write paths (deploy, admin, escrow lifecycle)
so they reach consensus reliably. The LLM/web-backed dispute-resolution path is
covered by a separate `@pytest.mark.slow` test that makes real web + model
calls and is excluded from the default run.
"""

import pytest

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

FEE_BPS = 200          # 2%
DURATION = 86_400      # 1 day
ONE_GEN = 10 ** 18     # 1 GEN in wei


def _deploy():
    factory = get_contract_factory("Escrogen")
    return factory.deploy(args=[FEE_BPS])


# ---------------------------------------------------------------------------
# Deployment + read
# ---------------------------------------------------------------------------
def test_deploy_and_read_stats():
    contract = _deploy()

    stats = contract.get_stats(args=[]).call()
    assert int(stats["fee_bps"]) == FEE_BPS
    assert int(stats["total_escrows"]) == 0
    assert int(stats["platform_fees_collected"]) == 0
    assert stats["paused"] is False


# ---------------------------------------------------------------------------
# Admin write consensus
# ---------------------------------------------------------------------------
def test_admin_writes_reach_consensus():
    contract = _deploy()

    receipt = contract.set_fee_bps(args=[150]).transact()
    assert tx_execution_succeeded(receipt)
    assert int(contract.get_stats(args=[]).call()["fee_bps"]) == 150

    receipt = contract.set_paused(args=[True]).transact()
    assert tx_execution_succeeded(receipt)
    assert contract.get_stats(args=[]).call()["paused"] is True


def test_fee_ceiling_rejected_by_consensus():
    contract = _deploy()
    # 201 bps > 2% ceiling -> the write must fail deterministically in consensus.
    receipt = contract.set_fee_bps(args=[201]).transact()
    assert tx_execution_failed(receipt)
    # State unchanged.
    assert int(contract.get_stats(args=[]).call()["fee_bps"]) == FEE_BPS


# ---------------------------------------------------------------------------
# Full escrow lifecycle (payable create -> submit -> release)
# ---------------------------------------------------------------------------
def test_escrow_lifecycle_release():
    accounts = get_accounts()
    seller = accounts[1]  # deployer (accounts[0]) is buyer + owner

    contract = _deploy()

    receipt = contract.create_escrow(
        args=[seller.address, "Deliver a responsive landing page", DURATION]
    ).transact(value=ONE_GEN)
    assert tx_execution_succeeded(receipt)

    esc = contract.get_escrow(args=[0]).call()
    assert esc["state"] == "CREATED"
    assert int(esc["amount"]) == ONE_GEN

    # Seller submits the deliverable proof.
    seller_view = contract.connect(seller)
    receipt = seller_view.submit_check(
        args=[0, "https://example.com/deliverable"]
    ).transact()
    assert tx_execution_succeeded(receipt)

    # Buyer releases funds to the seller.
    receipt = contract.release(args=[0]).transact()
    assert tx_execution_succeeded(receipt)

    esc = contract.get_escrow(args=[0]).call()
    assert esc["state"] == "RELEASED"
    assert esc["verdict"] == "RELEASE_TO_SELLER"
    expected_fee = ONE_GEN * FEE_BPS // 10_000
    assert int(esc["fee_paid"]) == expected_fee
    assert int(contract.get_stats(args=[]).call()["platform_fees_collected"]) == expected_fee


def test_escrow_gross_refund():
    accounts = get_accounts()
    seller = accounts[1]

    contract = _deploy()
    receipt = contract.create_escrow(
        args=[seller.address, "Design a logo", DURATION]
    ).transact(value=ONE_GEN)
    assert tx_execution_succeeded(receipt)

    # Seller refunds the buyer — full gross, no fee stranded.
    receipt = contract.connect(seller).refund(args=[0]).transact()
    assert tx_execution_succeeded(receipt)

    esc = contract.get_escrow(args=[0]).call()
    assert esc["state"] == "REFUNDED"
    assert int(esc["fee_paid"]) == 0
    assert int(contract.get_stats(args=[]).call()["platform_fees_collected"]) == 0


# ---------------------------------------------------------------------------
# LLM + web-backed dispute resolution (real calls) — opt-in.
# ---------------------------------------------------------------------------
@pytest.mark.slow
def test_dispute_resolution_consensus():
    """End-to-end AI arbitration with real web fetch + LLM under consensus.

    Run explicitly:  gltest tests/integration/ -v -s -m slow --network studionet
    """
    accounts = get_accounts()
    seller = accounts[1]

    contract = _deploy()
    contract.create_escrow(
        args=[seller.address, "The page must mention 'Example Domain'.", DURATION]
    ).transact(value=ONE_GEN)

    contract.connect(seller).submit_check(
        args=[0, "https://example.com/"]
    ).transact()
    contract.connect(seller).open_dispute(args=[0]).transact()

    receipt = contract.resolve_dispute(args=[0]).transact()
    assert tx_execution_succeeded(receipt)

    esc = contract.get_escrow(args=[0]).call()
    assert esc["state"] == "RESOLVED"
    assert esc["verdict"] in ("RELEASE_TO_SELLER", "REFUND_TO_BUYER", "SPLIT_FEE_50_50")
