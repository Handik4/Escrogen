// Escrogen frontend configuration.
// Single source of truth for network + SDK + deployed contract address.

export const SDK_VERSION = "1.1.8";

// esm.sh serves the ESM build of genlayer-js straight to the browser — no bundler.
export const SDK_URL = `https://esm.sh/genlayer-js@${SDK_VERSION}`;
export const SDK_CHAINS_URL = `https://esm.sh/genlayer-js@${SDK_VERSION}/chains`;

// StudioNet — gasless hosted GenLayer Studio.
export const NETWORK = {
  key: "studionet",
  chainIdHex: "0xF22F", // 61999
  chainIdDec: 61999,
  chainName: "GenLayer StudioNet",
  rpcUrl: "https://studio.genlayer.com/api",
  explorerUrl: "https://studio.genlayer.com",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
};

// The deployed Escrogen contract address on StudioNet. Ships as the default;
// a user can still override it in the header field (persisted to localStorage).
export const CONTRACT_ADDRESS = "0x03Ee4A40b3550D7D3E1E559296bEcF668B9CB2d3";
const LS_KEY = "escrogen.contractAddress";
const DEFAULT_CONTRACT_ADDRESS = CONTRACT_ADDRESS;

export function getContractAddress() {
  try {
    return (localStorage.getItem(LS_KEY) || DEFAULT_CONTRACT_ADDRESS).trim();
  } catch {
    return DEFAULT_CONTRACT_ADDRESS;
  }
}

export function setContractAddress(addr) {
  const clean = (addr || "").trim();
  try {
    localStorage.setItem(LS_KEY, clean);
  } catch {
    /* ignore storage errors (private mode) */
  }
  return clean;
}

export function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test((addr || "").trim());
}
