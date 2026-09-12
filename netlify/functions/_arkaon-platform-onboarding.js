/**
 * Arkaon Platform Onboarding DNA — Phase A planner (propose/orchestrate only)
 * No payout / bank mutate / third-party scrape.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(
  process.cwd(),
  ".arkaon",
  "participation",
  "platform-onboarding-manifest.json"
);
const NO_TOUCH_PATH = path.join(process.cwd(), ".arkaon", "participation", "no-touch-map.json");

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function loadManifest() {
  return loadJson(MANIFEST_PATH, null);
}

function loadNoTouch() {
  return loadJson(NO_TOUCH_PATH, { bannedActions: [], bannedPathPrefixes: [] });
}

function normalizeText(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function detectPlatform(text, manifest) {
  const t = normalizeText(text);
  const platforms = manifest.platforms || [];
  for (const platform of platforms) {
    const needles = [
      platform.id,
      platform.displayName,
      platform.id.replace(".store", ""),
      platform.id.replace(".com", ""),
    ]
      .filter(Boolean)
      .map((value) => normalizeText(value));
    if (needles.some((needle) => needle && t.includes(needle))) {
      return platform;
    }
  }
  // Korean aliases
  if (t.includes("도시락")) {
    return platforms.find((p) => p.id === "dosirak.store") || null;
  }
  if (t.includes("배비") || t.includes("aibaeby") || t.includes("아이배비")) {
    return platforms.find((p) => p.id === "aibaeby.com") || null;
  }
  return null;
}

function detectIntent(text, manifest) {
  const t = normalizeText(text);
  const intents = manifest.commandIntents || [];
  const hits = [];
  for (const row of intents) {
    for (const alias of row.aliases || []) {
      if (t.includes(normalizeText(alias))) {
        hits.push(row.intent);
        break;
      }
    }
  }
  const unique = [...new Set(hits)];
  if (unique.length === 0) return { intent: null, ambiguous: false, candidates: [] };
  if (unique.length > 1) {
    // "입점" + "실연동/연동" together → prefer TEMPLATE_CONNECT only if connect-specific alias hit
    const connectHit = unique.includes("TEMPLATE_CONNECT");
    const onboardHit = unique.includes("PLATFORM_ONBOARD");
    if (connectHit && onboardHit) {
      const connectAliases = (intents.find((r) => r.intent === "TEMPLATE_CONNECT")?.aliases || []).map(
        (a) => normalizeText(a)
      );
      const strongConnect = connectAliases.some(
        (a) => a && t.includes(a) && a !== "이미 입점" && !["입점", "입점해줘"].includes(a)
      );
      if (strongConnect) return { intent: "TEMPLATE_CONNECT", ambiguous: false, candidates: unique };
      return { intent: null, ambiguous: true, candidates: unique };
    }
  }
  return { intent: unique[0], ambiguous: false, candidates: unique };
}

function buildTemplateMerchantProfile() {
  // Phase A: 템플릿 기본 프로필 스냅샷 (PII 최소, 시크릿 없음)
  return {
    storeName: "짜장나라 세종본점",
    vertical: "restaurant",
    phone: null,
    addressHint: "세종특별자치시",
    menuCatalogRef: "netlify/functions/_menu-catalog.js",
    deliveryNotes: "최소주문·영업시간은 매장 설정 따름",
    source: "jjajangnara-template",
  };
}

/**
 * @param {string} commandText 예: "도시락.store 입점해줘", "aibaeby 앱 다운로드"
 * @returns {object} plan — 실행이 아니라 제안/오케스트레이션 계약
 */
