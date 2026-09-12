# Replay Lab Video Worker

운영 `ANALYZE_VIDEO`는 기존 영상 처리와 승인된 RT-DETR-R18·YOLO11m·ViTPose의 로컬 관측을 함께 실행한다
아래 기준 CLI는 비모델 개발 진단으로 유지한다. 운영 모델 경로의 오류를 기준 CLI 성공으로 바꾸지 않는다

```text
ffprobe 메타데이터 확인
→ OpenCV 샷 경계 탐지
→ 움직임 급증 기반 검토 후보 생성
→ 복수 공 후보 경로 연결과 후보 구간별 추적 요약
→ 코너 기하와 출발 경로를 이용한 코너킥 영상 패턴 관찰
→ GOAL 방송 표시의 글자 형태와 시간적 지속 확인
→ 후보 전후 프레임 추출
→ FFmpeg 짧은 증거 클립 생성
→ report.json 기록
```

## 디렉터리

```text
apps/video-worker/
├── pyproject.toml
├── README.md
├── src/
│   └── replay_video/          # namespace package · init 파일 없음
│       ├── cli.py             # CLI 진입점
│       ├── worker.py          # Job 실행 경계
│       ├── http.py            # 내부 API Client
│       ├── runner.py          # Worker 반복 실행
│       ├── application/       # 파이프라인 조립
│       │   ├── pipeline.py
│       │   └── ports.py        # 파이프라인 Port
│       ├── domain/             # 순수 결과 모델
│       │   └── models.py
│       └── infrastructure/    # ffprobe·OpenCV·FFmpeg 구현
│           ├── ports.py        # 미디어 Adapter 조립
│           ├── candidates.py
│           ├── evidence.py
│           ├── probe.py
│           ├── shots.py
│           ├── signals.py
└── tests/
    ├── test_http.py
    ├── test_runner.py
    └── test_worker.py
```

## 실행

```bash
npm run test:video

cd apps/video-worker
python3 -m pip install -e .

# 설치 후 실행
replay-video \
  /path/to/highlight.mp4 \
  /tmp/replay-lab-result

# 소스에서 직접 실행할 때
PYTHONPATH=src python3 -m replay_video.cli \
  /path/to/highlight.mp4 \
  /tmp/replay-lab-result
```

## 사이트 연결 Worker 실행

저장소 루트에서 전용 환경을 준비한다. 기존 `.venv-referee`가 준비돼 있으면 환경 생성과 설치를 반복할 필요가 없다

```sh
python3.11 -m venv experiments/perception/.venv-referee
experiments/perception/.venv-referee/bin/python -m pip install -r experiments/perception/requirements-referee.txt
experiments/perception/.venv-referee/bin/python -m pip install -e experiments/perception -e apps/video-worker
PYTHONPATH=experiments/perception/src experiments/perception/.venv-referee/bin/python -m replay_perception.fetch_model
PYTHONPATH=experiments/perception/src experiments/perception/.venv-referee/bin/python -m replay_perception.fetch_observer_models
```

준비 명령만 고정된 모델 자산을 다운로드하며 운영 추론은 검증된 로컬 캐시만 읽는다
Gemma·Ollama·생성형 모델·외부 추론·추가 학습과 새 가중치는 사용하지 않는다
세 모델의 출처와 라이선스 및 가중치 해시는 `experiments/perception`의 manifest에 고정돼 있다
공개 서비스 배포의 라이선스 검토나 클라우드 성능 검증이 끝났다는 의미는 아니다

```bash
npm run dev:worker
```

개발 스크립트가 `apps/web/.env.local`을 자동으로 읽는다

기본 Python은 `experiments/perception/.venv-referee/bin/python`이며 없으면 명확하게 실패한다
별도로 준비한 실행 환경은 `WORKER_PYTHON`으로 명시할 수 있다. 이전 Python으로 몰래 전환하지 않는다
`WORKER_PERCEPTION_DEVICE=cpu`가 기본이며 Apple Silicon 개발 환경은 `mps`를 사용할 수 있다
이는 운영자 실행 환경이며 사용자 화면에 모델·임계값·사실 입력을 추가하지 않는다

내부 JSON 요청에는 `x-worker-protocol: video-observations-v2`를 보낸다
웹 서버는 인증 후 선점과 진행 및 결과와 증거 권한 요청의 버전을 검사한다
버전이 없거나 다르면 본문 처리와 작업 선점 전에 HTTP 409로 거부한다
웹과 Worker를 함께 갱신하고 이전 Worker는 활성 작업을 마친 뒤 종료한다
이 검사는 실행 계약의 호환성 검사이며 관측 정확도의 인증이 아니다
과거에 저장된 분석은 자동 재처리하거나 수정하지 않는다

