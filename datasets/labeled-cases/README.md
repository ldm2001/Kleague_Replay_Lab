# 세트피스 평가 자료

이 폴더는 실제 영상의 평가 기준과 라벨을 관리하는 위치다
원본 영상은 별도 로컬 저장소에 두고 git에 추가하지 않는다
충북청주 대 수원 하이라이트 한 편으로 원시 신호 진단을 진행했다
원본과 진단 결과 및 개발용 라벨은 별도 로컬 경로에 보관하며 전체 영상의 정답 주석은 아직 없다
코너개발.json에는 원본 해시와 직접 확인한 오탐 3구간 및 같은 코너의 두 영상 구간만 기록한다
원본을 REPLAY_CORNER_VIDEO로 지정하면 Worker 테스트에서 이 다섯 구간을 다시 검증한다
본방과 리플레이의 동일 event_id는 평가용 주석이며 현재 파이프라인이 자동 연결한 결과가 아니다

## 수집 범위

킥오프와 코너킥 및 페널티킥과 스로인 및 골킥과 프리킥을 포함한다
일반 플레이와 리플레이 및 화면 전환도 포함한다
코너 근처 스로인과 빠른 프리킥 및 재개를 보여주지 않는 편집 구간을 어려운 사례로 포함한다

## 사건 기록 필드

- match_id 경기 단위 분할 식별자
- source_id 원본 식별자와 파일 해시
- event_id 원본과 리플레이를 연결하는 사건 식별자
- kind 재개 종류 또는 UNKNOWN
- start_ms와 end_ms 준비부터 재개 직후까지 원본 파일 구간
- restart_ms 실제 재개를 관찰한 시각 또는 null
- visible_ball 공 위치 관찰 가능 여부
- visible_restart 재개 동작 관찰 가능 여부
- camera_continuity 카메라 전환과 편집 여부
- replay 본방송과 리플레이 및 미확인 구분
- ambiguity 혼동되는 다른 재개와 미확인 사유

이 라벨은 개발 평가용이며 제품 사용자에게 요구하는 입력이 아니다
경기 단위로 개발과 검증 및 최종 평가를 나누고 같은 사건의 리플레이가 다른 분할에 들어가지 않게 한다
모델이 찾은 후보만 표기하지 말고 전체 평가 구간의 사건과 비사건을 함께 확인한다

## 보고 지표

세트피스별 정밀도와 재현율 및 UNKNOWN 비율을 함께 기록한다
재개 시점 오차와 사건 전후 구간 보존율도 측정한다
원시 신호의 측정 가능 비율과 오차를 기록해 사건 인식 오류의 원인을 추적한다
합성 영상과 실제 영상 결과를 같은 성능 수치에 합치지 않는다

## 잡기 사실 단위 방법 검증 계약

`holding.schema.json`과 `replay_video.validation`은 개발자가 별도로 준비한 라벨과 방법 예측을 비교한다. 실제 잡기 라벨은 아직 없으며 기존 코너 자료를 잡기 정답으로 변환하지 않는다. 테스트의 합성 문자열과 상태 조합은 지표 계산 시험일 뿐 실영상 성능 자료가 아니다.

```sh
PYTHONPATH=apps/video-worker/src python3 -m replay_video.validation /path/to/developer-labels.json
```

입력은 `schemaVersion: holding-validation-v1`, `producer: {id, version}`, `cases`를 갖는다. producer는 모든 예측을 생성한 단일 방법과 정확한 판본이다. 각 사례는 한 개의 불리언 명제를 평가하며 필수 필드는 다음과 같다.

