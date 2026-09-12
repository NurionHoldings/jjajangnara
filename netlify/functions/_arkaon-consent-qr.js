/**
 * Consent QR — representative signs once; optional USB cert strengthen.
 * Externally one QR + one button. Internally attestation + link weave handoff.
 *
 * Legal framing (KR): captures intentional electronic consent record for
 * affiliate onboarding (privacy/terms[/connect]). Simple sign ≠ 공인/공동인증
 * required acts. USB path records certificate-backed attestation when provided.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(process.cwd(), ".arkaon", "participation", "consent-sessions.json");
const TTL_MS = 30 * 60 * 1000;
const SCOPES_DEFAULT = ["privacy", "terms"];

function nowIso() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function token() {
  return `cq_${crypto.randomBytes(18).toString("base64url")}`;
}

function fp(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch (_) {
    return { sessions: {} };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  // prune expired unsigned
  const cutoff = Date.now() - TTL_MS * 2;
  for (const [k, s] of Object.entries(store.sessions || {})) {
    const exp = Date.parse(s.expires_at || 0);
    if ((!s.signed || s.status !== "signed") && exp && exp < cutoff) delete store.sessions[k];
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function publicBaseFromEvent(event) {
  const envBase = String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");
  const headers = event?.headers || {};
  const host = headers["x-forwarded-host"] || headers.host || "";
  const proto = headers["x-forwarded-proto"] || "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return "";
}

function legalNotice() {
  return {
    ko: [
      "본 서명은 입점·연동을 위한 개인정보 처리 및 이용약관(필요 시 연동)에 대한 전자적 동의 기록입니다.",
      "일반 전자서명·동의 기록으로 확보하며, 법령이 공인·공동인증서 등을 요구하는 특정 행위까지 대체한다고 단정하지 않습니다.",
      "대표자 또는 적법한 권한자가 직접 서명해야 합니다.",
      "설치자 USB 인증서 서명은 선택적 강화 수단입니다.",
    ],
    consentLevelSimple: "electronic_consent_record",
    consentLevelUsb: "certificate_backed_electronic_signature",
    notClaimed: ["government_certified_for_all_statutory_acts", "payout_authority", "bank_mutate"],
  };
}

function createConsentSession({
  event,
  platformIds = ["dosirak.store"],
  instanceId,
  shopName,
  scopes = SCOPES_DEFAULT,
  requireConnect = false,
} = {}) {
  const store = loadStore();
  const sessionId = id();
  const signToken = token();
  const expires_at = new Date(Date.now() + TTL_MS).toISOString();
  const scopeList = [...scopes];
  if (requireConnect && !scopeList.includes("connect")) scopeList.push("connect");

  const challenge = `ARKAON-CONSENT|${sessionId}|${Date.now()}|${crypto.randomBytes(8).toString("hex")}`;
  const base = publicBaseFromEvent(event);
  const signPath = `/consent-sign.html?t=${encodeURIComponent(signToken)}`;
  const signUrl = base ? `${base}${signPath}` : signPath;

  const session = {
    id: sessionId,
    token: signToken,
    token_fp: fp(signToken),
    status: "pending",
    platformIds: Array.isArray(platformIds) ? platformIds : [platformIds],
    instance_id: String(instanceId || process.env.TEMPLATE_INSTANCE_ID || "jjajangnara-default").slice(0, 80),
    shop_name: String(shopName || "").slice(0, 80) || null,
    scopes: scopeList,
    challenge,
    challenge_fp: fp(challenge),
    created_at: nowIso(),
    expires_at,
    signed: false,
    attestation: null,
    legal: legalNotice(),
  };

  store.sessions[signToken] = session;
  saveStore(store);

  return {
    ok: true,
    session_id: sessionId,
    token_fp: session.token_fp,
    expires_at,
    signUrl,
    signPath,
    qrPayload: signUrl,
    scopes: scopeList,
    platformIds: session.platformIds,
    challenge_fp: session.challenge_fp,
    legalSummary: legalNotice().ko[0],
    how: "대표/권한자가 QR을 스캔해 서명하면 동의 기록이 확보됩니다.",
  };
}

function getSessionByToken(signToken) {
  const store = loadStore();
  const session = store.sessions[String(signToken || "").trim()];
  if (!session) return null;
  if (Date.parse(session.expires_at) < Date.now() && session.status !== "signed") {
    session.status = "expired";
    saveStore(store);
  }
  return session;
}

function getSessionById(sessionId) {
  const store = loadStore();
  return Object.values(store.sessions || {}).find((s) => s.id === sessionId) || null;
}

function publicSessionView(session) {
  if (!session) return null;
  return {
    session_id: session.id,
    status: session.status,
    expires_at: session.expires_at,
    shop_name: session.shop_name,
    instance_id: session.instance_id,
    platformIds: session.platformIds,
    scopes: session.scopes,
    challenge: session.status === "pending" ? session.challenge : undefined,
    challenge_fp: session.challenge_fp,
    legal: session.legal,
    signed: Boolean(session.signed),
    attestation_public: session.attestation
      ? {
          consent_level: session.attestation.consent_level,
          signer_name: session.attestation.signer_name,
          signer_role: session.attestation.signer_role,
          method: session.attestation.method,
          privacyAt: session.attestation.privacyAt,
          termsAt: session.attestation.termsAt,
          connectAt: session.attestation.connectAt || null,
          signed_at: session.attestation.signed_at,
          cert_thumbprint_fp: session.attestation.cert_thumbprint_fp || null,
        }
      : null,
  };
}

function validateUsbPayload(usb, challenge) {
  if (!usb || typeof usb !== "object") return { ok: false, code: "USB_REQUIRED" };
  const thumb = String(usb.certThumbprint || usb.thumbprint || "").replace(/\s+/g, "").toLowerCase();
  const subject = String(usb.subjectCN || usb.subject || "").trim();
  const signature = String(usb.signedChallenge || usb.signature || "").trim();
  if (thumb.length < 16) return { ok: false, code: "USB_THUMBPRINT_INVALID" };
  if (subject.length < 2) return { ok: false, code: "USB_SUBJECT_INVALID" };
  if (signature.length < 16) return { ok: false, code: "USB_SIGNATURE_INVALID" };
  // Phase A: bind signature material to challenge (format-perfect; PKI verify pluggable)
  const material = `${thumb}|${subject}|${challenge}|${signature}`;
  const binding_fp = fp(material);
  const verifyMode = String(process.env.ARKAON_USB_CERT_VERIFY || "").trim();
  let verified = false;
  if (verifyMode === "1") {
    // Placeholder for installer PKI hook — without registry, stay attested_unverified
    verified = false;
  }
  return {
    ok: true,
    thumbprint_fp: fp(thumb),
    subject_cn: subject.slice(0, 120),
    signature_fp: fp(signature),
    binding_fp,
    verified,
    consent_level: verified
      ? "certificate_backed_electronic_signature"
      : "certificate_backed_attested_unverified",
  };
}

function signConsentSession({ token: signToken, body = {}, event } = {}) {
  const store = loadStore();
  const session = store.sessions[String(signToken || "").trim()];
  if (!session) return { ok: false, code: "SESSION_NOT_FOUND", statusCode: 404 };
  if (session.status === "signed") {
    return { ok: true, code: "ALREADY_SIGNED", statusCode: 200, session: publicSessionView(session) };
  }
  if (Date.parse(session.expires_at) < Date.now()) {
    session.status = "expired";
    saveStore(store);
    return { ok: false, code: "SESSION_EXPIRED", statusCode: 410 };
  }

  const signerName = String(body.signerName || body.name || "").trim();
  const signerRole = String(body.signerRole || body.role || "").trim();
  const authorityDeclared = body.authorityDeclared === true || body.authorityDeclared === "true";
  const acceptPrivacy = body.acceptPrivacy === true || body.acceptPrivacy === "true";
  const acceptTerms = body.acceptTerms === true || body.acceptTerms === "true";
  const acceptConnect = body.acceptConnect === true || body.acceptConnect === "true";
  const method = String(body.method || "simple_sign").trim(); // simple_sign | usb_cert

  if (signerName.length < 2) return { ok: false, code: "SIGNER_NAME_REQUIRED", statusCode: 422 };
  if (!["대표", "대표자", "권한자", "사업주", "대리인"].includes(signerRole) && signerRole.length < 2) {
    return { ok: false, code: "SIGNER_ROLE_REQUIRED", statusCode: 422 };
  }
  if (!authorityDeclared) return { ok: false, code: "AUTHORITY_DECLARATION_REQUIRED", statusCode: 422 };
  if (session.scopes.includes("privacy") && !acceptPrivacy) {
    return { ok: false, code: "PRIVACY_REQUIRED", statusCode: 422 };
  }
  if (session.scopes.includes("terms") && !acceptTerms) {
    return { ok: false, code: "TERMS_REQUIRED", statusCode: 422 };
  }
  if (session.scopes.includes("connect") && !acceptConnect) {
    return { ok: false, code: "CONNECT_REQUIRED", statusCode: 422 };
  }

  const signedAt = nowIso();
  let consent_level = "electronic_consent_record";
  let usbMeta = null;
  if (method === "usb_cert") {
    const usb = validateUsbPayload(body.usb || body.certificate, session.challenge);
    if (!usb.ok) return { ok: false, code: usb.code, statusCode: 422 };
    usbMeta = usb;
    consent_level = usb.consent_level;
  }

  const headers = event?.headers || {};
  const attestation = {
    consent_level,
    method: method === "usb_cert" ? "usb_cert" : "simple_sign",
    signer_name: signerName.slice(0, 80),
    signer_role: signerRole.slice(0, 40),
    authority_declared: true,
    privacyAt: acceptPrivacy ? signedAt : null,
    termsAt: acceptTerms ? signedAt : null,
    connectAt: acceptConnect ? signedAt : null,
    signed_at: signedAt,
    instance_id: session.instance_id,
    platformIds: session.platformIds,
    scopes: session.scopes,
    challenge_fp: session.challenge_fp,
    client: {
      ua_fp: fp(headers["user-agent"] || ""),
      ip_fp: fp(headers["x-forwarded-for"] || headers["client-ip"] || ""),
    },
    cert_thumbprint_fp: usbMeta?.thumbprint_fp || null,
    cert_subject_cn: usbMeta?.subject_cn || null,
    cert_signature_fp: usbMeta?.signature_fp || null,
    cert_verified: usbMeta ? Boolean(usbMeta.verified) : false,
    legal_notice_version: "consent-qr-v1",
  };

  session.status = "signed";
  session.signed = true;
  session.attestation = attestation;
  session.signed_at = signedAt;
  // drop raw token reuse after sign — keep record under same key for status poll
  saveStore(store);

  return {
    ok: true,
    code: "SIGNED",
    statusCode: 200,
    session: publicSessionView(session),
    next: {
      type: "link_weave",
      note: "동의 기록 확보 → 플랫폼 Arkaon과 연결고리(link_request) 진행",
    },
  };
}

function attestationForLink(session) {
  if (!session?.attestation) return null;
  const a = session.attestation;
  return {
    privacyAt: a.privacyAt,
    termsAt: a.termsAt,
    connectAt: a.connectAt,
    consent_level: a.consent_level,
    method: a.method,
    signer_role: a.signer_role,
    signed_at: a.signed_at,
    challenge_fp: a.challenge_fp,
    cert_thumbprint_fp: a.cert_thumbprint_fp,
    legal_notice_version: a.legal_notice_version,
    // never include raw name in peer payload by default — platforms get role + fps
    signer_name_fp: fp(a.signer_name || ""),
  };
}

module.exports = {
  attestationForLink,
  createConsentSession,
  getSessionById,
  getSessionByToken,
  legalNotice,
  publicSessionView,
  signConsentSession,
};
