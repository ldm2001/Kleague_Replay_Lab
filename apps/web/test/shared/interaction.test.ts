import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { python } from "../../../../scripts/python.mjs";
import { describe, expect, it } from "vitest";
import { interactionData, incidentLineage } from "../../src/shared/interaction";
import { incidentFixture } from "../fixtures/incident";

// 검증용 입력 모형 구성
const fixture = () =>
    JSON.parse(
        execFileSync(
            python(),
            [
                "-c",
                `
import json
from fixtures.interaction import frame
from replay_video.domain.interactions import InteractionObservations
engine = InteractionObservations('a'*64)
engine.update(frame(), 's1')
row = engine.update(frame(1000), 's1')[0]
row['upstream'] = {'artifactSha256':'b'*64,'lineNumber':3,'rowSha256':'c'*64}
print(json.dumps(row))
`
            ],
            {
                env: {
                    ...process.env,
                    PYTHONPATH: ["apps/video-worker/src", "apps/video-worker/tests"]
                        .map((path) => resolve(path)).join(delimiter)
                },
                encoding: "utf8"
            }
        )
    );

// 가설 형식 확인
const hypothesis = (value: string) => ({
    state: "HYPOTHESIS",
    value,
    reasons: ["METHOD_UNVALIDATED"],
    method: { id: "fixture-only", version: "1" },
    observationIds: [] as string[]
});

describe("private interaction observations", () => {
    it("accepts actual Python producer output without admitting contact", () => {
        // 행 시험용 시험자료 결과 준비
        const row = fixture();
        // 자료 결과의 기대값 참 일치 확인
        expect(interactionData(row)).toBe(true);
        // 행 상태의 기대값 지정 문자열 일치 확인
        expect(row.measurements.centerDistance.state).toBe("MEASURED");
        // 행 접촉 값의 빈 값 확인
        expect(row.contact.value).toBeNull();
    });
    it.each(["actionType", "direction"])("preserves independent %s hypotheses", (key) => {
        // 행 시험용 시험자료 결과 준비
        const row = fixture();
        // 행 중 선택 항목을 기존 항목 및 관측 식별자목록 자료로 설정
        row[key] = {
            ...hypothesis(key === "actionType" ? "HOLDING_MOTION" : "A_TO_B"),
            observationIds: [row.observationId]
        };
        // 자료 결과의 기대값 참 일치 확인
        expect(interactionData(row)).toBe(true);
        // 결과가 알 수 없음 상태로 유지됨 확인
        expect(row[key === "actionType" ? "direction" : "actionType"].state).toBe("UNKNOWN");
    });
    it.each(["order", "measurement", "contact", "hypothesis", "time", "pts", "frame"])(
        "rejects invalid %s",
        (kind) => {
            // 행 시험용 시험자료 결과 준비
            const row = fixture();
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "order")
                // 2개 항목 목록을 2개 항목 목록 값으로 설정
                [row.participantA, row.participantB] = [row.participantB, row.participantA];
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "measurement") row.measurements.centerDistance.value = NaN;
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "contact") row.contact = { state: "CONFIRMED", value: true, reasons: [] };
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "hypothesis") row.direction = hypothesis("A_TO_B");
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "time") row.measurements.centerDistance.startMs = row.endMs + 1;
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "pts") row.frame.pts += 50;
            // 종류 비교 조건에 따른 처리 경로 분기
            if (kind === "frame") delete row.frame.timeBase;
            // 자료 결과의 기대값 거짓 일치 확인
            expect(interactionData(row)).toBe(false);
        }
    );
    it("does not create a typed record when type or direction is unknown", () => {
        // 사건 결과의 빈 값 확인
        expect(incidentLineage(fixture(), incidentFixture(), "action-1")).toBeNull();
    });
    it("links matching type and direction without mutating either record", () => {
        // 행 및 사건 입력 준비
        const row = fixture(),
            record = incidentFixture();
        // 행 동작 유형을 기존 항목 및 관측 식별자목록 자료로 설정
        row.actionType = { ...hypothesis("HOLDING_MOTION"), observationIds: [row.observationId] };
        // 행을 기존 항목 및 관측 식별자목록 자료로 설정
        row.direction = { ...hypothesis("A_TO_B"), observationIds: [row.observationId] };
        // 기록 동작목록 중 선택 항목 시작시각을 1000 값으로 설정
        record.actions[0]!.startMs = 1000;
        // 기록 행위자목록 중 선택 항목을 1개 항목 목록 값으로 설정
        record.actors[0]!.tracklets = [{ segmentId: "s1", continuityId: "0", trackId: "t1" }];
        // 기록 행위자목록 중 선택 항목을 1개 항목 목록 값으로 설정
        record.actors[1]!.tracklets = [{ segmentId: "s1", continuityId: "0", trackId: "t2" }];
        // 시험자료 시험용 응답본문 직렬화 결과 준비
        const before = JSON.stringify([row, record]);
        // 사건 결과의 후보 식별자 및 사건 식별자 및 동작 식별자 동작 1 자료의 필드 일치 확인
        expect(incidentLineage(row, record, "action-1")).toMatchObject({
            candidateId: row.candidateId,
            incidentId: record.incidentId,
            actionId: "action-1"
        });
        // 응답본문 직렬화 결과의 기대값 응답본문 직렬화 반환값 일치 확인
        expect(JSON.stringify([row, record])).toBe(before);
        // 기록 원본 해시를 지정 문자열 반복문자열 결과 값으로 설정
        record.sourceSha256 = "d".repeat(64);
        // 사건 결과의 빈 값 확인
        expect(incidentLineage(row, record, "action-1")).toBeNull();
    });
});