function planOnboarding(commandText) {
  const manifest = loadManifest();
  if (!manifest) {
    return {
      ok: false,
      code: "MANIFEST_MISSING",
      message: "platform-onboarding-manifest.json 이 없습니다.",
    };
  }

  const noTouch = loadNoTouch();
  const intentInfo = detectIntent(commandText, manifest);
  const intent = intentInfo && typeof intentInfo === "object" ? intentInfo.intent : intentInfo;
  const platform = detectPlatform(commandText, manifest);

  if (intentInfo && intentInfo.ambiguous) {
    return {
      ok: false,
      code: "INTENT_AMBIGUOUS",
      message: "입점(draft)과 실연동(bind) 의도가 함께 감지되었습니다. 하나를 지정해 주세요.",
      candidates: intentInfo.candidates,
      hint: ["도시락 입점해줘", "도시락 실연동"],
    };
  }

  if (!intent) {
    return {
      ok: false,
      code: "INTENT_UNKNOWN",
      message: "입점·앱다운로드·가입 의도를 인식하지 못했습니다.",
      hint: (manifest.commandIntents || []).map((row) => row.aliases[0]),
    };
  }

  if (!platform) {
    return {
      ok: false,
      code: "PLATFORM_REQUIRED",
      message: "계열 플랫폼을 지정해 주세요.",
      affiliatePlatforms: (manifest.platforms || [])
        .filter((p) => p.relation === "affiliate")
        .map((p) => ({ id: p.id, displayName: p.displayName, status: p.status })),
    };
  }

  if (platform.relation !== "affiliate") {
    return {
      ok: false,
      code: "NON_AFFILIATE_BLOCKED",
      message: "비계열 플랫폼 자동 입점은 Phase A에서 금지됩니다.",
      platformId: platform.id,
    };
  }

  const steps = (manifest.playbooks && manifest.playbooks[intent]) || [];
  const profile = buildTemplateMerchantProfile();

  const nextActions = [
    {
      type: "open_entry",
      url: intent === "APP_INSTALL" ? platform.publicBase : platform.publicBase + (platform.onboardingEntry || ""),
    },
    {
      type: "await_merchant_consent",
      required: true,
    },
  ];

  if (intent === "FREE_TEMPLATE_ONBOARD") {
    nextActions.push(
      {
        type: "template_provision",
        action: "template-provision",
        platformIds: [platform.id],
        note: "무료 템플릿 인스턴스 발급 + peer hello 자동",
        merchantCta: "/free-template-onboard.html",
      },
      {
        type: "peer_hello",
        action: "peer-mesh",
        peerAction: "hello",
        platformId: platform.id,
        note: "템플릿 Arkaon → 플랫폼 Arkaon hello",
      },
      {
        type: "peer_capabilities",
        action: "peer-mesh",
        peerAction: "capabilities",
        platformId: platform.id,
      },
      {
        type: "peer_propose_onboard",
        action: "peer-mesh",
        peerAction: "propose_onboard",
        platformId: platform.id,
      }
    );
  }

  if (intent === "TEMPLATE_CONNECT") {
    nextActions.push({
      type: "post_template_bind",
      action: "template-connect-execute",
      platformId: platform.id,
      requiredConsents: ["privacyAt", "termsAt", "connectAt"],
      requiredProof: ["vendor_id", "phone_last4"],
      note: "기존 입점업체 증명 후 템플릿 인스턴스 바인드 (draft 아님)",
      assist: "connect-assist/",
    });
  }

  if (platform.id === "dosirak.store" && intent === "PLATFORM_ONBOARD") {
    nextActions.push({
      type: "post_affiliate_draft",
      action: "onboarding-execute",
      platformId: "dosirak.store",
      requiredConsents: ["privacyAt", "termsAt"],
      requiredMerchant: ["phone"],
      note: "동의·전화 확보 후 vendor-draft POST (계좌 자동기입 금지)",
    });
  }

  if (platform.id === "aibaeby.com" && intent === "PLATFORM_ONBOARD") {
    nextActions.push({
      type: "post_affiliate_draft",
      action: "onboarding-execute",
      platformId: "aibaeby.com",
      requiredConsents: ["privacyAt", "termsAt"],
      requiredMerchant: ["phone"],
      note: "동의·전화 확보 후 merchant-draft POST (계좌 자동기입 금지)",
    });
  }

  nextActions.push({
    type: "hq_wire_connector",
    required: platform.status === "declared" || platform.status === "ready_for_connector_design",
    note: "커넥터 라이브/정산은 HQ 승인 후",
  });

  return {
    ok: true,
    phase: manifest.phase || "A",
    mode:
      intent === "TEMPLATE_CONNECT"
        ? "template_connect_assist"
        : intent === "FREE_TEMPLATE_ONBOARD"
          ? "peer_mesh_orchestrate"
          : "propose_only",
    intent,
    platform: {
      id: platform.id,
      displayName: platform.displayName,
      status: platform.status,
      onboardingEntry: platform.publicBase + (platform.onboardingEntry || ""),
      signupEntry: platform.publicBase + (platform.signupEntry || ""),
      connectorMode: platform.connectorMode,
      bindEndpoint: platform.bindEndpoint || null,
      draftEndpoint: platform.draftEndpoint || null,
    },
    merchantProfile: profile,
    fieldMapping: manifest.fieldMapping,
    playbook: steps.map((step, index) => ({
      order: index + 1,
      step,
      autoExecutable:
        step !== "await_hq_go_live_if_settlement" &&
        step !== "await_hq_live_order_relay" &&
        step !== "request_merchant_consents" &&
        step !== "request_bind_consents" &&
        step !== "prove_existing_vendor" &&
        !String(step).includes("settlement"),
    })),
    nextActions,
    forbidden: manifest.authority?.forbidden || [],
    noTouchActions: noTouch.bannedActions || [],
    dnaLayer:
      intent === "TEMPLATE_CONNECT"
        ? "template_bind_dna"
        : intent === "FREE_TEMPLATE_ONBOARD"
          ? "peer_mesh_dna"
          : "onboarding_dna",
    navigationDnaSeparate: true,
  };
}

module.exports = {
  buildTemplateMerchantProfile,
  detectIntent,
  detectPlatform,
  loadManifest,
  loadNoTouch,
  planOnboarding,
};
