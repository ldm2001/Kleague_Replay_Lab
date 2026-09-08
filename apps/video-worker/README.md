# Replay Lab Video Worker

현재 단계는 실제 미디어 파일을 대상으로 하는 영상 파이프라인의 기준 구현이다

```text
ffprobe 메타데이터 확인
→ OpenCV 샷 경계 탐지
→ 움직임 급증 기반 검토 후보 생성
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

사이트 연결 Worker 실행

AI 모델 호출과 모델 환경설정은 사용하지 않는다

```bash
cd ../..
npm run dev:worker
```

개발 스크립트가 `apps/web/.env.local`을 자동으로 읽는다

결과 디렉터리에는 `report.json`과 후보별 `frames`와 `clips`가 생성된다

기초 후보 범주는 `OTHER`로 기록한다 화면 변화 점수는 접촉과 강도의 근거가 아니다
서버는 저장된 후보와 근거에 rules 필터를 적용하고 부족한 근거를 확인 불가로 반환한다
사용자 사실 입력이나 확인 단계는 없다

Application 파이프라인은 `PipelinePorts`만 사용
실제 미디어 구현은 `infrastructure.ports.media`에서 조립

Job 경계는 `replay_video.worker.job`으로 제공한다 현재 `VALIDATE_VIDEO`는 영상 메타데이터를 검증하고 `ANALYZE_VIDEO`는 위 파이프라인 전체를 실행한다

`replay_video.runner`는 Nextjs 내부 API에서 작업을 선점하고 Lease를 갱신하고 원본 영상을 내려받아 결과를 제출한다

후보는 최대 40건까지 저장하고 모든 후보의 프레임과 변화 신호가 높은 8건의 짧은 클립을 Object Storage에 업로드한다

후속 작업에서 선수와 공 추적을 검토할 수 있지만 AI 모델 도입이나 자동 판정 추가는 별도 설계 승인 없이는 하지 않는다

## 세트피스 원시 신호 진단

개발 평가용 진단은 별도 모듈로 실행한다
루트 디렉터리에서 원본 영상과 새 출력 폴더를 지정한다

```sh
PYTHONPATH=apps/video-worker/src python3 -m replay_video.inspect /path/to/match.mp4 /tmp/replay-context-result
```

- `context.jsonl` 샘플별 잔디색 비율과 선분 및 카메라 이동 근사치와 정합 잔차
- `context-summary.json` 읽은 프레임 수와 측정 가능 건수 및 미확인 항목
- 기존 결과 폴더에 같은 파일이 있으면 덮어쓰지 않고 중단

공과 선수 위치 및 중단과 재개 상태는 현재 추출하지 않으므로 null로 기록한다
색상 변화가 큰 구간에서는 프레임 간 움직임 비교를 초기화한다
시간은 디코더 값을 우선하고 이를 사용할 수 없는 샘플은 NOMINAL_FPS로 표시한다
좌표는 축소 영상의 픽셀 기준이며 실제 경기장 거리나 접촉 강도가 아니다

`domain/setpieces.py`는 근거가 확보된 중단과 재개 입력을 받는 순수 상태 머신이다
여섯 재개 종류를 지원하며 근거 공백과 종류 충돌 및 리플레이는 UNKNOWN으로 반환한다
공 위치와 경기 상태를 생성하는 추출기가 검증되기 전까지 진단 코드를 운영 후보나 rules 판단에 연결하지 않는다
합성 테스트 통과는 K리그 세트피스 인식 정확도를 의미하지 않는다

설계와 논문 근거는 [세트피스 설계](../../docs/design/세트피스.md)를 본다
