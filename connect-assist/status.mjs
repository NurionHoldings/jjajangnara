/**
 * connect-assist status — poll platform bind status without storing secrets.
 * Usage:
 *   node connect-assist/status.mjs --platform dosirak --token-env BIND_TOKEN
 *   BIND_TOKEN=... DOSIRAK_TEMPLATE_BIND_URL=... DOSIRAK_AFFILIATE_CONNECTOR_SECRET=... node connect-assist/status.mjs --platform dosirak
 */
"use strict";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const platform = arg("platform", "dosirak");
  const tokenEnv = arg("token-env", "BIND_TOKEN");
  const bindToken = String(process.env[tokenEnv] || "").trim();
  if (!bindToken) {
    console.error(`Missing bind token env ${tokenEnv}`);
    process.exit(2);
  }

  let url = "";
  let secret = "";
  if (platform === "dosirak") {
    url = String(process.env.DOSIRAK_TEMPLATE_BIND_URL || "").trim();
    secret = String(process.env.DOSIRAK_AFFILIATE_CONNECTOR_SECRET || "").trim();
  } else if (platform === "aibaeby") {
    url = String(process.env.AIBAEBY_TEMPLATE_BIND_URL || "").trim();
    secret = String(process.env.AIBAEBY_AFFILIATE_CONNECTOR_SECRET || "").trim();
  } else {
    console.error("platform must be dosirak|aibaeby");
    process.exit(2);
  }

  if (!url || secret.length < 16) {
    console.error("bind URL / connector secret not configured");
    process.exit(2);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AFFILIATE-CONNECTOR-KEY": secret,
    },
    body: JSON.stringify({ action: "status", bind_token: bindToken }),
  });
  const body = await response.json().catch(() => ({}));
  // never print full token
  console.log(
    JSON.stringify(
      {
        ok: Boolean(body.ok),
        statusCode: response.status,
        bind_id: body.bind_id || null,
        bind_status: body.bind_status || null,
        platformId: body.platform || platform,
        assist: body.assist || null,
      },
      null,
      2
    )
  );
  process.exit(body.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
