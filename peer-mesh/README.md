# Peer Mesh — 무료 템플릿 입점 유도

템플릿 Arkaon ↔ 플랫폼 Arkaon 교신 (`arkaon-peer-mesh/v1`).  
문서: `docs/ARKAON_PEER_MESH.md`

## 프로비저닝 (HQ/에이전트)

```bash
# 로컬 핸들러 (peer env 없으면 PEER_ENV_MISSING만 기록, CTA는 반환)
node peer-mesh/provision.mjs --platform both --shop "세종짜장"

# peer 호출 생략 (CTA·instance만)
node peer-mesh/provision.mjs --platform dosirak --dry-peer

# 배포된 템플릿
ARKAON_AGENT_HANDOFF_SECRET=... node peer-mesh/provision.mjs --remote https://짜장나라.com --platform both
```

API: `POST /.netlify/functions/arkaon-participation?action=template-provision`

사업주 CTA 페이지: `/free-template-onboard.html`  
공개 카피(시크릿 없음): `GET ?action=free-template-cta`
