// app.js — application wiring: state, wallet/network gating, form handling,
// card-action delegation, metrics, and the staged AI-consensus flow.

import {
  NETWORK,
  getContractAddress,
  setContractAddress,
  isValidAddress,
} from "./config.js";
import {
  connectWallet,
  eagerConnect,
  switchToStudioNet,
  onWalletChange,
  getWallet,
} from "./wallet.js";
import * as C from "./contract.js";
import {
  $,
  $$,
  esc,
  toast,
  toWei,
  fromWei,
  shortAddr,
  startConsensus,
  renderEscrowCard,
} from "./ui.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  escrows: [],
  stats: null,
  filter: "ALL",
  loading: false,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", init);

async function init() {
  wireTabs();
  wireWalletUI();
  wireContractAddress();
  wireCreateForm();
  wireDisputePortal();
  wireEscrowActions();
  wireFilters();

  onWalletChange(onWallet);
  await eagerConnect();
  onWallet(getWallet());

  // First load + gentle polling.
  refreshAll();
  setInterval(() => {
    if (!document.hidden) refreshAll();
  }, 20000);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function wireTabs() {
  $$(".tab").forEach((btn) =>
    btn.addEventListener("click", () => activateTab(btn.dataset.tab))
  );
}
function activateTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}

// ---------------------------------------------------------------------------
// Wallet + network overlay
// ---------------------------------------------------------------------------
function wireWalletUI() {
  $("#connect-btn").addEventListener("click", async () => {
    try {
      await connectWallet();
      toast("success", "Wallet connected");
    } catch (e) {
      toast("error", e.message || "Failed to connect");
    }
  });
  $("#switch-network-btn").addEventListener("click", async () => {
    try {
      await switchToStudioNet();
    } catch (e) {
      toast("error", e.message || "Could not switch network");
    }
  });
}

function onWallet(w) {
  const btn = $("#connect-btn");
  const pill = $("#account-pill");
  if (w.connected && w.account) {
    btn.classList.add("hidden");
    pill.classList.remove("hidden");
    $("#account-addr").textContent = shortAddr(w.account);
    $("#account-addr").title = w.account;
  } else {
    btn.classList.remove("hidden");
    pill.classList.add("hidden");
  }
  // Full-screen switch overlay only when connected to the wrong chain.
  const overlay = $("#network-overlay");
  const wrong = w.connected && !w.onCorrectNetwork;
  overlay.classList.toggle("open", wrong);
  if (wrong) $("#network-current").textContent = w.chainId || "unknown";

  refreshEscrowsView(); // re-render role tags for the new account
}

// ---------------------------------------------------------------------------
// Contract address config
// ---------------------------------------------------------------------------
function wireContractAddress() {
  const input = $("#contract-input");
  input.value = getContractAddress();
  syncAddressState(input.value);

  $("#contract-save").addEventListener("click", () => {
    const v = input.value.trim();
    if (v && !isValidAddress(v)) {
      toast("error", "Not a valid 0x… contract address");
      return;
    }
    setContractAddress(v);
    syncAddressState(v);
    toast("success", v ? "Contract address saved" : "Contract address cleared");
    refreshAll();
  });
}
function syncAddressState(v) {
  const ok = isValidAddress(v);
  $("#contract-status").textContent = ok ? "linked" : "not set";
  $("#contract-status").className = "addr-status " + (ok ? "ok" : "off");
}

