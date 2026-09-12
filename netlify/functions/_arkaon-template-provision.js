/**
 * Free-template provisioning funnel (Phase A)
 * Issues instance id, wakes peer mesh, returns merchant CTA — no payout/draft execute.
 */
"use strict";

const crypto = require("crypto");
const { loadManifest } = require("./_arkaon-platform-onboarding");
const {
  loadPeerManifest,
  newSessionId,
  postPeerHandshake,
} = require("./_arkaon-peer-mesh");

const AFFILIATE_IDS = ["dosirak.store", "aibaeby.com"];
const DEFAULT_PEER_ACTIONS = ["hello", "capabilities", "propose_onboard"];

function newInstanceId(merchant = {}) {
  const hint = String(merchant.instanceId || merchant.shopSlug || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  if (hint.length >= 4) return hint;
  return `tpl_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function resolvePlatformIds(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const ids = raw.length ? raw : AFFILIATE_IDS.slice();
  const unknown = ids.filter((id) => !AFFILIATE_IDS.includes(id));
  if (unknown.length) {
    const err = new Error(`unsupported platformId: ${unknown.join(",")}`);
    err.code = "PLATFORM_UNSUPPORTED";
    throw err;
  }
  return [...new Set(ids)];
}

function buildMerchantCtaPack(platformIds) {
  const manifest = loadManifest();
  const peer = loadPeerManifest();
  const ids = platformIds && platformIds.length ? platformIds : AFFILIATE_IDS;
  const platforms = (manifest?.platforms || [])
    .filter((p) => ids.includes(p.id))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      onboardUrl: `${p.publicBase}${p.onboardingEntry || ""}`,
      signupUrl: `${p.publicBase}${p.signupEntry || p.onboardingEntry || ""}`,
      relation: p.relation,
      peerHandshakeEndpoint: p.peerHandshakeEndpoint || null,
    }));

  return {
    intent: "FREE_TEMPLATE_ONBOARD",
    businessPolicy: peer?.businessPolicy?.id || "free_template_to_platform_onboard_v1",
    headline: "업종 템플릿을 무료로 만들고, 계열 플랫폼에 바로 입점하세요",
    support:
      "템플릿에 탑재된 Arkaon이 플랫폼 Arkaon과 교신해 입점 절차를 이어 줍니다. 정산·약관 대리수락은 하지 않습니다.",
    localPage: "/free-template-onboard.html",
    platforms,
    forbidden: peer?.businessPolicy?.forbidden || [],
    phase: peer?.phase || "A",
  };
}

/**
 * HQ/agent: provision free template instance + optional peer hello/capabilities/propose.
 */
async function provisionFreeTemplate({
  platformIds,
  merchant = {},
  runPeer = true,
  peerActions = DEFAULT_PEER_ACTIONS,
} = {}) {
  const ids = resolvePlatformIds(platformIds);
  const instanceId = newInstanceId(merchant);
  const sessionId = newSessionId();
  const merchantSafe = {
    instanceId,
    shopName: String(merchant.shopName || merchant.name || "").slice(0, 80) || null,
    vertical: "restaurant",
    provisioning: "free_template_v1",
  };

  const cta = buildMerchantCtaPack(ids);
  const peerResults = [];

  if (runPeer) {
    const actions = (Array.isArray(peerActions) && peerActions.length
      ? peerActions
      : DEFAULT_PEER_ACTIONS
    ).filter((a) => DEFAULT_PEER_ACTIONS.includes(a) || a === "ack" || a === "status");

    for (const platformId of ids) {
      let lastSession = sessionId;
      for (const action of actions) {
        const result = await postPeerHandshake({
          platformId,
          action,
          sessionId: lastSession,
          merchant: merchantSafe,
          payload:
            action === "propose_onboard"
              ? {
                  intent: "FREE_TEMPLATE_ONBOARD",
                  instance_id: instanceId,
                  cta: {
                    localPage: cta.localPage,
                    onboardUrl: cta.platforms.find((p) => p.id === platformId)?.onboardUrl,
                  },
                }
              : { intent: "FREE_TEMPLATE_ONBOARD", instance_id: instanceId },
        });
        if (result.session_id) lastSession = result.session_id;
        peerResults.push({
          platformId,
          peerAction: action,
          ok: Boolean(result.ok),
          code: result.code || null,
          session_id: result.session_id || lastSession,
          capabilities: result.capabilities || null,
          next: result.next || null,
          message: result.message || null,
        });
        if (!result.ok && result.code === "PEER_ENV_MISSING") {
          break;
        }
      }
    }
  }

  const peerOkCount = peerResults.filter((r) => r.ok).length;
  const envBlocked = peerResults.some((r) => r.code === "PEER_ENV_MISSING");

  return {
    ok: true,
    phase: "A",
    mode: "template_provision",
    intent: "FREE_TEMPLATE_ONBOARD",
    instance_id: instanceId,
    session_id: sessionId,
    merchant: merchantSafe,
    platforms: ids,
    peer: {
      ran: Boolean(runPeer),
      okCount: peerOkCount,
      total: peerResults.length,
      envBlocked,
      results: peerResults,
    },
    cta,
    nextActions: [
      { type: "open_merchant_cta", url: cta.localPage },
      ...cta.platforms.map((p) => ({
        type: "open_platform_onboard",
        platformId: p.id,
        url: p.onboardUrl,
      })),
      {
        type: "await_merchant_consent",
        required: true,
        note: "동의 후 onboarding-execute 또는 template-connect-execute",
      },
      {
        type: "await_hq_live_order_relay",
        note: "주문 릴레이·정산은 HQ gate",
      },
    ],
    dnaLayer: "peer_mesh_dna",
    forbidden: cta.forbidden,
  };
}

module.exports = {
  AFFILIATE_IDS,
  buildMerchantCtaPack,
  newInstanceId,
  provisionFreeTemplate,
  resolvePlatformIds,
};
