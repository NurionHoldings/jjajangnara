/**
 * Arkaon Peer Mesh — template ↔ platform handshake (Phase A)
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(
  process.cwd(),
  ".arkaon",
  "participation",
  "peer-mesh-manifest.json"
);

function loadPeerManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (_) {
    return null;
  }
}

function peerSecretFor(platformId) {
  const dedicated = String(process.env.ARKAON_PEER_MESH_SECRET || "").trim();
  if (dedicated.length >= 16) return dedicated;
  if (String(process.env.ARKAON_PEER_ALLOW_CONNECTOR_SECRET || "").trim() !== "1") {
    return "";
  }
  if (platformId === "dosirak.store") {
    return String(process.env.DOSIRAK_AFFILIATE_CONNECTOR_SECRET || "").trim();
  }
  if (platformId === "aibaeby.com") {
    return String(process.env.AIBAEBY_AFFILIATE_CONNECTOR_SECRET || "").trim();
  }
  return "";
}

function peerEndpoint(platformId) {
  if (platformId === "dosirak.store") {
    return String(process.env.DOSIRAK_PEER_HANDSHAKE_URL || "").trim();
  }
  if (platformId === "aibaeby.com") {
    return String(process.env.AIBAEBY_PEER_HANDSHAKE_URL || "").trim();
  }
  return "";
}

function buildTemplatePeerIdentity(merchant = {}) {
  const manifest = loadPeerManifest();
  return {
    role: "template_arkaon",
    product: manifest?.peers?.find((p) => p.role === "template_arkaon")?.productFamily ||
      "restaurant-delivery-template",
    instance_id: String(
      merchant.instanceId || process.env.TEMPLATE_INSTANCE_ID || "jjajangnara-default"
    ).slice(0, 80),
    provisioning: "free_template_v1",
    vertical: "restaurant",
  };
}

function newSessionId() {
  return `pm_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function buildHelloEnvelope({ platformId, sessionId, merchant }) {
  return {
    protocol: "arkaon-peer-mesh/v1",
    action: "hello",
    session_id: sessionId || newSessionId(),
    from: buildTemplatePeerIdentity(merchant),
    to: { role: "platform_arkaon", platform_id: platformId },
    payload: {
      intent: "FREE_TEMPLATE_ONBOARD",
      business_policy: "free_template_to_platform_onboard_v1",
    },
  };
}

function planFreeTemplateOnboard(commandText, platform) {
  const manifest = loadPeerManifest();
  if (!manifest) {
    return { ok: false, code: "PEER_MANIFEST_MISSING" };
  }
  const steps = manifest.provisioningFunnel?.steps || [];
  return {
    ok: true,
    phase: manifest.phase,
    mode: "peer_mesh_orchestrate",
    intent: "FREE_TEMPLATE_ONBOARD",
    platform: platform
      ? { id: platform.id, displayName: platform.displayName, status: platform.status }
      : null,
    playbook: steps.map((step, index) => ({
      order: index + 1,
      step,
      autoExecutable: ![
        "request_merchant_consents",
        "await_hq_live_order_relay",
        "post_affiliate_draft_or_bind",
      ].includes(step),
    })),
    nextActions: [
      { type: "peer_hello", action: "peer-mesh", peerAction: "hello" },
      { type: "peer_capabilities", action: "peer-mesh", peerAction: "capabilities" },
      { type: "await_merchant_consent", required: true },
      {
        type: "post_affiliate_draft_or_bind",
        note: "동의 후 onboarding-execute 또는 template-connect-execute",
      },
    ],
    dnaLayer: "peer_mesh_dna",
    forbidden: manifest.businessPolicy?.forbidden || [],
  };
}

async function postPeerHandshake({ platformId, action, sessionId, merchant, payload }) {
  const url = peerEndpoint(platformId);
  const secret = peerSecretFor(platformId);
  if (!url || secret.length < 16) {
    return {
      ok: false,
      code: "PEER_ENV_MISSING",
      message: `${platformId} PEER_HANDSHAKE_URL / ARKAON_PEER_MESH_SECRET 미설정`,
      preview: {
        action,
        from: buildTemplatePeerIdentity(merchant),
        to: { role: "platform_arkaon", platform_id: platformId },
      },
    };
  }

  const envelope = {
    protocol: "arkaon-peer-mesh/v1",
    action: action || "hello",
    session_id: sessionId || newSessionId(),
    from: buildTemplatePeerIdentity(merchant),
    to: { role: "platform_arkaon", platform_id: platformId },
    payload: payload || {},
  };

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-ARKAON-PEER-KEY": secret,
      },
      body: JSON.stringify(envelope),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = { ok: false, error: "invalid_json_from_peer", raw: text.slice(0, 200) };
    }
    return {
      ok: Boolean(body.ok),
      statusCode: response.status,
      code: body.ok ? "PEER_OK" : body.error || "PEER_REJECTED",
      session_id: body.session_id || envelope.session_id,
      peer: body.from || null,
      capabilities: body.capabilities || null,
      next: body.next || null,
      message: body.message || null,
      platformId,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.name === "AbortError" ? "PEER_TIMEOUT" : "PEER_FETCH_FAILED",
      message: String(err.message || err),
      platformId,
    };
  } finally {
    clearTimeout(tid);
  }
}

function describePeerReadiness() {
  return {
    dosirak: {
      urlConfigured: Boolean(peerEndpoint("dosirak.store")),
      secretConfigured: peerSecretFor("dosirak.store").length >= 16,
      endpointHint: "/api/arkaon/peer-handshake",
    },
    aibaeby: {
      urlConfigured: Boolean(peerEndpoint("aibaeby.com")),
      secretConfigured: peerSecretFor("aibaeby.com").length >= 16,
      endpointHint: "/api/arkaon/peer-handshake",
    },
    protocol: "arkaon-peer-mesh/v1",
    dnaLayer: "peer_mesh_dna",
  };
}

module.exports = {
  buildHelloEnvelope,
  buildTemplatePeerIdentity,
  describePeerReadiness,
  loadPeerManifest,
  newSessionId,
  peerEndpoint,
  peerSecretFor,
  planFreeTemplateOnboard,
  postPeerHandshake,
};
