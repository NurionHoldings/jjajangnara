# ARKAON Platform Onboarding DNA — JJAJANGNARA (Phase A)

식당 업종 템플릿(짜장나라) 사업주가 **지정 계열 배달/중개 플랫폼**에 입점·앱가입할 때, Arkaon이 절차를 막힘없이 이어 주도록 준비하는 계약입니다.

## 목표

- 음성/명령: `입점`, `앱 다운로드`, `가입` → Intent 해석
- 계열 플랫폼: `도시락.store`, `aibaeby.com` 우선
- 템플릿 메뉴·매장 프로필을 입점 초안에 매핑
- 이후 동일 패턴으로 타 업종 템플릿 → 플랫폼 공생(판매·정산·배송) 확장

## Phase A 경계 (지금)

Arkaon은 **observe / propose / approved connector orchestrate / DNA 기록**만 합니다.

금지:

- 정산·환불·지급 실행
- 계좌·시크릿 자동 기입
- 사업주 동의 없는 약관 대리 수락
- 비계열 배달앱 화면 스크래핑
- RC1 플래그/운영 배포 임의 활성화

## API

Base: `/.netlify/functions/arkaon-participation?action=...`

| action | method | 설명 |
|--------|--------|------|
| `platform-registry` | GET | 계열 플랫폼·명령 Intent 목록 |
| `onboarding-intent` | POST | `{ "command": "도시락.store 입점해줘" }` → 플레이북 |
| `onboarding-execute` | POST | 동의·전화 확보 후 `dosirak.store` vendor-draft POST |
| `connector-readiness` | GET | draft URL/시크릿 설정 여부(값 미노출) |
| `onboarding-dna` | GET | 최근 입점 Intent DNA |
| `no-touch-map` | GET | 자동 금지 목록 |

Auth: `X-ARKAON-AGENT-KEY` (capability) — 역할 아님.

## draft vs template-connect vs peer-mesh

| 장치 | 언제 | API |
|------|------|-----|
| **peer-mesh** | 무료 템플릿 배포 후 입점 유도 | `peer-mesh` / `template-provision` → `/api/arkaon/peer-handshake` |
| draft 입점 | 신규 신청 | `onboarding-execute` → vendor/merchant-draft |
| **template-connect** | 이미 개설된 템플릿 + 기존 입점업체 | `template-connect-execute` → `/api/template-bind` |

사업주 CTA: `/free-template-onboard.html` · CLI: `peer-mesh/provision.mjs`

문서: `docs/ARKAON_PEER_MESH.md`


커넥팅 보조: `connect-assist/` (정산 채널 비활성, bind 상태·메뉴 스냅샷·포스 힌트).

### `template-connect-execute`

```json
{
  "platformId": "aibaeby.com",
  "dryRun": true,
  "vendor": { "vendor_id": "existing-uuid", "phone_last4": "5678" },
  "consents": {
    "privacyAt": "2026-09-12T00:00:00.000Z",
    "termsAt": "2026-09-12T00:00:00.000Z",
    "connectAt": "2026-09-12T00:00:00.000Z"
  }
}
```

추가 env:

- `DOSIRAK_TEMPLATE_BIND_URL` / `AIBAEBY_TEMPLATE_BIND_URL`


```json
{
  "platformId": "aibaeby.com",
  "dryRun": true,
  "consents": { "privacyAt": "2026-09-12T00:00:00.000Z", "termsAt": "2026-09-12T00:00:00.000Z" },
  "merchant": { "phone": "01012345678" }
}
```

환경변수(Netlify, 값 DNA 금지):

- `DOSIRAK_VENDOR_DRAFT_URL` — 예: `https://도시락.store/api/vendor-draft`
- `DOSIRAK_AFFILIATE_CONNECTOR_SECRET`
- `AIBAEBY_MERCHANT_DRAFT_URL` — 예: `https://aibaeby.com/api/affiliate/merchant-draft`
- `AIBAEBY_AFFILIATE_CONNECTOR_SECRET` — aibaeby API 호스트와 동일

## DNA 계층 분리

| Layer | 용도 |
|-------|------|
| `visit` | 에이전트 방문 |
| `change_dna` | 코드/설정 변경 의도 |
| `onboarding_dna` | 플랫폼 입점·앱가입 오케스트레이션 |
| (별도) member navigation DNA | 고객 주문 내비 — 변경/입점 DNA와 혼합 금지 |

## 다음 Phase (HQ 승인 후)

1. ~~`dosirak.store` vendor-draft API 연결~~ (Phase A draft 배선 완료 — 정산 미포함)
2. ~~`aibaeby.com` merchant-draft + participation 능력치~~ (Phase A draft/참관 배선 — 정산 미포함)
3. 템플릿 인스턴스별 merchant profile vault (PII 최소·암호화)
4. 정산 연결은 AML/HQ gate 통과 후에만
5. 도시락/배비 API 호스트 env·배포 확인

## 검증

```bash
node scripts/verify-arkaon-onboarding-dna.mjs
```
