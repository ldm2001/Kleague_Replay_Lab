// 자동 규정 평가의 실제 실행 기능 가져옴
import { automaticReview } from "../evaluation/automatic";
// 결과 입력 계약 가져옴
import type { ResultInput } from "./result";
// 분석 전송 자료 계약 가져옴
import type { AnalysisPayload } from "../../ports/repositories/job-store";
// 실제 파일 검증 문맥과 해시 기능 가져옴
import { bytesHex, type Context, type objects } from "./objects";

// 검증을 마친 파일 묶음 계약 정의
type Verified = Extract<Awaited<ReturnType<typeof objects>>, { kind: "VERIFIED" }>;

// 확인된 문맥과 증거로 자동 평가 입력 조립
export const review = (
    input: ResultInput & { payload: AnalysisPayload },
    preflight: Context,
    verified: Verified
) => {
    // 파일 검증을 마친 관측과 증거 참조 읽음
    const perception = input.payload.perception!;
    // 제출 증거 목록 읽음
    const evidence = input.payload.evidence ?? [];
    // 실제 검증된 증거 참조 읽음
    const references = verified.references;
    // 사전 검사에서 확인한 경기 적용 규정 판본 읽음
    const edition = preflight.ruleEdition;
    // 후보별 자동 규정 평가 자료 반환
    return automaticReview({
        // 분석 기록의 식별자
        analysisId: preflight.analysisId,
        // 처리 작업의 식별자
        jobId: input.jobId.toLowerCase(),
        // 재실행 이전 요청을 구분하는 작업 판본
        jobRevision: input.jobRevision,
        // 영상 전체 길이의 밀리초 값
        durationMs: preflight.durationMs ?? 0,
        // 분석한 원본 영상의 내용 해시
        sourceSha256: bytesHex(preflight.sourceSha256),
        // 영상 처리 절차를 구별하는 버전
        pipelineVersion: input.payload.pipelineVersion,
        // 사실 채택과 구분한 모델 관측 처리 자료
        perception,
        // 파울 확정과 별개로 관리하는 후보 장면 목록
        candidates: input.payload.candidates,
        // 경기 문맥에 맞춰 연결한 규정 자료
        rule:
            edition?.verificationStatus === "VERIFIED" &&
            edition.competition &&
            edition.season
                ? {
                    // 다른 기록과 구별하는 고유 식별자
                    id: edition.id,
                    // 검증된 경기 기록의 식별자
                    matchId: edition.matchId,
                    // 규정 적용 대상 대회
                    competition: edition.competition,
                    // 규정 적용 대상 시즌
                    season: edition.season,
                    // 국제 축구 규정 판본 식별자
                    ifabVersionId: `ifab-${edition.ifabEdition}`,
                    // 규정 문맥의 검증 상태
                    verificationStatus: "VERIFIED"
                }
                : null,
        // 관측 또는 규정과 연결한 증거 참조 목록
        references: references
            .filter((reference) => reference !== null)
            .map((reference) => {
                // 참조 순번에 해당하는 제출 증거 항목 읽음
                const item = evidence[reference.evidenceIndex]!;
                // 현재 분석과 작업 판본 및 내용 해시를 묶은 증거 경로 생성
                const prefix = `evidence/${preflight.analysisId}/${input.jobId.toLowerCase()}/${input.jobRevision}/${item.contentSha256}/`;
                // 서버 확인 해시와 덮어쓰기 방지 경로 여부를 포함한 증거 반환
                return {
                    // 제출 목록에서 증거를 찾는 순번
                    evidenceIndex: reference.evidenceIndex,
                    // 처리 결과에서 후보 장면을 찾는 순번
                    candidateIndex: reference.candidateIndex,
                    // 처리 분기 또는 자료 종류를 구별하는 값
                    kind: item.kind,
                    // 원본 영상 기준 구간 시작 밀리초
                    startMs: item.startMs,
                    // 원본 영상 기준 구간 종료 밀리초
                    endMs: item.endMs,
                    // 파일 내용의 동일성을 대조하는 해시
                    contentSha256: reference.verifiedContentSha256,
                    // 내용 해시 기반 경로로 덮어쓰기를 막았는지 여부
                    immutable:
                        item.objectKey.startsWith(prefix) &&
                        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
                            item.objectKey.slice(prefix.length)
                        )
                };
            })
    });
};
