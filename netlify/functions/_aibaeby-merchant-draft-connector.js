/**
 * aibaeby.com merchant-draft first-party connector
 * Phase A: consent-gated draft only — no bank / secrets / payout.
 */
"use strict";

const { MENUS, SETS } = require("./_menu-catalog");
const { buildTemplateMerchantProfile, loadManifest } = require("./_arkaon-platform-onboarding");

const PLATFORM_ID = "aibaeby.com";
const DEFAULT_DRAFT_PATH = "/api/affiliate/merchant-draft"; // alias: /api/vendor-draft
const FETCH_TIMEOUT_MS = 12000;

function connectorConfig() {
  const url = String(process.env.AIBAEBY_MERCHANT_DRAFT_URL || "").trim();
  const secret = String(process.env.AIBAEBY_AFFILIATE_CONNECTOR_SECRET || "").trim();
  return {
    url,
    secret,
    configured: Boolean(url && secret.length >= 16),
  };
}

function buildMenuCatalogSnapshot() {
  const menuLines = Object.values(MENUS).map(
    (row) => `${row.name} ${Number(row.unitPrice || 0).toLocaleString("ko-KR")}원`
  );
  const setLines = Object.values(SETS).map(
    (row) => `${row.name} ${Number(row.basePrice || 0).toLocaleString("ko-KR")}원~`
  );
  const ids = [...Object.keys(MENUS), ...Object.keys(SETS)];
  return {
    menu_catalog_ids: ids.slice(0, 50),
    menu_summary: [...menuLines, ...setLines].join(" / ").slice(0, 2000),
  };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function buildMerchantDraftPayload(input = {}) {
  const profile = { ...buildTemplateMerchantProfile(), ...(input.merchant || {}) };
  const catalog = buildMenuCatalogSnapshot();
  const phone = normalizePhone(profile.phone);
  const privacyAt = String(input.consents?.privacyAt || input.consents?.consent_privacy || "").trim();
  const termsAt = String(input.consents?.termsAt || input.consents?.consent_terms || "").trim();

  if (!privacyAt || !termsAt) {
    const err = new Error("merchant consents required");
    err.code = "CONSENT_REQUIRED";
    throw err;
  }
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    const err = new Error("valid merchant phone required");
    err.code = "PHONE_REQUIRED";
    throw err;
  }

  const data = {
    source_template: "jjajangnara",
    source_instance: String(profile.source || "jjajangnara-template").slice(0, 80),
    shop_name: String(profile.storeName || "짜장나라").slice(0, 120),
    representative_name: String(profile.repName || "").slice(0, 80),
    phone,
    email: String(profile.email || "").slice(0, 120),
    address: String(profile.addressHint || "").slice(0, 200),
    delivery_areas: String(profile.deliveryNotes || profile.addressHint || "").slice(0, 300),
    categories: String(profile.categories || "중식").slice(0, 200),
    menu_summary: catalog.menu_summary,
    menu_catalog_ids: catalog.menu_catalog_ids,
    consent_privacy: privacyAt,
    consent_terms: termsAt,
  };

  return {
    dry_run: input.dryRun === true,
    source_template: "jjajangnara",
    data,
  };
}

async function postMerchantDraft(input = {}) {
  const cfg = connectorConfig();
  let payload;
  try {
    payload = buildMerchantDraftPayload(input);
  } catch (error) {
    return {
      ok: false,
      code: error.code || "INVALID_DRAFT",
      message: String(error.message || error),
    };
  }

  if (!cfg.configured) {
    return {
      ok: false,
      code: "CONNECTOR_ENV_MISSING",
      message: "AIBAEBY_MERCHANT_DRAFT_URL / AIBAEBY_AFFILIATE_CONNECTOR_SECRET 미설정",
      resumeHint: "Netlify/API env 설정 후 onboarding-execute 재시도",
      draftPreview: {
        shop_name: payload.data.shop_name,
        menu_catalog_ids: payload.data.menu_catalog_ids,
        registration_tier: "affiliate_draft_v1",
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
      body = { ok: false, error: "invalid_json_from_aibaeby", raw: text.slice(0, 200) };
    }
    return {
      ok: Boolean(body.ok),
      statusCode: response.status,
      code: body.ok ? "DRAFT_ACCEPTED" : body.error || "DRAFT_REJECTED",
      draft_id: body.draft_id || null,
      draft_status: body.draft_status || null,
      resume_url: body.resume_url
        ? absoluteResume(cfg.url, body.resume_url)
        : null,
      dry_run: Boolean(body.dry_run),
      message: body.message || null,
    };
  } catch (err) {
    const timeout = err && err.name === "AbortError";
    return {
      ok: false,
      code: timeout ? "AIBAEBY_TIMEOUT" : "AIBAEBY_FETCH_FAILED",
      message: String(err.message || err),
    };
  } finally {
    clearTimeout(tid);
  }
}

function absoluteResume(draftUrl, resumePath) {
  try {
    const base = new URL(draftUrl);
    return new URL(resumePath, `${base.protocol}//${base.host}`).toString();
  } catch (_) {
    return resumePath;
  }
}

function describeConnectorReadiness() {
  const manifest = loadManifest();
  const platform = (manifest?.platforms || []).find((p) => p.id === PLATFORM_ID) || null;
  const cfg = connectorConfig();
  return {
    platformId: PLATFORM_ID,
    platformStatus: platform?.status || null,
    connectorConfigured: cfg.configured,
    draftEndpointConfigured: Boolean(cfg.url),
    defaultPath: DEFAULT_DRAFT_PATH,
  };
}

module.exports = {
  PLATFORM_ID,
  buildMenuCatalogSnapshot,
  buildMerchantDraftPayload,
  connectorConfig,
  describeConnectorReadiness,
  postMerchantDraft,
};
