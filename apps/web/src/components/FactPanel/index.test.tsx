// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidate, judgment } from "../../../test/fixtures/result";
import { reviewFields, reviewValues } from "../../constant/review";
import { FactPanel } from "./index";

// 실제 샷 형식의 테스트 근거
const shot = { id: "44444444-4444-4444-8444-444444444444", index: 0, startMs: 0, endMs: 2000 };
// 저장 이력 식별자
const revision = "55555555-5555-4555-8555-555555555555";

// 사용자 확인 필드 선택
const selection = () => {
    // 화면의 밀기 유형으로 검토할 장면임을 확인 요소에 사용자 클릭 이벤트 전달
    fireEvent.click(screen.getByLabelText("밀기 유형으로 검토할 장면임을 확인"));
    // 화면의 샷 1 요소에 사용자 클릭 이벤트 전달
    fireEvent.click(screen.getByLabelText(/샷 1/));
    // 값목록 시험용 값목록 결과 준비
    const values = reviewValues(judgment.facts);
    // 항목목록의 각 사례 순회
    for (const field of reviewFields)
        // 화면 접근성표지조회 결과에 사용자 변경 이벤트 전달
        fireEvent.change(screen.getByLabelText(field.label), {
            target: { value: values[field.name] }
        });
};

// 서버 직렬화 자료 응답 생성
const response = (kind: string, status = 200) =>
    new Response(JSON.stringify({ kind, factRevisionId: revision }), { status });

describe("장면 사실 확인", () => {
    afterEach(() => {
        // 이전 시험에서 렌더링한 화면 정리
        cleanup();
        // 시험도구 모의동작복원 결과 처리 수행
        vi.restoreAllMocks();
    });

    it("확인 전 요청 없음", () => {
        // 자동 관찰을 확정 사실로 전송하지 않음
        const fetch = vi.spyOn(globalThis, "fetch");
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <FactPanel
                analysisId="analysis"
                candidate={{ ...candidate(0), shots: [shot] }}
                onReview={vi.fn()}
            />
        );
        // 화면의 사실 확인 후 규정 대조 요소의 비활성화 상태 확인
        expect(screen.getByRole("button", { name: "사실 확인 후 규정 대조" })).toBeDisabled();
        // 통신함수의 미호출 확인
        expect(fetch).not.toHaveBeenCalled();
    });

    it("사실과 샷 저장 후 규정 대조", async () => {
        // 명시적 제출은 수정 요청 다음 등록 요청 순서
        const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(response("CREATED", 201))
            .mockResolvedValueOnce(response("CREATED", 201));
        // 시험자료 시험용 시험도구 모의함수 결과 비동기응답설정 결과 준비
        const refresh = vi.fn().mockResolvedValue(undefined);
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <FactPanel
                analysisId="analysis"
                candidate={{ ...candidate(0), shots: [shot] }}
                onReview={refresh}
            />
        );
        // 규정 대조에 필요한 사실 선택 동작 수행
        selection();
        // 화면의 사실 확인 후 규정 대조 요소에 사용자 클릭 이벤트 전달
        fireEvent.click(screen.getByRole("button", { name: "사실 확인 후 규정 대조" }));
        // 조건대기 결과 처리 수행
        await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        // 통신함수 모의동작 호출기록 항목변환 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(fetch.mock.calls.map(([, options]) => options?.method)).toEqual(["PATCH", "POST"]);
        // 전송자료 시험용 응답본문 해석 결과 준비
        const payload = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
        // 전송자료 기대값 사실 개정번호 식별자의 빈 값 확인
        expect(payload.expectedFactRevisionId).toBeNull();
        // 전송자료 사실 추가 접촉감지여부 샷 식별자목록의 1개 항목 목록 기준 구조 일치 확인
        expect(payload.facts.push.contactDetected.shotIds).toEqual([shot.id]);
        // 화면에서 확인한 원심 재개 방식까지 저장
        expect(payload.facts.observed.restartType).toBe("DIRECT_FREE_KICK");
    });

    it("저장 실패 시 평가 차단과 멱등 재시도", async () => {
        // 모호한 네트워크 실패에도 동일 키로 재전송
        const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce(response("REPLAYED"))
            .mockResolvedValueOnce(response("CREATED", 201));
        // 시험자료 시험용 시험도구 모의함수 결과 비동기응답설정 결과 준비
        const refresh = vi.fn().mockResolvedValue(undefined);
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <FactPanel
                analysisId="analysis"
                candidate={{ ...candidate(0), shots: [shot] }}
                onReview={refresh}
            />
        );
        // 규정 대조에 필요한 사실 선택 동작 수행
        selection();
        // 버튼 시험용 화면의 사실 확인 후 규정 대조 요소 준비
        const button = screen.getByRole("button", { name: "사실 확인 후 규정 대조" });
        // 버튼에 사용자 클릭 이벤트 전달
        fireEvent.click(button);
        // 조건대기 결과 처리 수행
        await waitFor(() => expect(button).toBeEnabled());
        // 통신함수의 호출 횟수 1 확인
        expect(fetch).toHaveBeenCalledTimes(1);
        // 버튼에 사용자 클릭 이벤트 전달
        fireEvent.click(button);
        // 조건대기 결과 처리 수행
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
        // 응답본문 해석 결과 멱등성 키의 기대값 응답본문 해석 결과 멱등성 키 일치 확인
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).idempotencyKey).toBe(
            JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).idempotencyKey
        );
    });

    it("이전 사실을 유지한 평가 재시도", async () => {
        // 데이터베이스 직렬화 자료 키 순서가 달라도 이미 저장된 사실에는 새 개정 이력을 만들지 않음
        const source = structuredClone(judgment.facts);
        // 4개 항목 목록의 각 사례 순회
        for (const value of [
            source.push.contactDetected,
            source.push.severity,
            source.push.opponentDisplacement,
            source.push.insidePenaltyArea
        ])
            // 값 샷 식별자목록을 1개 항목 목록 값으로 설정
            value.shotIds = [shot.id];
        // 저장결과 시험 입력으로 관측결과 및 변수 및 추가 자료 생성
        const saved = {
            observed: source.observed,
            variable: source.variable,
            push: {
                cameraSufficiency: source.push.cameraSufficiency,
                insidePenaltyArea: source.push.insidePenaltyArea,
                opponentDisplacement: source.push.opponentDisplacement,
                severity: source.push.severity,
                contactDetected: source.push.contactDetected
            }
        };
        // 통신함수 시험용 시험도구 호출감시 결과 비동기응답설정 결과 준비
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response("CREATED", 201));
        // 현재 시험자료로 화면 컴포넌트 렌더링
        render(
            <FactPanel
                analysisId="analysis"
                candidate={{
                    ...candidate(0),
                    shots: [shot],
                    facts: saved,
                    factRevisionId: revision
                }}
                onReview={vi.fn().mockResolvedValue(undefined)}
            />
        );
        // 화면의 밀기 유형으로 검토할 장면임을 확인 요소에 사용자 클릭 이벤트 전달
        fireEvent.click(screen.getByLabelText("밀기 유형으로 검토할 장면임을 확인"));
        // 화면의 사실 확인 후 규정 대조 요소에 사용자 클릭 이벤트 전달
        fireEvent.click(screen.getByRole("button", { name: "사실 확인 후 규정 대조" }));
        // 조건대기 결과 처리 수행
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        // 통신함수 모의동작 호출기록 중 선택 항목 중 선택 항목의 평가 포함 확인
        expect(fetch.mock.calls[0]?.[0]).toContain("/evaluate");
    });
});
