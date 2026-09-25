import { createHash } from "node:crypto";
import {
    INCIDENT_CONTEXT_KEYS,
    INCIDENT_OBSERVATION_KEYS,
    type IncidentAssertion,
    type IncidentContext,
    type IncidentMeasurement,
    type IncidentRecordV1
} from "../../../shared/incident";
import { incidentRecordData } from "../../../shared/incident-schema";
import {
    interactionData,
    incidentLineage,
    type InteractionObservationV1,
    type InteractionRecordLink
} from "../../../shared/interaction";

// 관측 보존과 유형별 기록 생성의 분기 자료형 정의
type Conversion = {
    kind: "UNRESOLVED";
    observation: InteractionObservationV1;
    reasons: string[];
} | {
    kind: "GENERATED";
    observation: InteractionObservationV1;
    record: IncidentRecordV1;
    link: InteractionRecordLink;
};

// 독립 가설만 유형별 미승인 사건 기록으로 변환
export function incidentRecord(input: unknown): Conversion {
    // 기존 엄격 계약 검사 후 원본과 분리된 관측 복사본 생성
    if (!interactionData(input)) {
        throw new Error("Invalid interaction observation contract");
    }
    const observation = structuredClone(input);
    // 유형과 방향의 독립 가설 부족 및 미지원 유형 확인
    const reasons: string[] = [];
    if (observation.actionType.state === "UNKNOWN") reasons.push("ACTION_TYPE_UNKNOWN");
    if (observation.direction.state === "UNKNOWN") reasons.push("DIRECTION_UNKNOWN");
    if (
        observation.actionType.state === "HYPOTHESIS" &&
        observation.actionType.value !== "HOLDING_MOTION"
    ) {
        reasons.push("ACTION_TYPE_UNSUPPORTED");
    }
    if (reasons.length) return { kind: "UNRESOLVED", observation, reasons };

    // 실제 목록의 프레임 시점과 양수 길이 클립만 근거로 선택
    const media = observation.evidence
        .filter((e) => e.kind === "FRAME" || e.startMs < e.endMs)
        .map((e) => e.kind === "FRAME"
            ? { ...e, startMs: e.timestampMs, endMs: e.timestampMs }
            : e
        );
    if (!media.length) {
        return { kind: "UNRESOLVED", observation, reasons: ["MEDIA_EVIDENCE_MISSING"] };
    }
    // 관측과 선택 근거를 포함하되 새로운 시간 길이는 만들지 않는 구간 생성
    const startMs = Math.min(observation.startMs, ...media.map((e) => e.startMs));
    const endMs = Math.max(observation.endMs, ...media.map((e) => e.endMs));
    if (startMs === endMs) {
        return { kind: "UNRESOLVED", observation, reasons: ["SEGMENT_SPAN_UNKNOWN"] };
    }
    // 원본과 후보 및 개별 관측에 결합된 결정적 지문 생성
    const digest = createHash("sha256").update(JSON.stringify([
        "interaction-holding-adapter-v1",
        observation.sourceSha256,
        observation.candidateId,
        observation.observationId
    ])).digest("hex");

    // 출처가 같은 기록 안의 항목별 고유 식별자 반환
    const id = (name: string) => `${digest}:${name}`;

    // 원래 구간 식별자와 근거 인덱스를 보존한 영상 참조 생성
    const segmentId = observation.participantA.segmentId;
    const evidence = media.map((e) => ({
        id: id(`evidence:${e.evidenceIndex}`),
        segmentId,
        kind: e.kind,
        startMs: e.startMs,
        endMs: e.endMs,
        contentSha256: e.contentSha256
    }));

    // 가설을 승인 사실로 승격하지 않는 관측 주장 생성
    const assertion = (
        name: string,
        method = { id: "interaction-holding-adapter", version: "1" },
        evidenceIds: readonly string[] = []
    ): IncidentAssertion => ({
        id: id(name),
        state: "UNKNOWN",
        origin: "MODEL_ESTIMATE",
        method,
        evidenceIds,
        confidence: null,
        reasons: ["HYPOTHESIS_NOT_VERIFIED"]
    });

    // 각 측정의 시간 범위를 덮는 근거가 있을 때만 화면 측정값 보존
    const measurements: IncidentMeasurement[] = Object.entries(observation.measurements)
        .map(([name, m]) => {
            const proof = evidence.filter((e) =>
                e.startMs <= m.startMs && e.endMs >= m.endMs &&
                (m.startMs === m.endMs || e.kind === "CLIP")
            );
            const known = m.state === "MEASURED" && proof.length > 0;
            return {
                id: id(`measurement:${name}`),
                state: known ? "KNOWN" : "UNKNOWN",
                origin: "IMAGE_MEASUREMENT",
                method: { id: observation.method.id, version: "1" },
                evidenceIds: known ? proof.map((e) => e.id) : [],
                confidence: null,
                reasons: known ? [] : m.state === "UNKNOWN"
                    ? [...m.reasons] : ["MEASUREMENT_WINDOW_EVIDENCE_MISSING"],
                quantity: m.unit === "px" ? "IMAGE_DISTANCE"
                    : m.unit === "px_per_s" ? "IMAGE_SPEED" : "ANGLE",
                unit: m.unit,
                value: known ? m.value : null
            };
        });
    // 중립 참여자 순서를 유지하며 신원과 소속 팀의 미확인 상태 보존
    const actors = [observation.participantA, observation.participantB].map((p, i) => ({
        id: id(`actor:${i}`),
        tracklets: [{
            segmentId: p.segmentId,
            continuityId: String(p.continuityId),
            trackId: p.trackId
        }],
        teamId: null,
        teamAssignment: assertion(`team:${i}`)
    }));
    // 경기 문맥과 잡기 관측을 모두 미확인 주장으로 생성
    const context = Object.fromEntries(INCIDENT_CONTEXT_KEYS.map((name) =>
        [name, assertion(`context:${name}`)]
    )) as IncidentContext;
    const observations = Object.fromEntries(INCIDENT_OBSERVATION_KEYS.HOLDING_MOTION.map((name) =>
        [name, assertion(
            `observation:${name}`,
            name === "actionObserved" && observation.actionType.state === "HYPOTHESIS"
                ? observation.actionType.method : undefined,
            name === "actionObserved" ? evidence.map((e) => e.id) : []
        )]
    )) as Extract<IncidentRecordV1["actions"][number], { type: "HOLDING_MOTION" }>["observations"];
    // 독립 방향 가설에 따라 행위 주체와 대상만 배치
    const forward = observation.direction.value === "A_TO_B";
    const record: IncidentRecordV1 = {
        schemaVersion: "incident-record-v1",
        incidentId: id("incident"),
        sourceSha256: observation.sourceSha256,
        match: {
            matchId: null,
            competition: null,
            season: null,
            matchDate: null,
            ifabVersionId: null,
            verification: "UNVERIFIED"
        },
        segments: [{
            id: segmentId,
            shotId: segmentId,
            cameraId: null,
            startMs,
            endMs,
            playbackSpeed: "UNKNOWN",
            replayState: "UNKNOWN",
            matchClockMs: null
        }],
        evidence,
        actors,
        links: [],
        actions: [{
            id: id("action"),
            type: "HOLDING_MOTION",
            actorId: actors[forward ? 0 : 1]!.id,
            targetActorId: actors[forward ? 1 : 0]!.id,
            segmentId,
            startMs: observation.startMs,
            endMs: observation.endMs,
            context,
            observations,
            measurements
        }],
        refereeDecisions: []
    };
    // 기존 사건 구조와 추적 출처 계약을 통과한 결과만 반환
    const link = incidentLineage(observation, record, id("action"));
    if (!incidentRecordData(record) || !link) {
        throw new Error("Invalid interaction incident conversion or lineage");
    }
    return { kind: "GENERATED", observation, record, link };
}