// ---------------------------------------------------------------------------
// Write guard
// ---------------------------------------------------------------------------
function guardWrite() {
  const w = getWallet();
  if (!getContractAddress()) {
    toast("warn", "Set the Escrogen contract address first");
    return false;
  }
  if (!w.connected) {
    toast("warn", "Connect your wallet first");
    return false;
  }
  if (!w.onCorrectNetwork) {
    toast("warn", "Switch to StudioNet first");
    $("#network-overlay").classList.add("open");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Create escrow
// ---------------------------------------------------------------------------
function wireCreateForm() {
  $("#create-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!guardWrite()) return;

    const seller = $("#f-seller").value.trim();
    const description = $("#f-desc").value.trim();
    const amount = $("#f-amount").value.trim();
    const hours = parseInt($("#f-hours").value, 10);
    const submitBtn = $("#create-submit");

    try {
      if (!isValidAddress(seller)) throw new Error("Seller must be a valid 0x… address");
      if (description.length === 0 || description.length > 500)
        throw new Error("Description must be 1–500 characters");
      if (!(hours >= 1)) throw new Error("Expiration must be at least 1 hour");
      const valueWei = toWei(amount);
      const durationSeconds = BigInt(hours) * 3600n;

      setBusy(submitBtn, true, "Funding escrow…");
      const { hash } = await C.createEscrow({
        seller,
        description,
        durationSeconds,
        valueWei,
      });
      toast("success", `Escrow created · ${shortAddr(hash)}`);
      ev.target.reset();
      activateTab("active");
      await refreshAll();
    } catch (e) {
      toast("error", C.humanizeError(e));
    } finally {
      setBusy(submitBtn, false, "Create &amp; Fund Escrow");
    }
  });

  // Live GEN estimate.
  $("#f-amount").addEventListener("input", (e) => {
    const out = $("#amount-preview");
    try {
      out.textContent = `${fromWei(toWei(e.target.value))} GEN escrowed`;
      out.classList.remove("err");
    } catch {
      out.textContent = e.target.value ? "enter a valid amount" : "";
      out.classList.add("err");
    }
  });
}

// ---------------------------------------------------------------------------
// Dispute portal: submit evidence + trigger AI consensus
// ---------------------------------------------------------------------------
function wireDisputePortal() {
  $("#evidence-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!guardWrite()) return;
    const id = $("#ev-id").value.trim();
    const url = $("#ev-url").value.trim();
    const btn = $("#ev-submit");
    try {
      if (id === "" || Number(id) < 0) throw new Error("Enter a valid escrow id");
      if (!/^https?:\/\//i.test(url)) throw new Error("Evidence URL must start with http:// or https://");
      if (url.length > 300) throw new Error("Evidence URL too long (max 300)");
      setBusy(btn, true, "Submitting…");
      await C.submitEvidence(id, url);
      toast("success", "Evidence submitted");
      ev.target.reset();
      await refreshAll();
    } catch (e) {
      toast("error", C.humanizeError(e));
    } finally {
      setBusy(btn, false, "Submit Evidence");
    }
  });

  $("#resolve-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!guardWrite()) return;
    const id = $("#rs-id").value.trim();
    if (id === "" || Number(id) < 0) return toast("error", "Enter a valid escrow id");
    await runConsensus(id);
  });
}

// The headline flow: staged animated indicator during AI dispute resolution.
async function runConsensus(escrowId) {
  const stages = startConsensus(`Resolving dispute #${esc(escrowId)}`);
  try {
    const { receipt } = await C.resolveDispute(escrowId);
    stages.advance();
    stages.done();
    const verdict = C.receiptReturnValue(receipt);
    toast("success", verdict ? `Consensus verdict: ${verdict}` : "Dispute resolved");
    await refreshAll();
  } catch (e) {
    stages.fail();
    toast("error", C.humanizeError(e));
  }
}

// ---------------------------------------------------------------------------
// Escrow card actions (event delegation)
// ---------------------------------------------------------------------------
function wireEscrowActions() {
  $("#escrow-list").addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".act");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (!guardWrite()) return;

    // Actions that need extra input hand off to the Dispute Portal.
    if (action === "submit") {
      activateTab("dispute");
      $("#ev-id").value = id;
      $("#ev-url").focus();
      return;
    }
    if (action === "resolve") {
      activateTab("dispute");
      $("#rs-id").value = id;
      return runConsensus(id);
    }

    const map = {
      release: () => C.releaseFunds(id),
      refund: () => C.refund(id),
      dispute: () => C.openDispute(id),
      claim: () => C.claimAfterDeadline(id),
    };
    const fn = map[action];
    if (!fn) return;

    const label = btn.textContent;
    try {
      setBusy(btn, true, "…");
      optimisticState(id, action);
      await fn();
      toast("success", `${label.trim()} · #${id} confirmed`);
      await refreshAll();
    } catch (e) {
      toast("error", C.humanizeError(e));
      await refreshAll(); // reconcile optimistic change
    } finally {
      setBusy(btn, false, label);
    }
  });
}

