// contract.js — GenLayer SDK binding for Escrogen.
//
// Lazy-loads genlayer-js on first use and exposes read/write wrappers that map
// exactly onto the on-chain ABI of contracts/escrogen.py.
//
// ─────────────────────────────────────────────────────────────────────────
//  ON-CHAIN ABI (verified against contracts/escrogen.py — genvm-lint clean)
// ─────────────────────────────────────────────────────────────────────────
//  VIEWS
//    get_escrow(escrow_id: u256) -> dict
//    get_recent_escrows(limit: u256) -> list[dict]
//    get_stats() -> dict            (exposed here as getPlatformStats)
//    get_state(escrow_id: u256) -> str
//  WRITES
//    create_escrow(seller: str, description: str, duration_seconds: u256)  [payable]
//    submit_check(escrow_id: u256, evidence_url: str)
//    release(escrow_id: u256)       (exposed here as releaseFunds)
//    refund(escrow_id: u256)
//    open_dispute(escrow_id: u256)
//    resolve_dispute(escrow_id: u256) -> str (verdict)
//    claim_after_deadline(escrow_id: u256) -> str (verdict)
//
//  The three names from the product spec that differ from the deployed ABI —
//  get_platform_stats, release_funds, get_recent_escrows — are reconciled here:
//  get_recent_escrows now exists on-chain; the other two are thin JS aliases
//  over get_stats / release so the actual SDK call always uses the real name.
// ─────────────────────────────────────────────────────────────────────────

import {
  SDK_URL,
  SDK_CHAINS_URL,
  NETWORK,
  CONTRACT_ADDRESS,
  getContractAddress,
} from "./config.js";
import { getWallet } from "./wallet.js";

// Deployed Escrogen instance on StudioNet (source of truth lives in config.js).
// 0x03Ee4A40b3550D7D3E1E559296bEcF668B9CB2d3
export { CONTRACT_ADDRESS };

// Canonical ABI method-name constants — the ONLY strings passed to the SDK.
export const ABI = {
  // views
  GET_ESCROW: "get_escrow",
  GET_RECENT: "get_recent_escrows",
  GET_STATS: "get_stats",
  GET_STATE: "get_state",
  // writes
  CREATE_ESCROW: "create_escrow",
  SUBMIT_CHECK: "submit_check",
  RELEASE: "release",
  REFUND: "refund",
  OPEN_DISPUTE: "open_dispute",
  RESOLVE_DISPUTE: "resolve_dispute",
  CLAIM_AFTER_DEADLINE: "claim_after_deadline",
};

let _sdk = null;
let _studionet = null;
let _readClient = null;
let _writeClient = null;
let _writeAccount = null;

async function loadSdk() {
  if (_sdk) return;
  const [sdk, chains] = await Promise.all([
    import(/* @vite-ignore */ SDK_URL),
    import(/* @vite-ignore */ SDK_CHAINS_URL),
  ]);
  _sdk = sdk;
  _studionet = chains.studionet;
}

async function getReadClient() {
  await loadSdk();
  if (!_readClient) {
    _readClient = _sdk.createClient({ chain: _studionet });
  }
  return _readClient;
}

async function getWriteClient() {
  await loadSdk();
  const { account, provider } = getWallet();
  if (!account || !provider) throw new Error("Connect your wallet first");
  // Rebuild if the connected account changed.
  if (!_writeClient || _writeAccount !== account) {
    _writeClient = _sdk.createClient({
      chain: _studionet,
      account,
      provider,
    });
    _writeAccount = account;
  }
  return _writeClient;
}

function requireAddress() {
  const address = getContractAddress();
  if (!address) throw new Error("Set the Escrogen contract address first");
  return address;
}

