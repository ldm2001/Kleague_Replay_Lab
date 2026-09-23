import type { IncidentAssertion, IncidentRecordV1 } from "../../src/shared/incident";

// 검증용 사건 관측 구성
export function incidentAssertion(
    id: string,
    state: IncidentAssertion["state"] = "CONFIRMED"
): IncidentAssertion {
    // 식별자 및 상태 및 지정 항목 지정 문자열 및 방법 자료 반환
    return {
        id,
        state,
        origin: "MODEL_ESTIMATE",
        method: { id: "fixture-observer", version: "1" },
        evidenceIds: ["e1"],
        confidence: 0.99,
        reasons: state === "UNKNOWN" || state === "NOT_APPLICABLE" ? ["not established"] : []
    };
}

// 검증용 사건 입력 구성
export function incidentFixture(): IncidentRecordV1 {
    // 스키마 버전 사건 기록 및 사건 식별자 사건 1 및 원본 해시 및 경기 자료 반환
    return {
        schemaVersion: "incident-record-v1",
        incidentId: "incident-1",
        sourceSha256: "a".repeat(64),
        match: {
            matchId: "match-1",
            competition: "fixture-competition",
            season: "fixture-season",
            matchDate: "2026-09-21",
            ifabVersionId: "fixture-edition",
            verification: "VERIFIED"
        },
        segments: [
            {
                id: "s1",
                shotId: "shot-1",
                cameraId: null,
                startMs: 0,
                endMs: 1000,
                playbackSpeed: "NORMAL",
                replayState: "LIVE",
                matchClockMs: null
            }
        ],
        evidence: [
            {
                id: "e1",
                segmentId: "s1",
                kind: "CLIP",
                startMs: 0,
                endMs: 1000,
                contentSha256: "b".repeat(64)
            }
        ],
        actors: [1, 2].map((n) => ({
            id: `actor-${n}`,
            tracklets: [
                { segmentId: "s1", continuityId: `continuity-${n}`, trackId: `track-${n}` }
            ],
            teamId: `team-${n}`,
            teamAssignment: incidentAssertion(`actor-${n}.team`)
        })),
        links: [],
        actions: [
            {
                id: "action-1",
                type: "HOLDING_MOTION",
                actorId: "actor-1",
                targetActorId: "actor-2",
                segmentId: "s1",
                startMs: 0,
                endMs: 1000,
                context: {
                    actorIsPlayer: incidentAssertion("action-1.context.actorIsPlayer"),
                    targetIsPlayer: incidentAssertion("action-1.context.targetIsPlayer"),
                    opponents: incidentAssertion("action-1.context.opponents"),
                    ballInPlay: incidentAssertion("action-1.context.ballInPlay"),
                    onField: incidentAssertion("action-1.context.onField"),
                    insideOwnPenaltyArea: incidentAssertion(
                        "action-1.context.insideOwnPenaltyArea",
                        "REFUTED"
                    ),
                    stoppedForThisAction: incidentAssertion(
                        "action-1.context.stoppedForThisAction"
                    ),
                    advantageApplied: incidentAssertion(
                        "action-1.context.advantageApplied",
                        "REFUTED"
                    ),
                    otherActionInRestartSequence: incidentAssertion(
                        "action-1.context.otherActionInRestartSequence",
                        "REFUTED"
                    )
                },
                observations: {
                    actionObserved: incidentAssertion("action-1.observations.actionObserved"),
                    bodyOrEquipmentContact: incidentAssertion(
                        "action-1.observations.bodyOrEquipmentContact"
                    ),
                    gripMaintained: incidentAssertion(
                        "action-1.observations.gripMaintained",
                        "UNKNOWN"
                    ),
                    pulling: incidentAssertion("action-1.observations.pulling", "UNKNOWN"),
                    movementImpeded: incidentAssertion("action-1.observations.movementImpeded")
                },
                measurements: []
            }
        ],
        refereeDecisions: []
    };
}
