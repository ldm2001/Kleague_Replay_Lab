# 파이썬과 타입스크립트 생산자 시험에 공통으로 사용하는 프레임 생성
def frame(ms=0, pair=("t2", "t1"), continuity=0, shift=0):
    # 같은 화면에 놓인 두 사람의 중립 검출 자료 생성
    detections = [
        {
            "detectionId": i,
            "trackId": track,
            "label": "person",
            "box": [x + shift, 0, x + 100 + shift, 200],
        }
        for i, (track, x) in enumerate((("t1", 0), ("t2", 100)))
    ]
    # 사람 상자와 대응하는 자세 좌표 자료 생성
    poses = [
        {
            "detectionId": d["detectionId"],
            "sourceBox": d["box"],
            "keypoints": [
                {"name": name, "x": x + shift, "y": y, "score": 0.9}
                for name, x, y in (
                    ("L_Shoulder", 20, 40),
                    ("R_Shoulder", 80, 40),
                    ("L_Hip", 20, 140),
                    ("R_Hip", 80, 140),
                    ("L_Elbow", 40, 60),
                    ("R_Elbow", 60, 60),
                    ("L_Wrist", 60, 80),
                    ("R_Wrist", 80, 80),
                )
            ],
        }
        for d in detections
    ]
    # 원본 지문과 시각 및 중립 검출이 결합된 프레임 반환
    return {
        "kind": "FRAME",
        "sourceSha256": "a" * 64,
        "continuityId": continuity,
        "frame": {
            "decodedIndex": ms // 100,
            "timestampSource": "DECODER_PTS",
            "timestampMs": ms,
            "pts": ms,
            "timeBase": {"numerator": 1, "denominator": 1000},
            "originPts": 0,
            "originTimeBase": {"numerator": 1, "denominator": 1000},
            "width": 500,
            "height": 300,
            "streamIndex": 0,
        },
        "detections": detections,
        "poses": poses,
        "interactions": [
            {"id": "upstream", "actorTrackIds": list(pair), "startMs": 0, "endMs": ms}
        ],
    }
