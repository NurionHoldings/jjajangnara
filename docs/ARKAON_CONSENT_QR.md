# 동의 QR 서명 — 단순 UX / 내부 증빙

## 외형 (한 줄)

**QR 보여 주기 → 대표/권한자가 휴대폰으로 스캔·서명 → 끝.**

필요 시 서명 화면에서 **USB 인증서 강화(선택)** 만 켭니다.

## 법적 범위 (과대표시 금지)

| 확보하는 것 | 단정하지 않는 것 |
|-------------|------------------|
| 입점·연동용 개인정보/약관(/실연동)에 대한 **전자적 동의 기록** | 모든 법정 행위를 공인·공동인증으로 대체 |
| 권한자 본인 선언 + 시각·기기 지문 + (선택) 인증서 지문 | 정산·지급·계좌 변경 권한 |
| `electronic_consent_record` 또는 USB 시 `certificate_backed_*` | 채팅에 env/시크릿을 넣는 운영 |

근거 취지: 전자서명법상 **일반 전자서명·동의 기록**으로 의사표시를 남김.  
법령이 특정 인증서를 요구하는 행위까지 본 QR만으로 대체한다고 보지 않습니다.

## 흐름

```
설치자/매장 화면: /free-template-onboard.html
  → consent-qr-create (공개)
  → QR = /consent-sign.html?t=…
대표 서명: consent-sign (공개, 토큰)
  → 동의 증빙 저장
  → link-weave → 플랫폼 link_request → link_grant(단기)
```

시크릿·grant 원문은 DNA/채팅에 넣지 않습니다. grant_fp만 기록.

## API

| action | 인증 | 설명 |
|--------|------|------|
| `consent-qr-create` | 공개 | QR 세션 발급 |
| `consent-session` | 토큰 | 서명 화면 로드 |
| `consent-sign` | 토큰 | 서명 제출 |
| `consent-qr-status` | 공개(id) | 대기/완료 폴링 |
| `link-weave` | 서명 완료 후 | 플랫폼 연결고리 |

## USB 인증서 (선택)

서명 화면 →「USB 인증서로 강화」→ thumbprint / CN / challenge 서명값.  
`ARKAON_USB_CERT_VERIFY=1` 이면 PKI 검증 훅(레지스트리 연동) 자리만 활성화.  
미검증이어도 형식·challenge 바인딩은 기록합니다.