// Optimistically reflect the expected next state while the tx confirms.
function optimisticState(id, action) {
  const next = { release: "RELEASED", refund: "REFUNDED", dispute: "DISPUTED", claim: "RESOLVED" }[
    action
  ];
  if (!next) return;
  const e = state.escrows.find((x) => String(x.id) === String(id));
  if (e) {
    e.state = next;
    e._pending = true;
    refreshEscrowsView();
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function wireFilters() {
  $$(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      $$(".chip").forEach((c) => c.classList.toggle("active", c === chip));
      refreshEscrowsView();
    })
  );
}

// ---------------------------------------------------------------------------
// Data refresh + rendering
// ---------------------------------------------------------------------------
async function refreshAll() {
  if (!getContractAddress()) {
    state.escrows = [];
    state.stats = null;
    refreshEscrowsView();
    renderMetrics();
    return;
  }
  await Promise.all([loadStats(), loadEscrows()]);
}

async function loadStats() {
  try {
    state.stats = await C.getPlatformStats();
  } catch (e) {
    state.stats = null;
  }
  renderMetrics();
}

async function loadEscrows() {
  try {
    state.loading = true;
    refreshEscrowsView();
    const list = await C.getRecentEscrows(50);
    state.escrows = Array.isArray(list) ? list : [];
  } catch (e) {
    state.escrows = [];
  } finally {
    state.loading = false;
    refreshEscrowsView();
  }
}

function refreshEscrowsView() {
  const host = $("#escrow-list");
  if (!host) return;
  const { account } = getWallet();

  let items = state.escrows;
  if (state.filter !== "ALL") items = items.filter((e) => e.state === state.filter);

  if (state.loading && !state.escrows.length) {
    host.innerHTML = skeletons(3);
    return;
  }
  if (!getContractAddress()) {
    host.innerHTML = emptyState("Link a contract address to view escrows.");
    return;
  }
  if (!items.length) {
    host.innerHTML = emptyState(
      state.filter === "ALL" ? "No escrows yet. Create the first one." : "No escrows in this state."
    );
    return;
  }
  host.innerHTML = items.map((e) => renderEscrowCard(e, { account })).join("");
}

function renderMetrics() {
  const s = state.stats;
  const totalEscrows = s ? Number(s.total_escrows) : 0;
  const fees = s ? fromWei(s.platform_fees_collected) : "0";
  const tvl = s ? fromWei(s.contract_balance) : "0";
  const feeBps = s ? Number(s.fee_bps) : 0;

  const active = state.escrows.filter((e) => e.state === "CREATED" || e.state === "DISPUTED").length;
  const disputed = state.escrows.filter((e) => e.state === "DISPUTED").length;

  setMetric("m-tvl", `${tvl} GEN`);
  setMetric("m-total", String(totalEscrows));
  setMetric("m-active", String(active));
  setMetric("m-disputed", String(disputed));
  setMetric("m-fees", `${fees} GEN`);
  setMetric("m-rate", `${(feeBps / 100).toFixed(2)}%`);

  const paused = s?.paused;
  const badge = $("#platform-status");
  if (badge) {
    badge.textContent = s ? (paused ? "PAUSED" : "OPERATIONAL") : "—";
    badge.className = "status-badge " + (s ? (paused ? "paused" : "live") : "");
  }
}

// ---------------------------------------------------------------------------
// Small view helpers
// ---------------------------------------------------------------------------
function setMetric(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("busy", busy);
  if (label != null) btn.innerHTML = busy ? `<span class="spin"></span>${esc(label)}` : label;
}
function skeletons(n) {
  return Array.from({ length: n }, () => `<div class="card skeleton"></div>`).join("");
}
function emptyState(msg) {
  return `<div class="empty">${esc(msg)}</div>`;
}