새 운영 경로는 `0017_analysis_perception_runs`까지 적용된 DB를 요구한다
스키마와 서버 프로토콜을 먼저 맞추고 활성 작업이 없는지 확인한 뒤 이전 Worker를 새 환경으로 교체한다
기존 분석을 자동 재처리하지 않는다

결과 디렉터리에는 `report.json`, 후보별 `frames`와 `clips`, 비공개 `perception/perception.jsonl.gz`와 로컬 요약이 생성된다

기초 후보 범주는 `OTHER`로 기록한다 화면 변화 점수는 접촉과 강도의 근거가 아니다
서버는 저장된 후보와 근거에 rules 필터를 적용하고 부족한 근거를 확인 불가로 반환한다
사용자 사실 입력이나 확인 단계는 없다

Application 파이프라인은 `PipelinePorts`만 사용
비모델 개발 진단은 `infrastructure.ports.media`, 운영 경로는 `infrastructure.ports.operating`에서 조립한다

Job 경계는 `replay_video.worker.job`이다. `VALIDATE_VIDEO`는 모델 없이 메타데이터를 검증하고 `ANALYZE_VIDEO`는 새 운영 파이프라인을 실행한다

`replay_video.runner`는 Nextjs 내부 API에서 작업을 선점하고 Lease를 갱신하고 원본 영상을 내려받아 결과를 제출한다

기초 변화 후보는 최대 40건이며 관찰된 코너킥 장면은 겹치는 후보를 확장하거나 별도 후보로 추가한다
모든 후보의 프레임과 관찰된 코너킥 장면 각각의 짧은 클립을 Object Storage에 업로드한다
클립은 관찰된 장면을 먼저 확보하고 총 8건보다 적으면 나머지를 변화 신호 순으로 채운다
관찰된 장면이 8건보다 많으면 해당 장면의 클립을 모두 보존한다

## 운영 관측·전송·규정 승인 경계

- 동일 원본 PTS에서 검출·추적·일반 역할·17관절·손 주변 물체·사건 연결을 순차 관측한다
- 기본 간격은 100ms다. 요청 구간의 예정 표본 수와 처리·누락 수를 따로 기록하며 누락이나 실패는 `PARTIAL`이다
- 30,000표본·1,800초의 단계 사이 검사, 원시 512 MiB·gzip 128 MiB·레코드 8 MiB 상한을 둔다. 멈춘 추론 자체를 강제 중단하는 하드 타임아웃은 아니다
- 원시 상자·관절·물체와 원본 SHA256·PTS·모델 및 코드 해시는 비공개 gzip에 남긴다. API에는 최대 256 KiB 요약과 제한된 근거 참조만 보낸다
- 새 관측 후보는 최대 16개 추가하고 30초 이내 클립을 확보한다. 요약에서 빠진 관측은 raw 파일에 보존하고 `truncated` 사유를 남긴다
- 주심·부심은 가설이며 깃발/카드 형태는 관측 단서다. 접근한 상자를 접촉으로, 신호를 선언된 원심으로, 이후 재개를 앞선 판정의 독립 근거로 바꾸지 않는다
- 서버는 원본·모델 출처와 실제 객체 크기/해시, 참조, 현재 lease와 보존 기한을 검증하고 별도 `analysis_perception_runs`에 저장한다
- 현재 역할·신호·접촉·원심·재개 의미의 인식 방법은 미검증이므로 `NOT_ADMITTED`다. `EvaluationFacts`의 boolean과 강도를 기본값으로 채우지 않는다
- 기존 K리그 `COMPETITION_VAR_SCOPE`와 전체 파울 완료 개수는 계속 분리한다. 처리 성공이나 관측 존재만으로 최종 판정을 공개하지 않는다

gzip 권한은 분석·작업·revision·진단 파일 SHA256에 결합된 전용 키, 서명된 체크섬과 `If-None-Match: *`를 사용한다
원본 영상 SHA256은 이 객체 키와 별개로 서버의 업로드 해시와 대조한다
기존 JPEG/MP4는 50 MiB, 권한 요청은 128개·합계 200 MiB를 넘지 않게 나누며 증거 배열 순서는 유지한다
Worker는 파일을 스트리밍 PUT하고 성공·실패 결과 제출이 끝날 때까지 heartbeat를 유지한다
lease가 오래됐거나 heartbeat 오류로 소유권이 미확인되면 후속 처리와 결과 제출을 중단한다. 서버에 FAILED가 저장됐다고 가정하지 않는다
이 경우 서버의 lease 만료와 재시도 정책이 작업 소유권을 결정한다

