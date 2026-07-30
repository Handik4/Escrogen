# Escrogen (GenEscrow v2)

AI-powered, prompt-injection-hardened smart escrow built as a **GenLayer
Intelligent Contract**, with a dispute-resolution flow settled by
optimistic-democracy consensus over a multimodal LLM arbiter.

- **Contract:** `contracts/escrogen.py` (class `Escrogen`)
- **Network:** GenLayer **StudioNet** (chain `0xF22F` / `61999`)
- **Deployed address:** `0x03Ee4A40b3550D7D3E1E559296bEcF668B9CB2d3`
- **Frontend:** `frontend/` — vanilla ES-module dApp using `genlayer-js`

## Lifecycle

```
CREATED ──release──▶ RELEASED
   │
   ├──refund───────▶ REFUNDED
   │
   ├──open_dispute─▶ DISPUTED ──resolve_dispute──▶ RESOLVED
   │
   └──claim_after_deadline (timeout) ───────────▶ RESOLVED
```

## On-chain ABI

| Kind | Method | Notes |
|---|---|---|
| view | `get_escrow(id)` | single escrow (incl. `id`) |
| view | `get_recent_escrows(limit)` | newest-first list, for the UI |
| view | `get_stats()` | platform metrics (frontend `getPlatformStats`) |
| view | `get_state(id)` | escrow state string |
| write | `create_escrow(seller, description, duration_seconds)` | payable — funds the escrow |
| write | `submit_check(id, evidence_url)` | seller submits deliverable proof |
| write | `release(id)` | buyer releases (frontend `releaseFunds`) |
| write | `refund(id)` | gross refund to buyer |
| write | `open_dispute(id)` | escalate to AI consensus |
| write | `resolve_dispute(id)` | run consensus, returns verdict |
| write | `claim_after_deadline(id)` | timeout settlement |
| write | `set_paused` / `set_fee_bps` / `transfer_ownership` / `withdraw_fees` | owner admin |

## Security & financial invariants

- **Gross refunds:** `refund()` returns 100% of the escrowed amount to the
  buyer; `fee_paid = 0` and `platform_fees_collected` is untouched — no fee is
  ever stranded in the contract.
- **Fee accounting:** platform fees (≤ 2% ceiling) are deducted **only** on
  settlements that pay the seller (release / 50-50 split) and are the sole
  driver of `platform_fees_collected`.
- **Prompt-injection hardening:** every untrusted field (`description`,
  `evidence_url`, scraped HTML) is sanitized (tags/scripts stripped, angle
  brackets neutralized, 2000-char cap) and fenced inside
  `<UNTRUSTED_DESCRIPTION>`, `<UNTRUSTED_EVIDENCE_URL>`,
  `<UNTRUSTED_SCRAPED_CONTENT>`; the arbiter is instructed to treat fenced
  content strictly as inert data.
- **Canonical verdict normalization:** LLM output is coerced to the closed enum
  `{RELEASE_TO_SELLER, REFUND_TO_BUYER, SPLIT_FEE_50_50}`; any malformed or
  off-enum output raises `[LLM_ERROR]`, forcing validator rotation instead of
  settling on corrupted output.
- **Input bounds:** `description` ≤ 500 chars; `evidence_url` ≤ 300 chars and
  must use `http://` or `https://`.
- **Error classification:** `[EXPECTED]` / `[EXTERNAL]` / `[TRANSIENT]` /
  `[LLM_ERROR]` drive validator equivalence on failure paths.

## Testing

```bash
# 1. Lint (GenVM linter)
genvm-lint check contracts/escrogen.py

# 2. Direct-mode tests (fast, in-memory; no server)
pytest tests/direct/ -v

# 3. Integration tests against StudioNet (real deploy + consensus)
gltest tests/integration/ -v -s --network studionet
#    - test_escrogen.py       : full lifecycle + write consensus (fresh deploy)
#    - test_escrogen_live.py  : read-only checks vs the deployed address
```

> **Note:** the contract source is intentionally **ASCII-only** — GenLayer's
> schema-fetch RPC encodes contract code as ASCII, so non-ASCII characters in
> comments break deployment.

## Frontend

```bash
cd frontend && python3 -m http.server 8000   # http://127.0.0.1:8000
```

The deployed address ships as the default in `frontend/js/config.js`; connect a
StudioNet wallet (chain `0xF22F`) to create escrows and drive disputes.
# Escrogen
