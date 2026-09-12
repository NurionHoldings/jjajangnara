# ARKAON Participation Contract — JJAJANGNARA

권한 확장이 아닌 **읽기/검색/기록/제안** 계약입니다.

## Endpoints

Base: `/.netlify/functions/arkaon-participation?action=...`

| 동작 | method + action |
|------|------------------|
| 방문 알림 | `POST` `agent-visits-announce` |
| 방문 목록 | `GET` `agent-visits` |
| Change DNA | `POST`/`GET` `change-intent-dna` |
| Peer review | `POST`/`GET` `cross-checks` + `POST` `cross-check-verdict` |
| Wake | `GET` `wake` |
| Host profile | `GET` `host-profile` |
| No-touch | `GET` `no-touch-map` |
| Platform registry | `GET` `platform-registry` |
| Onboarding intent | `POST` `onboarding-intent` body `{ "command": "..." }` |
| Onboarding DNA | `GET` `onboarding-dna` |

인증: `X-ARKAON-AGENT-KEY: <ARKAON_AGENT_HANDOFF_SECRET>` (16자+) 또는 제품 admin 세션.

## Platform onboarding DNA (Phase A)

- Docs: `docs/ARKAON_PLATFORM_ONBOARDING_DNA.md`
- Manifest: `.arkaon/participation/platform-onboarding-manifest.json`
- Affiliates: `dosirak.store`, `aibaeby.com`
- Mode: propose / orchestrate approved connectors only
- Forbidden: payout auto-exec, bank autofill, non-affiliate scrape, TOS proxy-accept without merchant

## Host / secret 범위

- Netlify Functions 제품 → Netlify env만
- Railway 등 API 본체 제품 → API 호스트 env 필수
- 미설정 시 `.arkaon/participation` 폴백