진단 보존 기한은 분석의 기한을 따르지만 현재 DB 만료 메타데이터나 cascade가 객체 파일을 삭제하지는 않는다
별도 객체 정리 작업은 남아 있다. 기존 JPEG/MP4 PUT 권한의 재사용 가능성도 남아 있으므로 의미적 사실 승인 활성화 전에 증거 불변성 정책을 보강해야 한다

```sh
npm run test:video
npm run test:perception
```

## 세트피스 원시 신호 진단

개발 평가용 진단은 별도 모듈로 실행한다
루트 디렉터리에서 원본 영상과 새 출력 폴더를 지정한다

```sh
PYTHONPATH=apps/video-worker/src python3 -m replay_video.inspect /path/to/match.mp4 /tmp/replay-context-result
```

- `context.jsonl` 샘플별 잔디색 비율과 선분 및 카메라 이동 근사치와 정합 잔차
- `context-summary.json` 읽은 프레임 수와 측정 가능 건수 및 미확인 항목
- 기존 결과 폴더에 같은 파일이 있으면 덮어쓰지 않고 중단

공 후보의 화면 좌표와 추적 상태는 ball_candidates와 ball_track에 기록한다
축구공으로 검증된 위치와 선수 위치 및 경기 중단과 재개 상태는 아직 null로 기록한다
색상 변화가 큰 구간에서는 프레임 간 움직임 비교를 초기화한다
시간은 디코더 값을 우선하고 이를 사용할 수 없는 샘플은 NOMINAL_FPS로 표시한다
좌표는 축소 영상의 픽셀 기준이며 실제 경기장 거리나 접촉 강도가 아니다

`domain/setpieces.py`는 근거가 확보된 중단과 재개 입력을 받는 순수 상태 머신이다
여섯 재개 종류를 지원하며 근거 공백과 종류 충돌 및 리플레이는 UNKNOWN으로 반환한다
추적 요약은 Worker 결과의 tracking 필드로 전달하고 rules에서 적용 가능한 측정 범위를 확인한다
경기 중단과 적법한 재개 및 신체 접촉 사실은 추적 요약으로 대신하지 않는다
코너킥 영상 패턴은 별도 sceneEvent로 전달하며 경기 중단 사실을 채우지 않는다
합성 테스트 통과는 K리그 세트피스 인식 정확도를 의미하지 않는다

설계와 논문 근거는 [세트피스 설계](../../docs/design/세트피스.md)를 본다

## 휘슬 유사 음향 진단

고정 DSP로 복수 주파수 음향을 찾는 독립 개발 도구다
자동 분석과 rules 및 공개 결과에는 연결하지 않는다

```sh
PYTHONPATH=apps/video-worker/src python3 -m replay_video.inspect_audio /path/to/match.mp4 /tmp/replay-audio.json
```

출력 파일의 상위 폴더가 있어야 하며 기존 파일은 덮어쓰지 않는다
첫 실제 영상 스트림과 첫 오디오 스트림을 사용하고 표지 이미지는 제외한다
48kHz로 디코딩한 100ms 프레임에서 3.5kHz부터 4.5kHz의 전력과 엔트로피 및 복수 피크를 측정한다
피크 검사는 10Hz 간격의 대역 내부 bin만 사용하므로 대역 양끝에 걸친 음을 놓칠 수 있다
스테레오는 파형을 합치지 않고 채널별 전력을 평균하며 200ms 이상 연속된 관측만 기록한다
마지막 불완전 프레임은 분류하지 않고 원본 영상 기준 측정 범위를 출력한다
패킷의 시간 공백을 유지하기 위해 삽입한 무음은 실제 원본 음향 관측이 아니며 보고서에 이 처리 방식을 기록한다

상태는 COMPLETE와 ABSENT 및 UNSUPPORTED와 FAILED로 구분한다
영상 또는 오디오의 시작 시각을 확인할 수 없으면 임의로 0을 넣지 않고 UNSUPPORTED로 반환한다
COMPLETE는 디코딩·측정의 완료이며 휘슬의 정답이나 심판 판정을 뜻하지 않는다
최대 4시간을 지원하며 디코더 무응답 30초와 전체 실행 15분 제한이 있다
고정 임계값과 방법 및 제한사항은 출력 JSON에 기록하며 사용자 분석 설정은 추가하지 않는다