- `id`: 자료 안에서 유일한 사례 ID
- `sourceSha256`, `matchId`, `eventId`: 원본 해시와 전역 경기·사건 ID. 리플레이에도 동일 사건 ID를 사용한다
- `split`: `DEVELOPMENT` 또는 `EVALUATION`
- `actorId`, `targetId`: 서로 다른 행위자와 대상 ID. 방법 예측과 라벨이 같은 원본 인물을 가리키도록 외부에서 대응시킨 ID이며 도구가 인물을 추적하지 않는다
- `startMs`, `endMs`: 원본 시간축의 비음수 정수 밀리초이며 끝은 시작보다 커야 한다
- `factKey`: `actionType`, `direction`, `bodyOrEquipmentContact`, `gripMaintained`, `pulling`, `movementImpeded` 중 하나
- `expected`, `predicted`: 각각 `CONFIRMED`, `REFUTED`, `UNKNOWN`
- `provenance`: `{origin: DEVELOPMENT_REVIEW, reviewer: 비어 있지 않은 문자열, evidenceSha256: 소문자 SHA256}`

`actionType`은 이 구간에 잡기 동작이 관찰됐다는 명제다. `direction`은 명시한 actor에서 target으로의 잡기 행위 방향이 맞다는 명제다. 나머지는 각각 신체·장비 접촉, 잡기 유지, 당김, 해당 행위로 인한 이동 방해의 명제다. 방향과 유형을 다중 클래스 정확도로 해석하지 않는다. 근거 해시와 검토자는 입력자의 개발 라벨 출처 주장으로 보존하며 도구는 실제 근거 파일이나 영상·인물·접촉·인과관계·검토 권한을 검증하지 않는다.

중복 사례 ID와 잘못된 해시·시간·상태·사실 키를 거부한다. 사례 ID가 달라도 sourceSha256·eventId·actorId·targetId·startMs·endMs·factKey가 모두 같은 명제는 중복으로 거부한다. 동일 원본 또는 동일 경기 또는 동일 사건이 개발과 평가에 걸치면 거부한다. 이 분리의 정확도는 입력된 전역 ID의 정확도에 의존한다. 평가 후보만 골라 만든 자료로 전체 영상의 탐지 재현율을 주장할 수 없으며 전체 평가 구간의 양성과 음성 및 미확인을 별도로 준비해야 한다.

JSON 스키마는 해시의 길이 64와 문자열 끝의 공백·개행 거부를 명시한다. Python 실행 검사는 시간에 정수 토큰만 허용하므로 JSON Schema가 수학적 정수로 인정하는 `0.0`도 거부한다. 시간 순서와 인물 ID 차이 및 중복·분할 누수도 JSON 스키마만으로 검사하지 않고 실행 검사를 추가 적용한다.

출력은 `holding-validation-report-v1`이며 `method`, `datasetSha256`, `status`, `semanticValidation`, `counts`, `reasons`, `facts`를 갖는다. 해시는 전체 입력의 키 정렬·공백 없는 JSON·UTF-8·비 ASCII 문자 보존을 기준으로 계산하므로 방법 판본이나 라벨 변경도 결합된다. 배열 순서는 유지한다. `counts`의 total과 development는 전체 입력 범위이고 evaluation과 scorable 및 사실별 지표는 평가 분할만 사용한다.

사실별 TP/FP/FN/TN과 정답 미확인 수·예측 미확인 수를 분리한다. 양성 정답의 UNKNOWN 예측은 FN에 포함하고 음성 정답의 UNKNOWN 예측은 TN으로 세지 않는다. UNKNOWN 정답은 혼동 행렬에서 제외한다. precision은 TP/(TP+FP), recall은 TP/(TP+FN)이다. coverage와 abstention은 미확인 정답을 제외한 사례 중 각각 확정 예측과 UNKNOWN 예측의 비율이며 분모가 없으면 null이다. unknownPredictionCount는 미확인 정답 사례까지 포함하고 scorableAbstentionCount는 평가 가능한 정답의 기권만 센다.

평가 가능한 라벨이 없으면 `UNAVAILABLE`과 `NO_SCORABLE_EVALUATION_LABELS`를 반환한다. 그 외의 `MEASURED`도 입력 개발 라벨에 대한 계산 완료일 뿐이며 항상 `semanticValidation: NOT_APPROVED`다. 이 명령은 stdout에만 출력하고 원본·라벨을 덮어쓰거나 운영 승인 목록·임계값을 변경하지 않는다.
