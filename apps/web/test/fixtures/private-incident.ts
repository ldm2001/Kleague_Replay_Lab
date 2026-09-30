import { vi } from "vitest";
import type { AnalysisPayload, VerifiedMatch } from "@replay/application";
import type { IncidentMatch, InteractionObservationV1, PrivateIncidentBatch } from "@replay/shared-types";
import { incidentBatch } from "../../src/application/use-cases/incidents/batch";
import { interactionFixture } from "./interaction";

// 파이썬 생산자 호출을 파일당 한 번으로 줄인 기준 관측
let base: InteractionObservationV1 | undefined;

// 저장 시점에 잠근 현재 검증 경기
export const lockedMatch: VerifiedMatch = {
    matchId: "fixture-match",
    competition: "fixture",
    season: "fixture",
    matchDate: "2026-01-01",
    ifabVersionId: "ifab-2025-26"
};

// 사건이 선언한 검증 경기
export const declaredMatch: IncidentMatch = { ...lockedMatch, verification: "VERIFIED" };

// 관측 증거와 같은 종류와 해시 및 구간을 가진 결과 저장 증거 목록
export const storedEvidence: NonNullable<AnalysisPayload["evidence"]> = [
    {
        candidateIndex: 0,
        kind: "CLIP",
        objectKey: `evidence/analysis/job/1/${"d".repeat(64)}/clip.mp4`,
        contentSha256: "d".repeat(64),
        startMs: 0,
        endMs: 100,
        width: null,
        height: null
    }
];

// 저장 경계가 대조하는 현재 작업의 원본과 산출물 및 증거 문맥
export const planContext = {
    sourceSha256: "a".repeat(64),
    artifactSha256: "b".repeat(64),
    evidence: storedEvidence
};

// 유형별 사건 여부와 선언 경기를 고른 결과 제출 경로와 같은 비공개 배치 생성
export async function privateBatch(typed: boolean, match?: IncidentMatch): Promise<PrivateIncidentBatch> {
    // 기준 관측 복제
    const observation = structuredClone(base ??= interactionFixture());
    // 작업 첫 증거를 가리키는 관측 증거 연결
    observation.evidence = [
        {
            evidenceIndex: 0,
            kind: "CLIP",
            path: "clips/clip.mp4",
            timestampMs: 100,
            startMs: 0,
            endMs: 100,
            contentSha256: "d".repeat(64),
            coversMeasurementWindow: true
        }
    ];
    // 잡기 사건 요청 시 행위 유형과 방향 가설 설정
    if (typed) {
        // 검증되지 않은 방법의 가설 출처
        const provenance = {
            state: "HYPOTHESIS" as const,
            reasons: ["METHOD_UNVALIDATED"],
            method: { id: "fixture", version: "1" },
            observationIds: [observation.observationId]
        };
        // 잡기 행위 유형 가설 설정
        observation.actionType = { ...provenance, value: "HOLDING_MOTION" };
        // 행위 방향 가설 설정
        observation.direction = { ...provenance, value: "A_TO_B" };
    }
    // 증거 파일 크기와 내용 해시를 돌려주는 저장소 모의객체
    const storage = {
        head: vi.fn(async () => ({ sizeBytes: 4, contentSha256: Buffer.from("d".repeat(64), "hex") }))
    };
    // 결과 저장 증거를 담은 분석 결과
    const payload: AnalysisPayload = {
        kind: "ANALYZED",
        pipelineVersion: "video-local-observers-av-v1",
        limitations: [],
        shots: [],
        candidates: [],
        evidence: storedEvidence
    };
    // 결과 제출 경로와 같은 배치 생성 결과 반환
    return incidentBatch(
        {
            schemaVersion: "private-incidents-v1",
            sourceSha256: planContext.sourceSha256,
            artifactSha256: planContext.artifactSha256,
            observations: [observation],
            truncated: false
        },
        payload,
        { analysisId: "analysis", jobId: "job", jobRevision: 1, ...(match ? { match } : {}) },
        storage
    );
}
