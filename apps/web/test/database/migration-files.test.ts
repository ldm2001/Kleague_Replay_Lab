// 마이그레이션 파일 테스트
import { describe, expect, it } from "vitest";
import { migrations } from "../../../../scripts/database/migrations.mjs";

describe("migration discovery", () => {
    it("loads every SQL migration in filename order with a checksum", async () => {
        // 시험자료 결과를 목록에 저장
        const list = await migrations();

        // 목록 항목변환 결과의 21개 항목 목록 기준 구조 일치 확인
        expect(list.map((migration) => migration.name)).toEqual([
            "0000_initial_schema",
            "0001_ttl_expiry_policy",
            "0002_append_only_records",
            "0003_upload_intents",
            "0004_upload_intent_policy",
            "0005_analysis_status",
            "0006_job_progress",
            "0007_analysis_output",
            "0008_candidate_output",
            "0009_candidate_ready",
            "0010_baseline_state",
            "0011_competition_context",
            "0012_kleague_rule_scope",
            "0013_observations",
            "0014_candidate_tracking",
            "0015_candidate_scene_event",
            "0016_broadcast_cue",
            "0017_analysis_perception_runs",
            "0018_perception_audio",
            "0019_judgment_contract",
            "0020_automatic_reviews"
        ]);
        // 목록 중 선택 항목 체크섬의 지정 패턴 일치 확인
        expect(list[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
        // 목록 중 선택 항목 질의의 분석목록 포함 확인
        expect(list[0]?.sql).toContain("CREATE TABLE analyses");
        // 상태 시험용 목록 조회 결과 준비
        const status = list.find((migration) => migration.name === "0005_analysis_status");
        // 상태 질의의 분석목록 상태 포함 확인
        expect(status?.sql).toContain("analyses_status_check");
        // 상태 질의의 규정목록 포함 확인
        expect(status?.sql).toContain("APPLYING_RULES");
        // 출력 시험용 목록 조회 결과 준비
        const output = list.find((migration) => migration.name === "0007_analysis_output");
        // 출력 질의의 한계목록 포함 확인
        expect(output?.sql).toContain("limitations");
        // 후보 시험용 목록 조회 결과 준비
        const candidate = list.find((migration) => migration.name === "0008_candidate_output");
        // 후보 질의의 시각 포함 확인
        expect(candidate?.sql).toContain("anchor_ms");
        // 맥락 시험용 목록 조회 결과 준비
        const context = list.find((migration) => migration.name === "0011_competition_context");
        // 맥락 질의의 대회 규정 포함 확인
        expect(context?.sql).toContain("competition_rule_versions");
        // 맥락 질의의 지정 문자열 포함 확인
        expect(context?.sql).toContain("K리그1");
        // 적용범위 시험용 목록 조회 결과 준비
        const scope = list.find((migration) => migration.name === "0012_kleague_rule_scope");
        // 적용범위 질의의 지정 문자열 포함 확인
        expect(scope?.sql).toContain("KLEAGUE");
        // 방송 시험용 목록 조회 결과 준비
        const broadcast = list.find((migration) => migration.name === "0016_broadcast_cue");
        // 방송 질의의 방송 단서 포함 확인
        expect(broadcast?.sql).toContain("broadcast_cue jsonb");
        // 인식 시험용 목록 조회 결과 준비
        const perception = list.find(
            (migration) => migration.name === "0017_analysis_perception_runs"
        );
        // 인식 질의의 분석 인식 포함 확인
        expect(perception?.sql).toContain("CREATE TABLE analysis_perception_runs");
        // 인식 질의의 지정 문자열 포함 확인
        expect(perception?.sql).toContain("ON DELETE CASCADE");
        // 인식 질의의 작업 식별자 작업 개정번호 포함 확인
        expect(perception?.sql).toContain("UNIQUE (job_id, job_revision)");
        // 인식 질의의 길이 원본 해시 32 포함 확인
        expect(perception?.sql).toContain("octet_length(source_sha256) = 32");
        // 인식 질의의 산출물 크기 바이트 0 포함 확인
        expect(perception?.sql).toContain("artifact_size_bytes > 0");
        // 인식 질의의 산출물 크기 바이트 134217728 포함 확인
        expect(perception?.sql).toContain("artifact_size_bytes <= 134217728");
        // 인식 질의의 요약 객체 포함 확인
        expect(perception?.sql).toContain("jsonb_typeof(summary) = 'object'");
        // 인식 질의의 길이 요약 문구 1048576 포함 확인
        expect(perception?.sql).toContain("octet_length(summary::text) <= 1048576");
        // 인식 질의의 작업 개정번호 0 포함 확인
        expect(perception?.sql).toContain("job_revision > 0");
        // 인식 질의의 산출물 객체 키 포함 확인
        expect(perception?.sql).toContain("artifact_object_key =");
        // 인식 질의의 요약 사건목록 포함 확인
        expect(perception?.sql).toContain("jsonb_typeof(summary->'incidents') = 'array'");
        // 인식 질의의 요약 수용결과 객체 포함 확인
        expect(perception?.sql).toContain("jsonb_typeof(summary->'admission') = 'object'");
        // 음향 시험용 목록 조회 결과 준비
        const audio = list.find((migration) => migration.name === "0018_perception_audio");
        // 음향 질의의 분석 인식 스키마 버전 포함 확인
        expect(audio?.sql).toContain(
            "DROP CONSTRAINT analysis_perception_runs_schema_version_check"
        );
        // 음향 질의의 분석 인식 버전 포함 확인
        expect(audio?.sql).toContain("analysis_perception_runs_version_pair_check");
        // 음향 질의의 요약 음향 객체 포함 확인
        expect(audio?.sql).toContain("jsonb_typeof(summary->'audio') = 'object'");
    });
});
