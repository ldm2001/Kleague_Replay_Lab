// 작업 선점과 진행과 결과 저장 및 증거 접근의 저장소 계약 가져옴
import type {
    EvidenceAccess,
    EvidenceAccessCommand,
    EvidenceStore as EvidencePort,
    JobClaimCommand,
    JobLease,
    JobProgress,
    JobProgressCommand,
    JobProgressStore as ProgressPort,
    JobResult,
    JobResultCommand,
    JobResultPreflight,
    JobResultPreflightCommand,
    JobResultStore as ResultPort,
    JobStore as JobPort
} from "@replay/application";
// 작업 임대에 따른 증거 업로드 권한 확인 기능 가져옴
import { access } from "./job/access";
// 분석 결과 저장 기능 가져옴
import { analysis } from "./job/analysis";
// 작업 선점과 임대 저장 기능 가져옴
import { claim } from "./job/claim";
// 저장소 연결과 시계 계약 가져옴
import type { DatabaseHandle, WallClock } from "./job/connection";
// 작업자 실패의 재대기 또는 최종 실패 저장 기능 가져옴
import { failure } from "./job/failure";
// 결과 제출 전 임대와 원본 및 경기 문맥 확인 기능 가져옴
import { preflight } from "./job/preflight";
// 작업 진행 저장 기능 가져옴
import { progress } from "./job/progress";
// 영상 검증 결과와 후속 분석 작업 저장 기능 가져옴
import { validation } from "./job/validation";

// 작업 선점과 진행과 결과 및 증거 권한을 책임별 모듈에 위임하는 작업 저장소 어댑터
export class JobStore implements JobPort, ProgressPort, ResultPort, EvidencePort {
    // 저장소 연결과 저장 직전 만료 검사 시계 주입
    public constructor(
        private readonly client: DatabaseHandle,
        private readonly wallClock: WallClock = () => new Date()
    ) {}

    // 처리할 작업 선점과 해시로 받은 임대 저장
    public async claim(command: JobClaimCommand): Promise<JobLease | null> {
        // 작업 선점 모듈의 선점 결과 반환
        return claim(this.client, command);
    }

    // 진행 처리
    public async progress(command: JobProgressCommand): Promise<JobProgress> {
        // 작업 진행 모듈의 저장 결과 반환
        return progress(this.client, command);
    }

    // 결과 제출 전 임대·원본·경기 문맥 확인
    public async preflight(command: JobResultPreflightCommand): Promise<JobResultPreflight> {
        // 사전 검사 모듈의 확인 결과 반환
        return preflight(this.client, this.wallClock, command);
    }

    // 결과 처리
    public async result(command: JobResultCommand): Promise<JobResult> {
        // 작업자 결과 자료 읽음
        const payload = command.payload;
        // 영상 검증 결과는 검증 저장 모듈의 결과 반환
        if (payload.kind === "VALIDATED") return validation(this.client, command, payload);
        // 분석 결과는 분석 저장 모듈의 결과 반환
        if (payload.kind === "ANALYZED") {
            return analysis(this.client, this.wallClock, command, payload);
        }
        // 작업자 실패는 실패 저장 모듈의 결과 반환
        return failure(this.client, command, payload);
    }

    // 작업 임대에 따른 원본 접근 확인
    public async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
        // 증거 접근 모듈의 권한 확인 결과 반환
        return access(this.client, command);
    }
}

// 작업 저장소 생성
export const jobStore = (client: DatabaseHandle): JobStore => new JobStore(client);
