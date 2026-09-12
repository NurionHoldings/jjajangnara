/**
 * Template instance ↔ affiliate platform bind connector (dosirak + aibaeby).
 * For stores that already have a template AND an existing vendor account.
 */
"use strict";

const crypto = require("crypto");
const { MENUS, SETS } = require("./_menu-catalog");
const { buildTemplateMerchantProfile, loadManifest } = require("./_arkaon-platform-onboarding");

const FETCH_TIMEOUT_MS = 12000;

function menuCatalogDigest() {
  const payload = JSON.stringify({
    menus: Object.keys(MENUS).sort(),
    sets: Object.keys(SETS).sort(),
  });
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

function platformBindConfig(platformId) {
  if (platformId === "dosirak.store") {
    return {
      platformId,
      url: String(process.env.DOSIRAK_TEMPLATE_BIND_URL || "").trim(),
      secret: String(process.env.DOSIRAK_AFFILIATE_CONNECTOR_SECRET || "").trim(),
      defaultPath: "/api/template-bind",
    };
  }
  if (platformId === "aibaeby.com") {
    return {
      platformId,
      url: String(process.env.AIBAEBY_TEMPLATE_BIND_URL || "").trim(),
      secret: String(process.env.AIBAEBY_AFFILIATE_CONNECTOR_SECRET || "").trim(),
      defaultPath: "/api/template-bind",
    };
  }
  return null;
}

function buildTemplateIdentity(merchant = {}) {
  const profile = { ...buildTemplateMerchantProfile(), ...merchant };
  const manifest = loadManifest();
  return {
    product: "JJAJANGNARA",
    template_id: manifest?.productTemplate?.id || "restaurant-delivery-template",
    instance_id: String(
      merchant.instanceId || profile.instanceId || process.env.TEMPLATE_INSTANCE_ID || "jjajangnara-default"
    ).slice(0, 80),
    public_base: String(merchant.publicBase || process.env.TEMPLATE_PUBLIC_BASE || "").slice(0, 200),
    menu_catalog_digest: menuCatalogDigest(),
    capabilities: ["menu_snapshot", "order_relay_ready", "pos_bridge_assist"],
    storeName: profile.storeName,
  };
}

function buildBindPayload(input = {}) {
  const platformId = String(input.platformId || "").trim();
  const action = String(input.action || "bind").trim();
  const template = buildTemplateIdentity(input.merchant || {});
  const vendorId = String(input.vendor?.vendor_id || input.vendorId || "").trim();
  const phoneLast4 = String(input.vendor?.phone_last4 || input.phoneLast4 || "").replace(/\D/g, "");
  const privacyAt = String(input.consents?.privacyAt || "").trim();
  const termsAt = String(input.consents?.termsAt || "").trim();
  const connectAt = String(input.consents?.connectAt || privacyAt).trim();

  if (action === "status") {
    return {
      action: "status",
      bind_token: String(input.bindToken || input.bind_token || "").trim(),
      bind_id: String(input.bindId || input.bind_id || "").trim(),
    };
  }
  if (action === "challenge") {
    return {
      action: "challenge",
      template: { instance_id: template.instance_id },
      vendor: vendorId ? { vendor_id: vendorId } : undefined,
    };
  }

  if (!privacyAt || !termsAt || !connectAt) {
    const err = new Error("connect consents required");
    err.code = "CONSENT_REQUIRED";
    throw err;
  }
  if (!vendorId) {
    const err = new Error("existing vendor_id required");
    err.code = "VENDOR_REQUIRED";
    throw err;
  }
  if (!/^\d{4}$/.test(phoneLast4)) {
    const err = new Error("phone_last4 proof required");
    err.code = "PHONE_PROOF_REQUIRED";
    throw err;
  }

  return {
    dry_run: input.dryRun === true,
    action: "bind",
    template,
    vendor: { vendor_id: vendorId, phone_last4: phoneLast4 },
    consents: { privacyAt, termsAt, connectAt },
    assist: {
      mode: "template_instance_bind_v1",
      channels: ["menu_sync_snapshot", "order_webhook_ready", "pos_bridge_hint"],
    },
    platformId,
  };
}

async function postTemplateBind(input = {}) {
  const platformId = String(input.platformId || "").trim();
  const cfg = platformBindConfig(platformId);
  if (!cfg) {
    return { ok: false, code: "PLATFORM_NOT_WIRED", message: "unsupported platform" };
  }

  let payload;
  try {
    payload = buildBindPayload(input);
  } catch (error) {
    return { ok: false, code: error.code || "INVALID_BIND", message: String(error.message || error) };
  }

  if (!cfg.url || cfg.secret.length < 16) {
    return {
      ok: false,
      code: "CONNECTOR_ENV_MISSING",
      message: `${platformId} TEMPLATE_BIND_URL / AFFILIATE_CONNECTOR_SECRET 미설정`,
      draftPreview: {
        template_instance_id: payload.template?.instance_id || null,
        vendor_id: payload.vendor?.vendor_id || null,
        mode: "template_instance_bind_v1",
      },
    };
  }

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-AFFILIATE-CONNECTOR-KEY": cfg.secret,
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = { ok: false, error: "invalid_json_from_platform", raw: text.slice(0, 200) };
    }
    return {
      ok: Boolean(body.ok),
      statusCode: response.status,
      code: body.ok ? "BIND_ACCEPTED" : body.error || "BIND_REJECTED",
      bind_id: body.bind_id || null,
      bind_token: body.bind_token || null,
      bind_status: body.bind_status || null,
      assist: body.assist || null,
      resume_url: body.resume_url || null,
      dry_run: Boolean(body.dry_run),
      message: body.message || null,
      platformId,
    };
  } catch (err) {
    const timeout = err && err.name === "AbortError";
    return {
      ok: false,
      code: timeout ? "BIND_TIMEOUT" : "BIND_FETCH_FAILED",
      message: String(err.message || err),
      platformId,
    };
  } finally {
    clearTimeout(tid);
  }
}

function describeConnectReadiness() {
  return {
    dosirak: {
      ...platformBindConfig("dosirak.store"),
      secret: undefined,
      connectorConfigured: Boolean(
        platformBindConfig("dosirak.store").url &&
          platformBindConfig("dosirak.store").secret.length >= 16
      ),
    },
    aibaeby: {
      ...platformBindConfig("aibaeby.com"),
      secret: undefined,
      connectorConfigured: Boolean(
        platformBindConfig("aibaeby.com").url &&
          platformBindConfig("aibaeby.com").secret.length >= 16
      ),
    },
    mode: "template_instance_bind_v1",
    note: "기존 입점업체 실연동. draft 입점과 분리.",
  };
}

function buildConnectAssistProfile(bindResult = {}) {
  return {
    mode: "template_instance_bind_v1",
    platformId: bindResult.platformId || null,
    bind_id: bindResult.bind_id || null,
    bind_status: bindResult.bind_status || null,
    channels: bindResult.assist?.channels || ["menu_sync_snapshot", "order_webhook_ready", "pos_bridge_hint"],
    local: {
      posBridge: "pos-bridge/",
      connectAssist: "connect-assist/",
      menuCatalog: "netlify/functions/_menu-catalog.js",
    },
    next: [
      "store bind_token offline (secret-safe storage)",
      "run connect-assist against platform status",
      "HQ enable live order relay when ready",
    ],
  };
}

module.exports = {
  buildBindPayload,
  buildConnectAssistProfile,
  buildTemplateIdentity,
  describeConnectReadiness,
  menuCatalogDigest,
  platformBindConfig,
  postTemplateBind,
};
