/**
 * Free-template provision CLI — wake peer mesh for affiliate platforms.
 * Usage:
 *   ARKAON_AGENT_HANDOFF_SECRET=... node peer-mesh/provision.mjs --platform dosirak
 *   node peer-mesh/provision.mjs --platform both --shop "세종짜장" --dry-peer
 *
 * Calls local Netlify function handler via require (no network to self),
 * or --remote BASE_URL for deployed template.
 */
"use strict";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function mapPlatform(flag) {
  const v = String(flag || "both").toLowerCase();
  if (v === "dosirak" || v === "dosirak.store") return ["dosirak.store"];
  if (v === "aibaeby" || v === "aibaeby.com") return ["aibaeby.com"];
  if (v === "both" || v === "all") return ["dosirak.store", "aibaeby.com"];
  return null;
}

async function viaRemote(baseUrl, body, secret) {
  const url = `${baseUrl.replace(/\/$/, "")}/.netlify/functions/arkaon-participation?action=template-provision`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ARKAON-AGENT-KEY": secret,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { statusCode: response.status, body: data };
}

async function viaLocal(body) {
  process.env.ARKAON_DEV_FAIL_OPEN = process.env.ARKAON_DEV_FAIL_OPEN || "1";
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const arkaon = require("../netlify/functions/arkaon-participation.js");
  const result = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "template-provision" },
    headers: {},
    body: JSON.stringify(body),
  });
  return {
    statusCode: result.statusCode,
    body: JSON.parse(result.body || "{}"),
  };
}

async function main() {
  const platforms = mapPlatform(arg("platform", "both"));
  if (!platforms) {
    console.error("platform must be dosirak|aibaeby|both");
    process.exit(2);
  }

  const body = {
    platformIds: platforms,
    runPeer: !hasFlag("dry-peer"),
    merchant: {
      shopName: arg("shop", ""),
      instanceId: arg("instance", ""),
    },
  };

  const remote = arg("remote", "");
  let out;
  if (remote) {
    const secret = String(process.env.ARKAON_AGENT_HANDOFF_SECRET || "").trim();
    if (secret.length < 16) {
      console.error("ARKAON_AGENT_HANDOFF_SECRET required for --remote");
      process.exit(2);
    }
    out = await viaRemote(remote, body, secret);
  } else {
    out = await viaLocal(body);
  }

  const data = out.body?.data || out.body;
  // never print secrets
  console.log(
    JSON.stringify(
      {
        statusCode: out.statusCode,
        ok: Boolean(out.body?.success ?? data?.ok),
        instance_id: data?.instance_id || null,
        session_id: data?.session_id || null,
        peer: data?.peer
          ? {
              ran: data.peer.ran,
              okCount: data.peer.okCount,
              total: data.peer.total,
              envBlocked: data.peer.envBlocked,
              codes: (data.peer.results || []).map((r) => ({
                platformId: r.platformId,
                peerAction: r.peerAction,
                ok: r.ok,
                code: r.code,
              })),
            }
          : null,
        cta: data?.cta
          ? {
              localPage: data.cta.localPage,
              platforms: (data.cta.platforms || []).map((p) => ({
                id: p.id,
                onboardUrl: p.onboardUrl,
              })),
            }
          : null,
      },
      null,
      2
    )
  );
  process.exit(out.statusCode >= 200 && out.statusCode < 300 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
