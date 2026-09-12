/**
 * ARKAON HQ participation (visit / change DNA / cross-check / wake / platform onboarding DNA)
 * Capability only — no finance mutate. Auth: X-ARKAON-AGENT-KEY or ARKAON_AGENT_HANDOFF_SECRET.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  loadManifest,
  loadNoTouch,
  planOnboarding,
} = require("./_arkaon-platform-onboarding");
const {
  describeConnectorReadiness: describeDosirakReadiness,
  postVendorDraft,
} = require("./_dosirak-vendor-draft-connector");
const {
  describeConnectorReadiness: describeAibaebyReadiness,
  postMerchantDraft,
} = require("./_aibaeby-merchant-draft-connector");
const {
  buildConnectAssistProfile,
  describeConnectReadiness,
  postTemplateBind,
} = require("./_template-connect-assist");

const STORE_PATH = path.join(process.cwd(), ".arkaon", "participation", "store.json");
const HOST_PROFILE_PATH = path.join(process.cwd(), ".arkaon", "participation", "host_profile.json");

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-ARKAON-AGENT-KEY",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(statusCode, data) {
  return { statusCode, headers, body: JSON.stringify(data) };
}

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {
      visits: [],
      change_dna: [],
      cross_checks: [],
      onboarding_dna: [],
      template_binds: [],
      wake: { status: "asleep", last_traffic_at: null },
    };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function authOk(event) {
  const expected = String(process.env.ARKAON_AGENT_HANDOFF_SECRET || "").trim();
  const provided = String(
    (event.headers && (event.headers["x-arkaon-agent-key"] || event.headers["X-ARKAON-AGENT-KEY"])) || ""
  ).trim();
  if (expected.length < 16) return true;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function loadHostProfile() {
  try {
    return JSON.parse(fs.readFileSync(HOST_PROFILE_PATH, "utf8"));
  } catch (_) {
    return {
      product: "unknown",
      primary_api_host: "netlify",
      edge_host: "netlify",
      handoff_secret_policy: "netlify_env_sufficient",
      notices: [
        {
          code: "HOST_PROFILE_MISSING_FILE",
          severity: "info",
          summary: "host_profile.json 없음 — Netlify Functions면 Netlify env 시크릿만으로 충분한 경우가 많음.",
        },
      ],
      secret_hosts: [{ host: "netlify", role: "functions", handoff: "sufficient" }],
    };
  }
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function stripSecrets(value) {
  const text = JSON.stringify(value);
  if (/sk_live|sk_test|password|accountNumber|주민/i.test(text)) {
    return { redacted: true };
  }
  return value;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!authOk(event)) return json(401, { success: false, message: "unauthorized" });

  const store = loadStore();
  if (!Array.isArray(store.onboarding_dna)) store.onboarding_dna = [];

  const qs = event.queryStringParameters || {};
  const action = qs.action || "wake";
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (_) {
      return json(400, { success: false, message: "invalid json" });
    }
  }

  if (event.httpMethod === "GET" && action === "wake") {
    store.wake = store.wake || {};
    store.wake.last_traffic_at = new Date().toISOString();
    store.wake.status = "awake";
    saveStore(store);
    return json(200, { success: true, data: store.wake });
  }

  if (event.httpMethod === "GET" && action === "host-profile") {
    return json(200, { success: true, data: loadHostProfile() });
  }

  if (event.httpMethod === "GET" && action === "no-touch-map") {
    return json(200, { success: true, data: loadNoTouch() });
  }

  if (event.httpMethod === "GET" && action === "platform-registry") {
    const manifest = loadManifest();
    if (!manifest) return json(404, { success: false, message: "manifest missing" });
    return json(200, {
      success: true,
      data: {
        phase: manifest.phase,
        status: manifest.status,
        platforms: manifest.platforms,
        commandIntents: manifest.commandIntents,
      },
    });
  }

  if (event.httpMethod === "POST" && action === "onboarding-intent") {
    const command = String(body.command || body.text || "").slice(0, 500);
    if (!command) {
      return json(400, { success: false, message: "command required", code: "COMMAND_REQUIRED" });
    }
    const plan = planOnboarding(command);
    const row = {
      id: id(),
      layer: "onboarding_dna",
      command: command.slice(0, 200),
      ok: Boolean(plan.ok),
      intent: plan.intent || null,
      platformId: plan.platform?.id || null,
      code: plan.code || null,
      // 시크릿·계좌·주민번호 등 저장 금지
      planSummary: stripSecrets({
        mode: plan.mode,
        playbook: plan.playbook,
        nextActions: plan.nextActions,
        platform: plan.platform
          ? { id: plan.platform.id, status: plan.platform.status }
          : null,
      }),
      created_at: new Date().toISOString(),
    };
    store.onboarding_dna.push(row);
    saveStore(store);
    return json(plan.ok ? 200 : 422, { success: plan.ok, data: plan, dnaId: row.id });
  }

  if (event.httpMethod === "GET" && action === "onboarding-dna") {
    return json(200, { success: true, data: store.onboarding_dna.slice(-50).reverse() });
  }

  if (event.httpMethod === "GET" && action === "connector-readiness") {
    return json(200, {
      success: true,
      data: {
        dosirak: describeDosirakReadiness(),
        aibaeby: describeAibaebyReadiness(),
        templateConnect: describeConnectReadiness(),
        note: "draft=신규 입점, template-connect=기존 업체 실연동. 정산·지급 실행 없음.",
      },
    });
  }

  /**
   * Existing template instance ↔ existing vendor bind (dosirak | aibaeby).
   * Body: { platformId, action?, vendor:{vendor_id,phone_last4}, consents:{privacyAt,termsAt,connectAt}, dryRun? }
   */
  if (event.httpMethod === "POST" && action === "template-connect-execute") {
    const platformId = String(body.platformId || body.platform || "").trim();
    if (platformId !== "dosirak.store" && platformId !== "aibaeby.com") {
      return json(422, {
        success: false,
        code: "PLATFORM_NOT_WIRED",
        message: "template-connect는 dosirak.store / aibaeby.com 만 지원",
      });
    }

    const result = await postTemplateBind({
      platformId,
      action: body.action || "bind",
      dryRun: body.dryRun === true,
      consents: body.consents || {},
      vendor: body.vendor || {},
      vendorId: body.vendorId,
      phoneLast4: body.phoneLast4,
      merchant: body.merchant || {},
      bindToken: body.bindToken || body.bind_token,
      bindId: body.bindId || body.bind_id,
    });

    const assist = buildConnectAssistProfile(result);
    if (!Array.isArray(store.template_binds)) store.template_binds = [];
    const row = {
      id: id(),
      layer: "onboarding_dna",
      kind: "template_instance_bind",
      platformId,
      ok: Boolean(result.ok),
      code: result.code || null,
      bind_id: result.bind_id || null,
      dry_run: Boolean(result.dry_run || body.dryRun),
      planSummary: stripSecrets({
        bind_status: result.bind_status || null,
        resume_url: result.resume_url || null,
        assist,
      }),
      created_at: new Date().toISOString(),
    };
    store.onboarding_dna.push(row);
    if (result.ok && result.bind_id) {
      store.template_binds.push({
        id: row.id,
        platformId,
        bind_id: result.bind_id,
        bind_status: result.bind_status,
        // bind_token 원문 저장 금지 — fingerprint만
        bind_token_fp: result.bind_token
          ? require("crypto").createHash("sha256").update(String(result.bind_token)).digest("hex").slice(0, 16)
          : null,
        created_at: row.created_at,
      });
    }
    saveStore(store);

    const softFail = ["CONSENT_REQUIRED", "VENDOR_REQUIRED", "PHONE_PROOF_REQUIRED"].includes(result.code);
    const status = result.ok ? 200 : softFail ? 400 : 422;
    return json(status, { success: result.ok, data: { ...result, assist }, dnaId: row.id });
  }

  /**
   * Consent-gated affiliate draft execute (dosirak.store | aibaeby.com).
   * Body: { platformId, consents:{privacyAt,termsAt}, merchant:{phone,...}, dryRun? }
   */
  if (event.httpMethod === "POST" && action === "onboarding-execute") {
    const platformId = String(body.platformId || body.platform || "dosirak.store").trim();
    let result;
    if (platformId === "dosirak.store") {
      result = await postVendorDraft({
        dryRun: body.dryRun === true,
        consents: body.consents || {},
        merchant: body.merchant || {},
        memo: body.memo,
      });
    } else if (platformId === "aibaeby.com") {
      result = await postMerchantDraft({
        dryRun: body.dryRun === true,
        consents: body.consents || {},
        merchant: body.merchant || {},
      });
    } else {
      return json(422, {
        success: false,
        code: "PLATFORM_NOT_WIRED",
        message: "Phase A execute는 dosirak.store / aibaeby.com 만 지원",
      });
    }

    const readiness =
      platformId === "aibaeby.com" ? describeAibaebyReadiness() : describeDosirakReadiness();

    const row = {
      id: id(),
      layer: "onboarding_dna",
      kind: "execute_draft",
      platformId,
      ok: Boolean(result.ok),
      code: result.code || null,
      draft_id: result.draft_id || null,
      dry_run: Boolean(result.dry_run || body.dryRun),
      planSummary: stripSecrets({
        statusCode: result.statusCode || null,
        draft_status: result.draft_status || null,
        resume_url: result.resume_url || null,
        connector: readiness,
      }),
      created_at: new Date().toISOString(),
    };
    store.onboarding_dna.push(row);
    saveStore(store);

    const status =
      result.ok ? 200 : result.code === "CONSENT_REQUIRED" || result.code === "PHONE_REQUIRED" ? 400 : 422;
    return json(status, { success: result.ok, data: result, dnaId: row.id });
  }

  if (event.httpMethod === "GET" && action === "agent-visits") {
    return json(200, { success: true, data: store.visits.filter((v) => v.status !== "closed").slice(-50) });
  }

  if (event.httpMethod === "POST" && action === "agent-visits-announce") {
    const row = {
      id: id(),
      agent: String(body.agent || "").toLowerCase(),
      purpose: String(body.purpose || "").slice(0, 300),
      areas: body.areas || [],
      requests: body.requests || [],
      status: "announced",
      work_split: [],
      announced_at: new Date().toISOString(),
    };
    if (row.agent !== "beom" && row.agent !== "gpt") {
      return json(400, { success: false, message: "agent beom|gpt" });
    }
    store.visits.push(row);
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  if (event.httpMethod === "POST" && action === "change-intent-dna") {
    const row = {
      id: id(),
      source: String(body.source || "beom").toLowerCase(),
      area: String(body.area || "ops").toLowerCase(),
      summary: String(body.summary || "").slice(0, 300),
      return_point: String(body.return_point || "").slice(0, 300),
      return_checklist: body.return_checklist || [],
      contract_pointers: body.contract_pointers || [],
      path_prefixes: body.path_prefixes || [],
      created_at: new Date().toISOString(),
    };
    store.change_dna.push(row);
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  if (event.httpMethod === "GET" && action === "change-intent-dna") {
    return json(200, { success: true, data: store.change_dna.slice(-50).reverse() });
  }

  if (event.httpMethod === "POST" && action === "cross-checks") {
    const author = String(body.author || "").toLowerCase();
    const reviewer = String(body.reviewer || "").toLowerCase();
    if (author === reviewer || !["beom", "gpt"].includes(author) || !["beom", "gpt"].includes(reviewer)) {
      return json(400, { success: false, message: "author≠reviewer beom|gpt" });
    }
    const row = {
      id: id(),
      author,
      reviewer,
      target_type: body.target_type || "change_dna",
      target_id: String(body.target_id || ""),
      summary: String(body.summary || "").slice(0, 300),
      status: "pending",
      announced_at: new Date().toISOString(),
    };
    store.cross_checks.push(row);
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  if (event.httpMethod === "GET" && action === "cross-checks") {
    return json(200, {
      success: true,
      data: store.cross_checks.filter((c) => c.status === "pending").slice(-50),
    });
  }

  if (event.httpMethod === "POST" && action === "cross-check-verdict") {
    const row = store.cross_checks.find((c) => c.id === body.id);
    if (!row) return json(404, { success: false, message: "not found" });
    if (String(body.reviewer || "").toLowerCase() !== row.reviewer) {
      return json(403, { success: false, message: "reviewer mismatch" });
    }
    row.status = String(body.verdict || "").toLowerCase();
    row.verdict_note = body.note || null;
    row.resolved_at = new Date().toISOString();
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  return json(404, { success: false, message: "unknown action" });
};
