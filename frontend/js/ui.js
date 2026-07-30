// ui.js — pure DOM helpers: HTML-escaping, toasts, badges, staged consensus
// loader, and escrow-card rendering. No blockchain logic lives here.

// ---------------------------------------------------------------------------
// Security: escape ALL untrusted strings before they touch innerHTML.
// ---------------------------------------------------------------------------
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const WEI = 10n ** 18n;

export function fromWei(value, maxFrac = 4) {
  let v;
  try {
    v = BigInt(value ?? 0);
  } catch {
    return "0";
  }
  const whole = v / WEI;
  const frac = v % WEI;
  if (frac === 0n) return whole.toString();
  let fracStr = frac.toString().padStart(18, "0").slice(0, maxFrac).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// Parse a decimal GEN string into wei (BigInt) without float rounding errors.
export function toWei(amountStr) {
  const s = String(amountStr ?? "").trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") {
    throw new Error("Enter a valid amount");
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  const wei = BigInt(whole || "0") * WEI + BigInt(fracPadded || "0");
  if (wei <= 0n) throw new Error("Amount must be greater than 0");
  return wei;
}

export function shortAddr(addr) {
  const a = String(addr || "");
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function timeLeft(deadlineSec) {
  const now = Math.floor(Date.now() / 1000);
  const secs = Number(deadlineSec) - now;
  if (secs <= 0) return "expired";
  const h = Math.floor(secs / 3600);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h left`;
  const m = Math.floor((secs % 3600) / 60);
  return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}

// ---------------------------------------------------------------------------
// State badges
// ---------------------------------------------------------------------------
const BADGES = {
  CREATED: "badge-created",
  DISPUTED: "badge-disputed",
  RELEASED: "badge-released",
  REFUNDED: "badge-refunded",
  RESOLVED: "badge-resolved",
};

export function stateBadge(state) {
  const s = esc(state);
  const cls = BADGES[state] || "badge-created";
  return `<span class="badge ${cls}">${s}</span>`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const ICONS = { success: "✓", error: "✕", info: "ⓘ", warn: "⚠" };

export function toast(type, message, ttl = 5200) {
  const host = $("#toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="toast-icon">${esc(ICONS[type] || "ⓘ")}</span>
    <span class="toast-msg">${esc(message)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const kill = () => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener("click", kill);
  if (ttl) setTimeout(kill, ttl);
  return kill;
}

// ---------------------------------------------------------------------------
// Staged consensus overlay — animated multi-step indicator shown while the
// AI validators evaluate a dispute.
// ---------------------------------------------------------------------------
const CONSENSUS_STAGES = [
  "Broadcasting resolution request",
  "Leader fetching evidence URL",
  "Sanitizing untrusted content",
  "Running AI arbiter (multimodal)",
  "Validators re-evaluating independently",
  "Reaching optimistic-democracy consensus",
  "Settling funds on-chain",
];

export function startConsensus(title = "Resolving dispute via AI consensus") {
  const overlay = $("#consensus");
  const list = $("#consensus-stages");
  const heading = $("#consensus-title");
  if (!overlay || !list) return { advance() {}, done() {}, fail() {} };

  heading.textContent = title;
  list.innerHTML = CONSENSUS_STAGES.map(
    (s, i) => `<li class="cstage" data-i="${i}">
      <span class="cdot"></span><span class="ctext">${esc(s)}</span></li>`
  ).join("");
  overlay.classList.add("open");

  let current = 0;
  const items = $$(".cstage", list);
  const mark = (i) => {
    if (i > 0) items[i - 1]?.classList.replace("active", "done");
    items[i]?.classList.add("active");
  };
  mark(0);

  // Auto-advance through the "soft" stages so the UI feels alive even though
  // the real receipt only tells us start/finish.
  const timer = setInterval(() => {
    if (current < CONSENSUS_STAGES.length - 2) mark(++current);
  }, 1400);

  const close = (delay = 600) => {
    clearInterval(timer);
    setTimeout(() => overlay.classList.remove("open"), delay);
  };

  return {
    advance() {
      if (current < CONSENSUS_STAGES.length - 1) mark(++current);
    },
    done() {
      clearInterval(timer);
      items.forEach((it) => it.classList.add("done"));
      mark(CONSENSUS_STAGES.length - 1);
      items[CONSENSUS_STAGES.length - 1]?.classList.add("done");
      close(700);
    },
    fail() {
      overlay.classList.add("failed");
      close(400);
      setTimeout(() => overlay.classList.remove("failed"), 1200);
    },
  };
}

// ---------------------------------------------------------------------------
// Escrow card rendering
// ---------------------------------------------------------------------------
export function renderEscrowCard(e, ctx) {
  const id = esc(e.id);
  const isBuyer = ctx.account && String(e.buyer).toLowerCase() === ctx.account.toLowerCase();
  const isSeller = ctx.account && String(e.seller).toLowerCase() === ctx.account.toLowerCase();
  const roleTag = isBuyer
    ? `<span class="role role-buyer">You · Buyer</span>`
    : isSeller
    ? `<span class="role role-seller">You · Seller</span>`
    : "";

  const verdict = e.verdict
    ? `<div class="kv"><span>Verdict</span><b>${esc(e.verdict)}</b></div>`
    : "";
  const evidence = e.evidence_url
    ? `<div class="kv"><span>Evidence</span>
         <a href="${esc(e.evidence_url)}" target="_blank" rel="noopener noreferrer nofollow"
            class="link">${esc(shortAddr(e.evidence_url))} ↗</a></div>`
    : "";

  return `<article class="card escrow" data-id="${id}">
    <header class="escrow-head">
      <div class="escrow-id">#${id} ${roleTag}</div>
      ${stateBadge(e.state)}
    </header>
    <p class="escrow-desc">${esc(e.description)}</p>
    <div class="escrow-grid">
      <div class="kv"><span>Amount</span><b class="amt">${esc(fromWei(e.amount))} GEN</b></div>
      <div class="kv"><span>Buyer</span><b title="${esc(e.buyer)}">${esc(shortAddr(e.buyer))}</b></div>
      <div class="kv"><span>Seller</span><b title="${esc(e.seller)}">${esc(shortAddr(e.seller))}</b></div>
      <div class="kv"><span>Deadline</span><b>${esc(timeLeft(e.deadline))}</b></div>
      ${verdict}
      ${evidence}
    </div>
    ${renderActions(e, { isBuyer, isSeller })}
  </article>`;
}

function renderActions(e, { isBuyer, isSeller }) {
  const id = esc(e.id);
  const btns = [];
  const expired = Number(e.deadline) <= Math.floor(Date.now() / 1000);

  if (e.state === "CREATED") {
    if (isSeller) btns.push(act(id, "submit", "Submit Evidence", "ghost"));
    if (isBuyer) btns.push(act(id, "release", "Release Funds", "primary"));
    if (isSeller || ctxIsOwnerless()) btns.push(act(id, "refund", "Refund Buyer", "ghost"));
    if (isBuyer || isSeller) btns.push(act(id, "dispute", "Open Dispute", "warn"));
    if (expired) btns.push(act(id, "claim", "Claim (timeout)", "ghost"));
  } else if (e.state === "DISPUTED") {
    btns.push(act(id, "resolve", "Trigger AI Consensus", "primary"));
  }

  if (!btns.length) return "";
  return `<footer class="escrow-actions">${btns.join("")}</footer>`;
}

// refund is also allowed for the owner; role isn't known per-card here, so we
// surface it for the seller and let the contract enforce authorization.
function ctxIsOwnerless() {
  return false;
}

function act(id, action, label, variant) {
  return `<button class="btn btn-${variant} act" data-action="${esc(action)}" data-id="${esc(
    id
  )}">${esc(label)}</button>`;
}
