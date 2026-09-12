# ARKAON Peer Mesh — 무료 템플릿 ↔ 플랫폼 교신 (Phase A)

## 영업 방침

입점업체에게 **업종 템플릿을 무료 자동생성**해 주고, 그 템플릿에 **Arkaon을 탑재**한다.  
입점 과정에서 **템플릿 Arkaon**과 **플랫폼 Arkaon**(도시락.store / aibaeby.com)이 교신하여 구축을 원활히 한다.

```
[HQ] 무료 템플릿 프로비저닝
        ↓
[Template Arkaon]  ←—— peer-mesh/v1 ——→  [Platform Arkaon]
   제안·동의·draft/bind 오케스트레이션      능력 광고·초안 접수·실연동
        ↓
[Merchant] 동의/서류 완료
        ↓
[HQ] 주문 릴레이·정산 라이브 (별도 gate)
```

## 역할

| 주체 | 할 일 | 하지 않음 |
|------|--------|-----------|
| Template Arkaon | wake, peer hello, 플레이북 제안, draft/bind 오케스트레이션, DNA | 정산 실행, 약관 대리수락 |
| Platform Arkaon | capabilities 광고, draft/bind 접수, peer DNA | 템플릿 강제 배포, 지급 실행 |
| Merchant | 동의·필수 정보 확인 | — |
| HQ | 리스크 수용, 라이브 릴레이/정산 | — |

## 프로토콜 `arkaon-peer-mesh/v1`

Auth: `X-ARKAON-PEER-KEY` = `ARKAON_PEER_MESH_SECRET` (또는 개발용 affiliate connector 폴백 플래그)

| action | 의미 |
|--------|------|
| `hello` | 세션 개시, 상대 역할 확인 |
| `capabilities` | 상대가 지원하는 draft/bind/assist 목록 |
| `propose_onboard` | 무료 템플릿 입점 플레이북 제안 |
| `ack` | 제안 수락/거절 기록 |
| `status` | 세션 상태 |

엔드포인트:

- 플랫폼: `POST /api/arkaon/peer-handshake`
- 템플릿: `POST /.netlify/functions/arkaon-participation?action=peer-mesh`

## DNA 계층

`peer_mesh_dna` — 입점 onboarding DNA / template_bind DNA / 고객 navigation DNA와 **혼합 금지**.  
시크릿·계좌·bind_token 원문 저장 금지.

## 프로비저닝 훅 (Phase A)

HQ/에이전트가 무료 템플릿을 만들면 `template-provision`이 인스턴스 ID를 발급하고 peer hello → capabilities → propose_onboard를 자동 호출한다.

| 장치 | 경로 |
|------|------|
| API | `POST ?action=template-provision` |
| CLI | `node peer-mesh/provision.mjs --platform both` |
| 사업주 CTA | `/free-template-onboard.html` |
| 공개 카피 | `GET ?action=free-template-cta` (시크릿·인증 없음) |

동의 전 draft/bind/정산은 실행하지 않는다.
