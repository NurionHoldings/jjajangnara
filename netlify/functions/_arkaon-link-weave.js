/**
 * Link weave after consent — Template Arkaon asks Platform for scoped link_grant.
 * Simple orchestration; no payout; grant raw only in response once.
 */
"use strict";

const { postPeerHandshake } = require("./_arkaon-peer-mesh");
const { attestationForLink, getSessionById, getSessionByToken } = require("./_arkaon-consent-qr");

async function weaveAfterConsent({ sessionId, token, runPeer = true } = {}) {
  const session = sessionId ? getSessionById(sessionId) : getSessionByToken(token);
  if (!session) return { ok: false, code: "SESSION_NOT_FOUND" };
  if (session.status !== "signed" || !session.attestation) {
    return { ok: false, code: "CONSENT_NOT_SIGNED" };
  }

  const attestation = attestationForLink(session);
  const results = [];

  for (const platformId of session.platformIds || []) {
    if (!runPeer) {
      results.push({
        platformId,
        ok: true,
        code: "LINK_REQUEST_PREVIEW",
        preview: {
          action: "link_request",
          scopes: ["affiliate_draft", "template_bind"],
          attestation,
        },
      });
      continue;
    }

    const result = await postPeerHandshake({
      platformId,
      action: "link_request",
      sessionId: `lw_${session.id}`,
      merchant: {
        instanceId: session.instance_id,
        shopName: session.shop_name,
      },
      payload: {
        intent: "FREE_TEMPLATE_ONBOARD",
        scopes: ["affiliate_draft", "template_bind"],
        consent_attestation: attestation,
        consent_session_fp: session.token_fp,
      },
    });

    results.push({
      platformId,
      ok: Boolean(result.ok),
      code: result.code || null,
      session_id: result.session_id || null,
      grant_fp: result.grant_fp || result.peer?.grant_fp || null,
      expires_at: result.expires_at || null,
      next: result.next || null,
      message: result.message || null,
      // grant raw if platform returns — caller may store in vault; DNA must not
      grant: result.grant || null,
    });
  }

  return {
    ok: results.some((r) => r.ok) || results.every((r) => r.code === "LINK_REQUEST_PREVIEW"),
    mode: "link_weave",
    consent_session_id: session.id,
    consent_level: session.attestation.consent_level,
    results,
    dnaSafe: {
      consent_level: session.attestation.consent_level,
      method: session.attestation.method,
      platforms: results.map((r) => ({
        platformId: r.platformId,
        ok: r.ok,
        code: r.code,
        grant_fp: r.grant_fp,
      })),
    },
  };
}

module.exports = { weaveAfterConsent };
