// wallet.js — browser wallet (MetaMask / EIP-1193) connection + StudioNet
// network enforcement. Emits state changes through a small subscriber list.

import { NETWORK } from "./config.js";

const state = {
  provider: null, // EIP-1193 provider (window.ethereum)
  account: null, // 0x… checksummed-ish string
  chainId: null, // hex string, e.g. "0xf22f"
  connected: false,
};

const subscribers = new Set();
export function onWalletChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
function emit() {
  const snap = getWallet();
  subscribers.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.error("wallet subscriber error", e);
    }
  });
}

export function getWallet() {
  return { ...state, onCorrectNetwork: isCorrectNetwork() };
}

export function isCorrectNetwork() {
  return (state.chainId || "").toLowerCase() === NETWORK.chainIdHex.toLowerCase();
}

function detectProvider() {
  const eth = window.ethereum;
  if (!eth) return null;
  // If multiple wallets are injected, prefer MetaMask.
  if (Array.isArray(eth.providers)) {
    return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  }
  return eth;
}

export async function connectWallet() {
  const provider = detectProvider();
  if (!provider) {
    throw new Error("No browser wallet found. Install MetaMask to continue.");
  }
  state.provider = provider;

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) throw new Error("No accounts authorized");

  state.account = accounts[0];
  state.chainId = await provider.request({ method: "eth_chainId" });
  state.connected = true;

  bindProviderEvents(provider);
  emit();
  return getWallet();
}

// Attempt a silent reconnect if the site was previously authorized.
export async function eagerConnect() {
  const provider = detectProvider();
  if (!provider) return null;
  state.provider = provider;
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts && accounts.length) {
      state.account = accounts[0];
      state.chainId = await provider.request({ method: "eth_chainId" });
      state.connected = true;
      bindProviderEvents(provider);
      emit();
      return getWallet();
    }
  } catch {
    /* not authorized yet */
  }
  return null;
}

let eventsBound = false;
function bindProviderEvents(provider) {
  if (eventsBound || !provider.on) return;
  eventsBound = true;
  provider.on("accountsChanged", (accounts) => {
    state.account = accounts && accounts.length ? accounts[0] : null;
    state.connected = !!state.account;
    emit();
  });
  provider.on("chainChanged", (chainId) => {
    state.chainId = chainId;
    emit();
  });
  provider.on("disconnect", () => {
    state.connected = false;
    state.account = null;
    emit();
  });
}

// Switch the wallet to StudioNet, adding the chain if it is not yet known.
export async function switchToStudioNet() {
  const provider = state.provider || detectProvider();
  if (!provider) throw new Error("No wallet available");
  state.provider = provider;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK.chainIdHex }],
    });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    if (err && (err.code === 4902 || err.code === -32603)) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: NETWORK.chainIdHex,
            chainName: NETWORK.chainName,
            rpcUrls: [NETWORK.rpcUrl],
            nativeCurrency: NETWORK.nativeCurrency,
            blockExplorerUrls: [NETWORK.explorerUrl],
          },
        ],
      });
    } else {
      throw err;
    }
  }

  state.chainId = await provider.request({ method: "eth_chainId" });
  emit();
  return isCorrectNetwork();
}