관중 휘슬과 음악 등을 구분하지 못하므로 WHISTLE_LIKE_AUDIO를 주심 휘슬과 파울 및 재개 종류로 해석하지 않는다
기존 증거 클립은 음성을 제거하므로 음향 검증은 원본으로 따로 수행해야 한다
실제 관측 범위와 채택 제한은 [판정관측조사](../../docs/analysis/판정관측조사.md)를 본다

## 공 후보 추적과 정지 후 움직임

공 추적은 context-ball-paths-v4에서 도입한 작은 밝은 원형 물체의 여러 경로를 동시에 유지한다
세 프레임 이상 지지된 경로의 위치와 크기 및 예측 오차와 원형도를 비교해 선택한다
동등한 경로가 경쟁하거나 현재 프레임이 가려졌다면 관측 좌표를 반환하지 않는다
분석 해상도에서 크기와 원형도 및 주변 잔디색을 검사해 선분과 큰 물체를 제외한다
잔디색 비율이 20%보다 낮으면 새 후보를 만들지 않는다
녹색 로고가 탐색 영역을 만들지 않도록 가장 큰 연결 잔디 영역을 사용한다
공중볼 후보를 포함하도록 잔디 영역 위아래의 탐색 띠를 영상 높이의 15%만큼 확장한다
색이 어두운 공과 선 위에 겹친 공 및 가려진 공을 놓칠 수 있다
단일 후보라도 공임을 보장하지 않으며 신발과 그래픽 등과의 혼동은 실영상 평가 대상이다

camera_affine은 이전 분석 프레임에서 현재 분석 프레임으로의 전역 변환이다
추적은 이 변환으로 카메라 이동과 확대를 보정한 뒤 후보의 잔여 이동을 계산한다
화면 좌표 경로는 짧은 가림을 건너 유지할 수 있지만 가려진 프레임에 가상 좌표를 기록하지 않는다
카메라 보정 실패 시 화면 위치만 기록하고 기존 정지 이력은 초기화한다
초당 약 15개 샘플을 사용하며 빠르게 움직이는 공은 여전히 연결 범위를 벗어날 수 있다

기준선은 600ms 정지 관찰 뒤 두 연속 샘플의 움직임을 확인한다
candidate_motion_onsets는 해당 후보의 정지 후 움직임 시각과 확인 시각을 기록한다
이 시각은 실제 경기 재개나 코너킥 판정이 아니므로 ball_restarted를 채우지 않는다
크기와 거리 및 시간 기준은 개발 기본값이며 실영상 최적값은 아직 검증하지 않았다

## 공 후보 정답 평가

진단 결과와 동일한 영상의 개발용 라벨을 준비한 뒤 실행한다
원본 해시는 context-summary.json의 source_sha256을 사용한다

```sh
PYTHONPATH=apps/video-worker/src python3 -m replay_video.evaluate_ball /tmp/replay-context-result/context-summary.json /path/to/ball-labels.json
```

라벨은 source_sha256과 frames 배열을 가진 JSON이다
각 항목은 frame_index와 visibility를 가지며 VISIBLE이면 ball의 x와 y를 0부터 1 사이 좌표로 기록한다
ABSENT는 공이 없는 프레임이고 UNOBSERVABLE은 가림 등으로 확인할 수 없는 프레임이다
진단이 샘플링한 프레임만 평가하며 라벨 없는 프레임은 정답 없음으로 계산하지 않는다

평가기는 선택 후보의 정밀도와 재현율 및 좌표 오차와 측정 가능 프레임 수를 반환한다
좌표 일치 기준은 영상 대각선 길이의 2%이며 출력에도 기록한다
이 평가는 공 후보 좌표만 다루며 세트피스 종류나 원심 판정의 정확도를 측정하지 않는다

## Worker와 rules 연결

Worker는 후보마다 sampleCount와 selectedCount 및 cameraCount와 motionOnsetsMs를 tracking으로 전달한다
coverage는 원본 프레임 처리 범위이며 공 추적 성공률이 아니다
웹 서버는 수량 관계와 후보 안의 시각을 검증하고 incident_candidates의 tracking JSONB에 저장한다
웹 DB에는 0014_candidate_tracking·0015_candidate_scene_event·0016_broadcast_cue와 새 운영용 0017_analysis_perception_runs 마이그레이션을 적용해야 한다

rules는 추적 없음과 일부 처리 및 위치만 연결과 카메라 보정 측정 및 움직임 시작 신호를 구분한다
이 상태들은 공 후보 측정 상태이며 파울 판정과 세트피스 종류를 생성하지 않는다
카메라 보정 측정이 있는 후보도 구간 전체가 보정됐다는 의미는 아니므로 cameraCount를 함께 본다

