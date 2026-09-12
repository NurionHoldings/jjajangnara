/**
 * Shared Arkaon guards for participation / execute paths.
 * Capability only — no finance mutate.
 */
"use strict";

const crypto = require("crypto");
const { loadNoTouch } = require("./_arkaon-platform-onboarding");

function authOk(event) {
  const expected = String(process.env.ARKAON_AGENT_HANDOFF_SECRET || "").trim();
  const provided = String(
    (event.headers && (event.headers["x-arkaon-agent-key"] || event.headers["X-ARKAON-AGENT-KEY"])) || ""
  ).trim();
  const allowDevOpen = String(process.env.ARKAON_DEV_FAIL_OPEN || "").trim() === "1";
  if (expected.length < 16) {
    // fail-closed unless explicit local/dev override
    return allowDevOpen;
  }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function authFailureStatus() {
  const expected = String(process.env.ARKAON_AGENT_HANDOFF_SECRET || "").trim();
  if (expected.length < 16) return 503;
  return 401;
}

function stripSecrets(value) {
  try {
    const text = JSON.stringify(value);
    if (
      /sk_live|sk_test|password|accountNumber|account_number|주민|bearer\s+[a-z0-9]|api[_-]?key|bind_token|phone["'\s:]+01\d{8,9}/i.test(
        text
      )
    ) {
      return { redacted: true };
    }
    if (value && typeof value === "object") {
      const out = Array.isArray(value) ? [] : {};
      for (const [k, v] of Object.entries(value)) {
        if (/secret|token|password|account|phone|email|authorization/i.test(k) && typeof v === "string") {
          out[k] = "[redacted]";
        } else if (v && typeof v === "object") {
          out[k] = stripSecrets(v);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    return value;
  } catch (_) {
    return { redacted: true };
  }
}

function assertNoTouchForExecute(body = {}) {
  const noTouch = loadNoTouch();
  const banned = noTouch.bannedActions || [];
  const requested = []
    .concat(body.actions || [])
    .concat(body.requestedActions || [])
    .concat(body.forceActions || [])
    .map((x) => String(x));

  for (const action of requested) {
    if (banned.includes(action)) {
      const err = new Error(`no-touch banned action: ${action}`);
      err.code = "NO_TOUCH_BLOCKED";
      throw err;
    }
  }

  const blob = JSON.stringify(body);
  const financeHints = [
    "execute_payout",
    "execute_refund",
    "mutate_bank_account",
    "account_number",
    "account_no",
    "bank_name",
    "settlementAccount",
  ];
  for (const hint of financeHints) {
    if (blob.includes(hint) || banned.includes(hint)) {
      // only block if present as field intent, not random substring in urls
      if (body[hint] != null || body.vendor?.[hint] != null || body.data?.[hint] != null || body.settlement?.[hint] != null) {
        const err = new Error(`no-touch finance field: ${hint}`);
        err.code = "NO_TOUCH_BLOCKED";
        throw err;
      }
    }
  }

  if (body.scrape === true || body.auto_accept_tos === true) {
    const err = new Error("no-touch scrape/auto_tos");
    err.code = "NO_TOUCH_BLOCKED";
    throw err;
  }
}

function requirePlatformId(body, allowed) {
  const platformId = String(body.platformId || body.platform || "").trim();
  if (!platformId) {
    const err = new Error("platformId required");
    err.code = "PLATFORM_REQUIRED";
    throw err;
  }
  if (allowed && !allowed.includes(platformId)) {
    const err = new Error("platform not wired");
    err.code = "PLATFORM_NOT_WIRED";
    throw err;
  }
  return platformId;
}

function hasOpenVisit(store) {
  return (store.visits || []).some((v) => v.status === "announced" || v.status === "open");
}

module.exports = {
  assertNoTouchForExecute,
  authFailureStatus,
  authOk,
  hasOpenVisit,
  requirePlatformId,
  stripSecrets,
};
