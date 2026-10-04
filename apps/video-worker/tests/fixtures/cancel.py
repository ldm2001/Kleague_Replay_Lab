from replay_video.runner import PulseStopped

# 지정 순번 확인에서 한 번만 임대 상실을 알리는 작업 취소 대역
class Cancel:

    # 중단할 확인 순번 구성
    def __init__(self, at: int) -> None:
        # 중단 신호를 보낼 확인 순번 보관
        self.at = at
        # 확인 횟수 초기화
        self.count = 0

    # 작업 취소 확인
    def __call__(self) -> None:
        # 확인 횟수 증가
        self.count += 1
        # 중단 순번 도달 여부 확인
        if self.count == self.at:
            # 임대 상실 중단 신호 전달
            raise PulseStopped("WORKER_LEASE_LOST")
