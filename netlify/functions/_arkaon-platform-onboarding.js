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
  for (const row of intents) {
    for (const alias of row.aliases || []) {
      if (t.includes(normalizeText(alias))) {
        return row.intent;
      }
    }
  }
  return null;
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
  const intent = detectIntent(commandText, manifest);
  const platform = detectPlatform(commandText, manifest);

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

  return {
    ok: true,
    phase: manifest.phase || "A",
    mode: "propose_only",
    intent,
    platform: {
      id: platform.id,
      displayName: platform.displayName,
      status: platform.status,
      onboardingEntry: platform.publicBase + (platform.onboardingEntry || ""),
      signupEntry: platform.publicBase + (platform.signupEntry || ""),
      connectorMode: platform.connectorMode,
    },
    merchantProfile: profile,
    fieldMapping: manifest.fieldMapping,
    playbook: steps.map((step, index) => ({
      order: index + 1,
      step,
      autoExecutable:
        step !== "await_hq_go_live_if_settlement" &&
        step !== "request_merchant_consents" &&
        !String(step).includes("settlement"),
    })),
    nextActions: [
      {
        type: "open_entry",
        url: intent === "APP_INSTALL" ? platform.publicBase : platform.publicBase + (platform.onboardingEntry || ""),
      },
      {
        type: "await_merchant_consent",
        required: true,
      },
      ...(platform.id === "dosirak.store" && intent === "PLATFORM_ONBOARD"
        ? [
            {
              type: "post_affiliate_draft",
              action: "onboarding-execute",
              platformId: "dosirak.store",
              requiredConsents: ["privacyAt", "termsAt"],
              requiredMerchant: ["phone"],
              note: "동의·전화 확보 후 vendor-draft POST (계좌 자동기입 금지)",
            },
          ]
        : []),
      ...(platform.id === "aibaeby.com" && intent === "PLATFORM_ONBOARD"
        ? [
            {
              type: "post_affiliate_draft",
              action: "onboarding-execute",
              platformId: "aibaeby.com",
              requiredConsents: ["privacyAt", "termsAt"],
              requiredMerchant: ["phone"],
              note: "동의·전화 확보 후 merchant-draft POST (계좌 자동기입 금지)",
            },
          ]
        : []),
      {
        type: "hq_wire_connector",
        required: platform.status === "declared" || platform.status === "ready_for_connector_design",
        note: "커넥터 라이브/정산은 HQ 승인 후",
      },
    ],
    forbidden: manifest.authority?.forbidden || [],
    noTouchActions: noTouch.bannedActions || [],
    dnaLayer: "onboarding_dna",
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
