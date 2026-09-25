import { describe, expect, it } from "vitest";
import { incidentFixture } from "../fixtures/incident";
import { incidentAdmission, incidentEvaluation } from "../../src/application/use-cases/incidents/admission";

// 시험용 사실 생산 방법은 운영 승인 목록과 분리
const method = {
    id: "fixture-observer", version: "1", validationReportSha256: "c".repeat(64),
    factKeys: ["context.actorIsPlayer", "context.targetIsPlayer", "context.opponents", "context.ballInPlay",
        "observations.actionObserved", "observations.bodyOrEquipmentContact", "observations.movementImpeded"]
};

describe("incident fact admission", () => {
    it("keeps the operating registry closed even for claimed confirmed facts", () => {
        const record = incidentFixture();
        const result = incidentAdmission(record, new Map([["e1", "b".repeat(64)]]));
        expect(result.factIds.size).toBe(0);
    });

    it("admits only specific fact keys with matching methods and real evidence", () => {
        const record = incidentFixture();
        const result = incidentAdmission(record, new Map([["e1", "b".repeat(64)]]), [method]);
        expect(result.factIds.size).toBe(7);
        expect(result.factIds.has("action-1.context.onField")).toBe(false);
        expect(result.factIds.has("action-1.observations.gripMaintained")).toBe(false);
        expect(incidentAdmission(record, new Map(), [method]).factIds.size).toBe(0);
        expect(incidentAdmission(record, new Map([["e1", "d".repeat(64)]]), [method]).factIds.size).toBe(0);
    });

    it("binds approval to record content and refuses unverified report identifiers", () => {
        const record = incidentFixture();
        const evidence = new Map([["e1", "b".repeat(64)]]);
        const first = incidentAdmission(record, evidence, [method]);
        record.actions[0]!.context.ballInPlay.state = "REFUTED";
        expect(incidentAdmission(record, evidence, [method]).recordSha256).not.toBe(first.recordSha256);
        expect(incidentAdmission(record, evidence, [{ ...method, validationReportSha256: "" }]).factIds.size).toBe(0);
    });

    it("supports partial conclusions without exposing unapproved or unsupported questions", () => {
        const record = incidentFixture();
        record.match.ifabVersionId = "ifab-2025-26";
        const evidence = new Map([["e1", "b".repeat(64)]]);
        const closed = incidentEvaluation(record, evidence);
        expect(closed.evaluations[0]!.conclusions.offence.status).toBe("UNDETERMINED");
        expect(closed.publicResults).toEqual([]);
        const verified = incidentEvaluation(record, evidence, [method]);
        expect(verified.evaluations[0]!.conclusions.offence.value).toBe("HOLDING_OFFENCE");
        expect(verified.evaluations[0]!.conclusions.restart.status).toBe("UNDETERMINED");
        expect(verified.evaluations[0]!.conclusions.disciplinary.status).toBe("UNSUPPORTED");
        expect(verified.publicResults).toHaveLength(1);
        expect(JSON.stringify(verified.publicResults)).not.toContain("factDiagnostics");
    });
});
