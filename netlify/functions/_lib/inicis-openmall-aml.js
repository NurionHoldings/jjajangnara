/** Phase A OpenMall AML policy stub ??no network I/O. */
function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function readApprovedStatusesFromEnv(raw = process.env.INICIS_OPENMALL_AML_APPROVED_STATUSES) {
  return String(raw || "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
}
function decideAmlEligibility(status, approvedExaminationStatuses, today) {
  const approved = new Set([...(approvedExaminationStatuses || [])].map((v) => String(v).trim().toUpperCase()).filter(Boolean));
  const current = today || seoulToday();
  if (approved.size === 0) return { eligible: false, reason: "approved_status_allowlist_empty" };
  if (!status.authValid) return { eligible: false, reason: "aml_auth_expired" };
  if (!status.examinationStatus || !approved.has(status.examinationStatus)) return { eligible: false, reason: "aml_examination_not_approved" };
  if (!status.validFrom || !status.validTo) return { eligible: false, reason: "aml_validity_period_missing" };
  if (current < status.validFrom) return { eligible: false, reason: "aml_validity_not_started" };
  if (current > status.validTo) return { eligible: false, reason: "aml_validity_expired" };
  return { eligible: true, reason: "eligible" };
}
const INICIS_OPENMALL_AML_LIVE_GATE_WIRED = false;
module.exports = { seoulToday, readApprovedStatusesFromEnv, decideAmlEligibility, INICIS_OPENMALL_AML_LIVE_GATE_WIRED };