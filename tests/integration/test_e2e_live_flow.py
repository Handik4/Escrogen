"""LIVE end-to-end transaction flow against the DEPLOYED Escrogen contract on
StudioNet. This SENDS REAL, STATE-MUTATING transactions (funds an escrow, opens
a dispute, and triggers real AI-consensus resolution) and reads state back.

Run explicitly (it is opt-in via the `e2e` marker so normal test runs don't
spend value or mutate the live contract):

    gltest tests/integration/test_e2e_live_flow.py -v -s --network studionet -m e2e
"""

import pytest

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded

CONTRACT_ADDRESS = "0x03Ee4A40b3550D7D3E1E559296bEcF668B9CB2d3"
ONE_GEN = 10 ** 18
DURATION = 86_400  # 1 day

VERDICTS = {"RELEASE_TO_SELLER", "REFUND_TO_BUYER", "SPLIT_FEE_50_50"}
# example.com is stable and cheap for the leader/validator web fetch.
EVIDENCE_URL = "https://example.com/"
DESCRIPTION = "Deliverable page must contain the text 'Example Domain'."


def _tx_hash(receipt):
    """Best-effort extraction of the on-chain tx hash from a receipt."""
    if not isinstance(receipt, dict):
        return getattr(receipt, "hash", None)
    for k in ("tx_id", "hash", "transaction_hash", "txId"):
        if receipt.get(k):
            return receipt[k]
    # Some receipts nest it under consensus data.
    cd = receipt.get("consensus_data") or {}
    return cd.get("tx_id") or cd.get("hash")


@pytest.mark.e2e
def test_live_e2e_dispute_flow():
    accounts = get_accounts()
    buyer = accounts[0]
    seller = accounts[1]

    factory = get_contract_factory("Escrogen")
    as_buyer = factory.build_contract(contract_address=CONTRACT_ADDRESS, account=buyer)
    as_seller = as_buyer.connect(seller)

    print("\n================ ESCROGEN LIVE E2E (StudioNet) ================")
    print(f"contract : {CONTRACT_ADDRESS}")
    print(f"buyer    : {buyer.address}")
    print(f"seller   : {seller.address}")

    # --- id of the escrow we are about to create --------------------------
    stats_before = as_buyer.get_stats(args=[]).call()
    escrow_id = int(stats_before["total_escrows"])
    print(f"new escrow id (pre-create total_escrows): {escrow_id}")

    # === 1. CREATE (payable) ==============================================
    r_create = as_buyer.create_escrow(
        args=[seller.address, DESCRIPTION, DURATION]
    ).transact(value=ONE_GEN)
    assert tx_execution_succeeded(r_create), "create_escrow failed on-chain"
    print(f"\n[1] create_escrow  tx={_tx_hash(r_create)}")

    esc = as_buyer.get_escrow(args=[escrow_id]).call()
    print(f"    state -> {esc['state']} | amount={int(esc['amount'])} wei")
    assert esc["state"] == "CREATED"
    assert int(esc["amount"]) == ONE_GEN

    # === 2. SUBMIT EVIDENCE (required before a dispute) ===================
    r_submit = as_seller.submit_check(args=[escrow_id, EVIDENCE_URL]).transact()
    assert tx_execution_succeeded(r_submit), "submit_check failed on-chain"
    print(f"\n[2] submit_check   tx={_tx_hash(r_submit)}  evidence={EVIDENCE_URL}")

    # === 3. OPEN DISPUTE ==================================================
    r_dispute = as_buyer.open_dispute(args=[escrow_id]).transact()
    assert tx_execution_succeeded(r_dispute), "open_dispute failed on-chain"
    print(f"\n[3] open_dispute   tx={_tx_hash(r_dispute)}")

    esc = as_buyer.get_escrow(args=[escrow_id]).call()
    print(f"    state -> {esc['state']}")
    assert esc["state"] == "DISPUTED"

    # === 4. RESOLVE via real AI consensus =================================
    print("\n[4] resolve_dispute -> triggering non-deterministic AI consensus…")
    r_resolve = as_buyer.resolve_dispute(args=[escrow_id]).transact()
    assert tx_execution_succeeded(r_resolve), "resolve_dispute failed on-chain"
    print(f"    resolve_dispute tx={_tx_hash(r_resolve)}")

    esc = as_buyer.get_escrow(args=[escrow_id]).call()
    verdict = esc["verdict"]
    print(f"    state -> {esc['state']} | verdict -> {verdict}")
    print("===============================================================\n")

    # === Validate final state machine =====================================
    assert esc["state"] == "RESOLVED", f"expected RESOLVED, got {esc['state']}"
    assert verdict in VERDICTS, f"verdict {verdict!r} not a canonical enum value"