// ---------------------------------------------------------------------------
// Result normalization: GenLayer dict/list decoding may hand back Map objects.
// Convert to plain JS recursively. BigInts are preserved for the UI formatter.
// ---------------------------------------------------------------------------
function normalize(value) {
  if (value instanceof Map) {
    const o = {};
    for (const [k, v] of value.entries()) o[k] = normalize(v);
    return o;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object" && value.constructor === Object) {
    const o = {};
    for (const k of Object.keys(value)) o[k] = normalize(value[k]);
    return o;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Error mapping: turn raw SDK/RPC/consensus errors into concise messages.
// ---------------------------------------------------------------------------
export function humanizeError(err) {
  const raw = (err && (err.shortMessage || err.message)) || String(err || "Unknown error");
  const msg = raw.replace(/\s+/g, " ").trim();

  if (/user rejected|user denied|4001/i.test(msg)) return "Transaction rejected in wallet";
  if (/\[EXPECTED\]/.test(msg)) return msg.split("[EXPECTED]").pop().trim() || "Rejected by contract";
  if (/\[LLM_ERROR\]/.test(msg)) return "AI verdict was invalid — validators rotated. Try again.";
  if (/\[TRANSIENT\]/.test(msg)) return "Evidence source was temporarily unreachable. Try again.";
  if (/\[EXTERNAL\]/.test(msg)) return "Evidence source returned an error (4xx).";
  if (/insufficient/i.test(msg)) return "Insufficient balance for this amount.";
  if (/wrong chain|chain mismatch|expects/i.test(msg)) return "Wallet is on the wrong network.";
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}

// ===========================================================================
// READS
// ===========================================================================
async function read(functionName, args = []) {
  const client = await getReadClient();
  const address = requireAddress();
  const res = await client.readContract({
    address,
    functionName,
    args,
    stateStatus: "accepted",
  });
  return normalize(res);
}

export const getEscrow = (escrowId) => read(ABI.GET_ESCROW, [BigInt(escrowId)]);
export const getRecentEscrows = (limit = 20) => read(ABI.GET_RECENT, [BigInt(limit)]);
export const getState = (escrowId) => read(ABI.GET_STATE, [BigInt(escrowId)]);
export const getPlatformStats = () => read(ABI.GET_STATS, []); // -> get_stats()

// ===========================================================================
// WRITES  — return { hash, receipt }
// ===========================================================================
async function write(functionName, args = [], value = 0n) {
  const client = await getWriteClient();
  const address = requireAddress();
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: BigInt(value),
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: _sdk?.TransactionStatus?.ACCEPTED ?? "ACCEPTED",
    fullTransaction: false,
  });
  return { hash, receipt };
}

// create_escrow(seller, description, duration_seconds) [payable]
export function createEscrow({ seller, description, durationSeconds, valueWei }) {
  return write(
    ABI.CREATE_ESCROW,
    [String(seller), String(description), BigInt(durationSeconds)],
    BigInt(valueWei)
  );
}

// submit_check(escrow_id, evidence_url)
export const submitEvidence = (escrowId, evidenceUrl) =>
  write(ABI.SUBMIT_CHECK, [BigInt(escrowId), String(evidenceUrl)]);

// release(escrow_id)  — spec name: release_funds
export const releaseFunds = (escrowId) => write(ABI.RELEASE, [BigInt(escrowId)]);

// refund(escrow_id)
export const refund = (escrowId) => write(ABI.REFUND, [BigInt(escrowId)]);

// open_dispute(escrow_id)
export const openDispute = (escrowId) => write(ABI.OPEN_DISPUTE, [BigInt(escrowId)]);

// resolve_dispute(escrow_id) -> verdict
export const resolveDispute = (escrowId) => write(ABI.RESOLVE_DISPUTE, [BigInt(escrowId)]);

// claim_after_deadline(escrow_id) -> verdict
export const claimAfterDeadline = (escrowId) =>
  write(ABI.CLAIM_AFTER_DEADLINE, [BigInt(escrowId)]);

// Best-effort verdict extraction from a write receipt (resolve/claim return a
// string). Falls back to re-reading the escrow's stored verdict.
export function receiptReturnValue(receipt) {
  try {
    const r =
      receipt?.result ??
      receipt?.returnValue ??
      receipt?.data?.result ??
      receipt?.consensus_data?.leader_receipt?.[0]?.result;
    return r != null ? String(r) : null;
  } catch {
    return null;
  }
}

export { NETWORK };