실제 보고서를 API와 DB 및 rules까지 검증하려면 별도 테스트 DB와 REPLAY_PIPELINE_REPORT 경로를 사용한다
apps/web/test/adapters/tracking-flow.int.test.ts는 실제 Python runner의 변환을 실행하며 저장소 업로드는 로컬 파일 존재 검사로 대체한다

## 코너킥 영상 패턴과 규정 조건

corner-geometry-motion-v1은 코너에서 만나는 두 경계선과 잔디 영역 및 가까운 노란 깃대 형태를 찾는다
같은 기하가 유지된 뒤 코너 부근에서 경기장 안쪽으로 이어지는 작은 물체의 출발 경로를 확인한다
프레임 전역 이동을 보정하고 화면 전환과 불안정한 기하 및 경계선 위 물체는 제외한다
가파른 골대 기둥과 혼동하지 않도록 두 경계선이 모두 비스듬히 보이는 카메라 각도만 지원한다
조명과 카메라 각도 및 가림에 민감한 고전 영상 처리 기준선이며 다른 경기의 정확도는 검증 전이다

이 경로는 setpieces 상태 머신의 영상 패턴 모드를 사용한다
preparation_detected와 departure_detected를 사용하고 dead_ball과 ball_restarted는 미확인으로 둔다
restartMs는 관측한 출발 경로의 첫 시각이며 정확한 발 접촉 시각이 아니다
본방과 리플레이를 자동 구분하거나 같은 경기 사건으로 합치는 기능은 아직 없다

관찰된 sceneEvent에는 원본 기준 준비 구간과 출발 추정 시각 및 근거 시각을 기록한다
증거 구간은 준비 전 800ms부터 출발 후 8초까지 확보하며 기존 후보와 겹치면 두 구간을 모두 보존한다
서버는 사건과 근거 시각이 후보 안에 있는지 검증한 뒤 DB에 보존한다

rules는 코너킥 관찰을 OBSERVED로 반환하고 절차와 상대 거리 및 직접 수신 오프사이드 예외의 검토 조건을 제공한다
검증된 경기 판본과 관련 조항이 있을 때만 APPLICABLE로 규정 연결을 표시한다
APPLICABLE은 관련 조항 연결 상태이며 조건 충족이나 적법 판정이 아니다
판본 미확정 상태에서는 참고 조건만 표시하며 모든 개별 조건은 UNVERIFIED를 유지한다
코너킥 관찰과 관련 조건 및 클립은 내부 진단에 보존하며 사용자 확인 입력을 요구하지 않는다
자동 최종 화면은 규정 평가까지 완료된 결과만 표시한다
현재 Worker는 완료 판정의 자동 사실을 생성하지 않으므로 최종 공개 결과가 없다는 안내가 나올 수 있다

## 득점 방송 표시와 VAR 적용 범주

infrastructure/broadcast.py는 OpenCV의 고정 글자 형태와 내부 공간 및 방송판 배치와 색상 띠를 검사한다
300ms 이상 반복 관측된 GOAL 표시를 GOAL_GRAPHIC으로 기록하며 새 AI 모델과 학습 데이터는 추가하지 않는다
단서는 약 15Hz로 확인하고 지속되는 같은 방송 표시는 중복 출력하지 않는다
지원하지 않는 방송판이나 가림 및 다른 글자는 탐지하지 못할 수 있다

broadcast_cues는 진단 요약에 기록하고 후보의 broadcast_cue 및 API의 broadcastCue로 전달한다
후보가 없던 구간도 추가하며 방송 표시 전 20초와 후 12초의 맥락을 보존한다
모든 방송 단서 후보에 클립을 보장하며 기존 후보와 겹칠 때는 원래 구간도 보존한다

서버는 등록된 원본 해시의 경기 문맥과 정확한 K리그1·2 시즌 요강 및 단서를 포함하는 클립을 확인한 뒤 VAR 적용 범주 질문을 평가한다
현재 자동 검출 주제는 득점 관련 방송 표시이며 실제 득점 인정과 VAR 실시 및 오심 판단을 뜻하지 않는다
양 리그의 2025·2026 요강은 지원하지만 알려진 원본의 경기 자동 연결은 현재 등록된 한 영상에 한정된다
실제 결과와 검증 명령의 범위는 [K리그 연결 점검](../../docs/analysis/K리그연결점검.md)을 따른다
