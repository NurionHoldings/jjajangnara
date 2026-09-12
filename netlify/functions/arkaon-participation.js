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
  assertNoTouchForExecute,
  authFailureStatus,
  authOk,
  hasOpenVisit,
  requirePlatformId,
  stripSecrets,
} = require("./_arkaon-guards");
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
const {
  describePeerReadiness,
  loadPeerManifest,
  postPeerHandshake,
} = require("./_arkaon-peer-mesh");

const STORE_PATH = path.join(process.cwd(), ".arkaon", "participation", "store.json");
const HOST_PROFILE_PATH = path.join(process.cwd(), ".arkaon", "participation", "host_profile.json");
const REQUIRE_OPEN_VISIT = String(process.env.ARKAON_REQUIRE_OPEN_VISIT || "").trim() === "1";

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
      template_bind_dna: [],
      template_binds: [],
      wake: { status: "asleep", last_traffic_at: null },
    };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
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

function guardExecute(store, body) {
  assertNoTouchForExecute(body);
  if (REQUIRE_OPEN_VISIT && !hasOpenVisit(store)) {
    const err = new Error("open agent visit required before execute");
    err.code = "VISIT_REQUIRED";
    throw err;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!authOk(event)) {
    return json(authFailureStatus(), {
      success: false,
      message: "unauthorized",
      code: authFailureStatus() === 503 ? "AGENT_SECRET_MISSING" : "UNAUTHORIZED",
      hint: "Set ARKAON_AGENT_HANDOFF_SECRET (≥16). Local only: ARKAON_DEV_FAIL_OPEN=1",
    });
  }

  const store = loadStore();
  if (!Array.isArray(store.onboarding_dna)) store.onboarding_dna = [];
  if (!Array.isArray(store.template_bind_dna)) store.template_bind_dna = [];
  if (!Array.isArray(store.template_binds)) store.template_binds = [];
  if (!Array.isArray(store.peer_mesh_dna)) store.peer_mesh_dna = [];

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
    const dnaLayer =
      plan.intent === "TEMPLATE_CONNECT"
        ? "template_bind_dna"
        : plan.intent === "FREE_TEMPLATE_ONBOARD"
          ? "peer_mesh_dna"
          : "onboarding_dna";
    const row = {
      id: id(),
      layer: dnaLayer,
      command: command.slice(0, 200),
      ok: Boolean(plan.ok),
      intent: plan.intent || null,
      platformId: plan.platform?.id || null,
      code: plan.code || null,
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
    if (dnaLayer === "template_bind_dna") store.template_bind_dna.push(row);
    else if (dnaLayer === "peer_mesh_dna") store.peer_mesh_dna.push(row);
    else store.onboarding_dna.push(row);
    saveStore(store);
    return json(plan.ok ? 200 : 422, { success: plan.ok, data: plan, dnaId: row.id });
  }

  if (event.httpMethod === "GET" && action === "onboarding-dna") {
    return json(200, { success: true, data: store.onboarding_dna.slice(-50).reverse() });
  }

  if (event.httpMethod === "GET" && action === "template-bind-dna") {
    return json(200, { success: true, data: store.template_bind_dna.slice(-50).reverse() });
  }

  if (event.httpMethod === "GET" && action === "peer-mesh-dna") {
    return json(200, { success: true, data: store.peer_mesh_dna.slice(-50).reverse() });
  }

  if (event.httpMethod === "GET" && action === "peer-mesh-manifest") {
    const manifest = loadPeerManifest();
    if (!manifest) return json(404, { success: false, message: "peer mesh manifest missing" });
    return json(200, { success: true, data: manifest });
  }

  if (event.httpMethod === "GET" && action === "connector-readiness") {
    return json(200, {
      success: true,
      data: {
        dosirak: describeDosirakReadiness(),
        aibaeby: describeAibaebyReadiness(),
        templateConnect: describeConnectReadiness(),
        peerMesh: describePeerReadiness(),
        auth: {
          agentSecretConfigured:
            String(process.env.ARKAON_AGENT_HANDOFF_SECRET || "").trim().length >= 16,
          requireOpenVisit: REQUIRE_OPEN_VISIT,
          storeDurable: false,
          storeNote: "Netlify Functions filesystem is ephemeral; treat DNA as session/local ledger",
        },
        note: "draft / template-connect / peer-mesh. 정산·지급 실행 없음.",
      },
    });
  }

  /**
   * Template Arkaon → Platform Arkaon peer mesh.
   * Body: { platformId, peerAction: hello|capabilities|propose_onboard|ack|status, sessionId?, merchant? }
   */
  if (event.httpMethod === "POST" && action === "peer-mesh") {
    try {
      guardExecute(store, body);
    } catch (error) {
      return json(403, { success: false, code: error.code || "GUARD_BLOCKED", message: error.message });
    }
    let platformId;
    try {
      platformId = requirePlatformId(body, ["dosirak.store", "aibaeby.com"]);
    } catch (error) {
      return json(422, { success: false, code: error.code, message: error.message });
    }

    const result = await postPeerHandshake({
      platformId,
      action: body.peerAction || body.action || "hello",
      sessionId: body.sessionId || body.session_id,
      merchant: body.merchant || {},
      payload: body.payload || {},
    });

    const row = {
      id: id(),
      layer: "peer_mesh_dna",
      kind: "peer_handshake",
      platformId,
      ok: Boolean(result.ok),
      code: result.code || null,
      session_id: result.session_id || null,
      peerAction: body.peerAction || body.action || "hello",
      planSummary: stripSecrets({
        peer: result.peer,
        capabilities: result.capabilities,
        next: result.next,
      }),
      created_at: new Date().toISOString(),
    };
    store.peer_mesh_dna.push(row);
    saveStore(store);

    const status = result.ok ? 200 : result.code === "PEER_ENV_MISSING" ? 422 : 502;
    return json(status, { success: result.ok, data: result, dnaId: row.id });
  }

  /**
   * Existing template instance ↔ existing vendor bind (dosirak | aibaeby).
   */
  if (event.httpMethod === "POST" && action === "template-connect-execute") {
    try {
      guardExecute(store, body);
    } catch (error) {
      return json(403, { success: false, code: error.code || "GUARD_BLOCKED", message: error.message });
    }

    let platformId;
    try {
      platformId = requirePlatformId(body, ["dosirak.store", "aibaeby.com"]);
    } catch (error) {
      return json(422, { success: false, code: error.code, message: error.message });
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
      challengeToken: body.challengeToken || body.challenge_token,
    });

    const assist = buildConnectAssistProfile(result);
    // never echo full bind_token into DNA; response may include once for caller
    const safeResult = { ...result };
    if (safeResult.bind_token) {
      safeResult.bind_token_fp = crypto
        .createHash("sha256")
        .update(String(safeResult.bind_token))
        .digest("hex")
        .slice(0, 16);
    }

    const row = {
      id: id(),
      layer: "template_bind_dna",
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
        bind_token_fp: safeResult.bind_token_fp || null,
      }),
      created_at: new Date().toISOString(),
    };
    store.template_bind_dna.push(row);
    if (result.ok && result.bind_id) {
      store.template_binds.push({
        id: row.id,
        platformId,
        bind_id: result.bind_id,
        bind_status: result.bind_status,
        bind_token_fp: safeResult.bind_token_fp || null,
        created_at: row.created_at,
      });
    }
    saveStore(store);

    const softFail = [
      "CONSENT_REQUIRED",
      "CONNECT_CONSENT_REQUIRED",
      "VENDOR_REQUIRED",
      "PHONE_PROOF_REQUIRED",
      "CHALLENGE_REQUIRED",
    ].includes(result.code);
    const status = result.ok ? 200 : softFail ? 400 : 422;
    return json(status, {
      success: result.ok,
      data: { ...result, assist, bind_token_fp: safeResult.bind_token_fp || null },
      dnaId: row.id,
    });
  }

  /**
   * Consent-gated affiliate draft execute (dosirak.store | aibaeby.com).
   */
  if (event.httpMethod === "POST" && action === "onboarding-execute") {
    try {
      guardExecute(store, body);
    } catch (error) {
      return json(403, { success: false, code: error.code || "GUARD_BLOCKED", message: error.message });
    }

    let platformId;
    try {
      platformId = requirePlatformId(body, ["dosirak.store", "aibaeby.com"]);
    } catch (error) {
      return json(422, { success: false, code: error.code, message: error.message });
    }

    let result;
    if (platformId === "dosirak.store") {
      result = await postVendorDraft({
        dryRun: body.dryRun === true,
        consents: body.consents || {},
        merchant: body.merchant || {},
        memo: body.memo,
      });
    } else {
      result = await postMerchantDraft({
        dryRun: body.dryRun === true,
        consents: body.consents || {},
        merchant: body.merchant || {},
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
    store.visits.push(stripSecrets(row));
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  if (event.httpMethod === "POST" && action === "agent-visits-close") {
    const visitId = String(body.id || "").trim();
    const row = store.visits.find((v) => v.id === visitId);
    if (!row) return json(404, { success: false, message: "not found" });
    row.status = "closed";
    row.closed_at = new Date().toISOString();
    saveStore(store);
    return json(200, { success: true, data: row });
  }

  if (event.httpMethod === "POST" && action === "change-intent-dna") {
    const row = stripSecrets({
      id: id(),
      source: String(body.source || "beom").toLowerCase(),
      area: String(body.area || "ops").toLowerCase(),
      summary: String(body.summary || "").slice(0, 300),
      return_point: String(body.return_point || "").slice(0, 300),
      return_checklist: body.return_checklist || [],
      contract_pointers: body.contract_pointers || [],
      path_prefixes: body.path_prefixes || [],
      created_at: new Date().toISOString(),
    });
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
