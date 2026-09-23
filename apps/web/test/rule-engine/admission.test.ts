import { describe, expect, it } from "vitest";
import {
    perceptionAdmission,
    perceptionRecognitionMethods,
    type PerceptionAdmissionContext
} from "@replay/rule-engine";
import type { PerceptionRun } from "@replay/shared-types";
import { avPerceptionPayload } from "../fixtures/perception";

// 원본 영상 식별에 사용할 고정 해시 생성
const SOURCE = "a".repeat(64);
// 인식 산출물 식별에 사용할 고정 해시 생성
const ARTIFACT = "b".repeat(64);
// 근거 파일 무결성 비교용 고정 해시 생성
const EVIDENCE = "c".repeat(64);

// 표본 처리는 완료됐지만 접촉과 심판 판단은 미검증인 인식 입력 생성
const run = (): PerceptionRun => ({
    schemaVersion: "perception-run-v1",
    sourceSha256: SOURCE,
    // 예정된 표본 처리 완료 표시이며 파울 판정 완료와 별개
    processingStatus: "COMPLETE",
    // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
    coverage: {
        startMs: 0,
        endMs: 2_000,
        sampleIntervalMs: 500,
        // 누락 여부 비교에 사용할 예정 표본 수 설정
        expectedSamples: 4,
        // 실제로 처리한 표본 수 설정이며 판정 사건 수와 구분
        processedSamples: 4,
        // 처리에 실패한 표본 수 설정
        failedSamples: 0
    },
    // 모델 출처와 고정된 개정번호 및 가중치 해시 대조용 목록 구성
    models: [
        {
            component: "detector",
            modelId: "PekingU/rtdetr_r18vd",
            revision: "ac77a11ff0170a41b771c03264987f8ce2b0d753",
            weightsSha256: "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093"
        },
        {
            component: "role",
            modelId: "martinjolif/yolo-football-player-detection",
            revision: "5e83fafa8d564243001ce8e063612a618a138fbe",
            weightsSha256: "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd"
        },
        {
            component: "pose",
            modelId: "usyd-community/vitpose-plus-small",
            revision: "0c30b6534bb621af0162b481176742577264e36e",
            weightsSha256: "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9"
        }
    ],
    artifact: {
        objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${ARTIFACT}.jsonl.gz`,
        contentType: "application/gzip",
        contentSha256: ARTIFACT,
        sizeBytes: 1_024
    },
    summary: {
        roleObservationCount: 1,
        poseObservationCount: 1,
        officialCueCount: 1,
        interactionCount: 1,
        linkCount: 1,
        truncated: false,
        reasons: []
    },
    // 관측 사건 목록이며 규정 사실 채택과 파울 판단은 별도 확인
    incidents: [
        {
            id: "incident-1",
            candidateIndex: 1,
            continuityId: 1,
            startMs: 600,
            endMs: 1_400,
            // 관측 사건과 저장 근거를 연결하는 순번 목록 구성
            evidenceIndices: [0],
            // 심판 역할을 알 수 없는 관측 상태 보존
            officialRole: "UNKNOWN",
            // 심판 신호를 알 수 없는 관측 상태 보존
            signal: "UNKNOWN",
            // 접촉 미검증 상태이며 실제 접촉 사실로 채택하지 않음
            contact: "UNVERIFIED",
            // 원심을 알 수 없는 상태이며 판정 내용을 추정하지 않음
            originalDecision: "UNKNOWN",
            // 재개 미검증 상태이며 재개 사실로 채택하지 않음
            restart: "UNVERIFIED",
            reasons: ["method-not-verified"]
        }
    ]
});

// 저장 자료와 근거 및 규정 판본이 확인된 서버 맥락 생성
const context = (): PerceptionAdmissionContext => ({
    // 서버가 저장 맥락을 확인한 시험 조건이며 인식 방법 승인과 별개
    serverVerified: true,
    pipelineVersion: "video-local-observers-v1",
    sourceSha256: SOURCE,
    artifact: { objectKey: run().artifact.objectKey, contentSha256: ARTIFACT, sizeBytes: 1_024 },
    // 후보별 근거 위치와 내용 해시를 대조할 참조 목록 구성
    references: [{ evidenceIndex: 0, candidateIndex: 1, startMs: 1_000, endMs: 1_000,
        declaredContentSha256: EVIDENCE, verifiedContentSha256: EVIDENCE }],
    // 경기와 연결된 규정 판본의 검증 맥락 구성
    ruleEdition: { id: "44444444-4444-4444-8444-444444444444", verificationStatus: "VERIFIED",
        matchId: "33333333-3333-4333-8333-333333333333", ifabEdition: "2026-27" },
});

describe("perception admission", () => {
    it("keeps a truncated-away audio cue method unverified", () => {
        // 음향 단서가 포함된 시청각 인식 자료 준비
        const value = avPerceptionPayload().perception as any;
        // 요약에서 빠진 음향 단서 상황을 만들도록 단서 목록 비움
        value.audio.cues = [];
        // 남아 있는 시청각 연결도 없는 상황 설정
        value.audio.associations = [];
        // 음향 요약에서 일부 관측이 잘린 상태 설정
        value.audio.truncated = true;
        // 저장 무결성만 검증된 서버 맥락 준비
        const verified = context();
        // 음향 단서 방법 미검증 값이 결과에 포함됨 확인
        expect(
            perceptionAdmission(value, {
                ...verified,
                pipelineVersion: "video-local-observers-av-v1"
            }).reasons
        ).toContain("AUDIO_CUE_METHOD_NOT_VERIFIED");
    });
    it("keeps pinned and storage-verified observations private while recognition methods are closed", () => {
        // 운영 인식 방법 중 승인 완료 상태가 없음 확인
        expect(Object.values(perceptionRecognitionMethods)).not.toContain("VERIFIED");
        // 저장 무결성 확인만으로 규정 사실 채택이 가능한지 평가
        const result = perceptionAdmission(run(), context());
        // 결과가 규정 입력 채택 거부 상태로 유지됨 확인
        expect(result.status).toBe("NOT_ADMITTED");
        // 역할 인식 방법 미검증 및 심판 신호 인식 방법 미검증 및 접촉 인식 방법 미검증 및 파울 인식 방법 미검증 및 원심 인식 방법 미검증 및 재개 인식 방법 미검증 조건을 포함한 기대 결과 일치 확인
        expect(result.reasons).toEqual(
            expect.arrayContaining([
                "ROLE_METHOD_NOT_VERIFIED",
                "SIGNAL_METHOD_NOT_VERIFIED",
                "CONTACT_METHOD_NOT_VERIFIED",
                "FOUL_METHOD_NOT_VERIFIED",
                "ORIGINAL_DECISION_METHOD_NOT_VERIFIED",
                "RESTART_METHOD_NOT_VERIFIED"
            ])
        );
        // 결과의 사실 항목 없음 확인
        expect(result).not.toHaveProperty("facts");
        // 파울 아님 값이 결과에 포함되지 않음 확인
        expect(JSON.stringify(result)).not.toContain("NO_FOUL");
    });

    it("revokes admission evidence when any incident reference is removed or changed", () => {
        // 근거 참조 누락을 시험할 서버 맥락 준비
        const missing = context() as any;
        // 누락 참조목록을 0개 항목 목록 값으로 설정
        missing.references = [];
        // 첫 근거 참조 누락 사유가 결과에 포함됨 확인
        expect(perceptionAdmission(run(), missing).reasons).toContain("REFERENCE_MISSING:0");

        // 다른 후보에 연결된 근거를 시험할 서버 맥락 준비
        const wrongCandidate = context() as any;
        // 후보 참조목록 중 선택 항목 후보 순번을 2 값으로 설정
        wrongCandidate.references[0]!.candidateIndex = 2;
        // 첫 근거 참조의 후보 불일치 사유가 결과에 포함됨 확인
        expect(perceptionAdmission(run(), wrongCandidate).reasons).toContain(
            "REFERENCE_CANDIDATE_MISMATCH:0"
        );

        // 신고 해시와 검증 해시의 불일치 시험 자료 준비
        const wrongHash = context() as any;
        // 해시 참조목록 중 선택 항목 검증완료 내용 해시를 지정 문자열 반복문자열 결과 값으로 설정
        wrongHash.references[0]!.verifiedContentSha256 = "d".repeat(64);
        // 첫 근거 참조의 해시 미검증 값이 결과에 포함됨 확인
        expect(perceptionAdmission(run(), wrongHash).reasons).toContain(
            "REFERENCE_HASH_UNVERIFIED:0"
        );
    });

    it("rejects cross-cut references without demanding a clip cover the whole incident", () => {
        // 사건 시간 밖에 위치한 근거를 시험할 맥락 준비
        const crossCut = context() as any;
        // 시험자료 참조목록 중 선택 항목 시작시각을 1_500 값으로 설정
        crossCut.references[0]!.startMs = 1_500;
        // 시험자료 참조목록 중 선택 항목 종료시각을 1_600 값으로 설정
        crossCut.references[0]!.endMs = 1_600;
        // 첫 사건을 뒷받침하는 근거 시간 범위 부족 사유가 결과에 포함됨 확인
        expect(perceptionAdmission(run(), crossCut).reasons).toContain(
            "REFERENCE_COVERAGE_INSUFFICIENT:incident-1"
        );

        // 사건 시간 안의 단일 프레임 근거를 시험할 맥락 준비
        const oneFrame = context() as any;
        // 시험자료 참조목록 중 선택 항목 시작시각을 800 값으로 설정
        oneFrame.references[0]!.startMs = 800;
        // 시험자료 참조목록 중 선택 항목 종료시각을 800 값으로 설정
        oneFrame.references[0]!.endMs = 800;
        // 첫 사건을 뒷받침하는 근거 시간 범위 부족 사유가 결과에 포함되지 않음 확인
        expect(perceptionAdmission(run(), oneFrame).reasons).not.toContain(
            "REFERENCE_COVERAGE_INSUFFICIENT:incident-1"
        );
    });

    it("records partial, truncated, unknown, source, object, pin and edition gates as concrete reasons", () => {
        // 여러 채택 전제조건의 동시 실패를 시험할 인식 자료 준비
        const value = run() as any;
        // 표본 처리가 일부만 완료된 상태 설정
        value.processingStatus = "PARTIAL";
        // 전체 관측이 남지 않은 잘린 요약 상태 설정
        value.summary.truncated = true;
        // 승인된 개정번호와 다른 검출 모델 출처 설정
        value.models[0]!.revision = "wrong";
        // 첫 사건의 심판 역할을 알 수 없는 상태로 설정
        value.incidents[0]!.officialRole = "UNKNOWN";
        // 첫 사건의 심판 신호를 알 수 없는 상태로 설정
        value.incidents[0]!.signal = "UNKNOWN";
        // 서버 검증 실패 조건을 추가할 맥락 준비
        const verified = context() as any;
        // 저장 맥락의 서버 확인이 없는 상태 설정
        verified.serverVerified = false;
        // 검증완료 원본 해시를 지정 문자열 반복문자열 결과 값으로 설정
        verified.sourceSha256 = "d".repeat(64);
        // 검증완료 산출물 크기 바이트를 2_048 값으로 설정
        verified.artifact.sizeBytes = 2_048;
        // 검증완료 규정 판본을 빈 값 값으로 설정
        verified.ruleEdition = null;

        // 요약 일부 잘림 내용을 포함한 기대 결과 일치 확인
        expect(perceptionAdmission(value, verified).reasons).toEqual(
            expect.arrayContaining([
                "SERVER_CONTEXT_UNVERIFIED",
                "PROCESSING_NOT_COMPLETE",
                "SUMMARY_TRUNCATED",
                "MODEL_PROVENANCE_UNPINNED:detector",
                "SOURCE_HASH_UNVERIFIED",
                "ARTIFACT_UNVERIFIED",
                "RULE_EDITION_UNVERIFIED",
                "OFFICIAL_ROLE_UNKNOWN:incident-1",
                "SIGNAL_UNKNOWN:incident-1"
            ])
        );
    });
});
