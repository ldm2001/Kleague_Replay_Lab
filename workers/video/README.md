# Replay Lab Video Worker

현재 단계는 실제 미디어 파일을 대상으로 하는 영상 파이프라인의 기준 구현이다.

```text
ffprobe 메타데이터 확인
→ OpenCV 샷 경계 탐지
→ 움직임 급증 기반 검토 후보 생성
→ 후보 전후 프레임 추출
→ FFmpeg 짧은 증거 클립 생성
→ report.json 기록
```

## 실행

```bash
npm run test:video

cd workers/video
PYTHONPATH=src python3 -m replay_video.cli \
  /path/to/highlight.mp4 \
  /tmp/replay-lab-result
```

결과 디렉터리에는 `report.json`과 후보별 `frames`와 `clips`가 생성된다.

현재 후보 범주는 `OTHER`로 기록한다. 이 단계는 샷과 시간 근거를 만드는 기준선이며 파울과 핸드볼과 차징과 득점 취소를 분류하는 모델은 아직 연결하지 않는다. `report.json`의 `limitations`에도 이 한계를 기록한다.

다음 단계에서 `VALIDATE_VIDEO`와 `ANALYZE_VIDEO` Job 계약과 연결하고 선수·공·포즈 추적과 사건별 분류기를 추가한다.
