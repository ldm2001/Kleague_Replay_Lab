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
  fireEvent.click(screen.getByLabelText("밀기 유형으로 검토할 장면임을 확인"));
  fireEvent.click(screen.getByLabelText(/샷 1/));
  const values = reviewValues(judgment.facts);
  for (const field of reviewFields) fireEvent.change(screen.getByLabelText(field.label), { target: { value: values[field.name] } });
};
// 서버 JSON 응답 생성
const response = (kind: string, status = 200) => new Response(JSON.stringify({ kind, factRevisionId: revision }), { status });

describe("장면 사실 확인", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("확인 전 요청 없음", () => {
    // 자동 관찰을 확정 사실로 전송하지 않음
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<FactPanel analysisId="analysis" candidate={{ ...candidate(0), shots: [shot] }} onReview={vi.fn()} />);
    expect(screen.getByRole("button", { name: "사실 확인 후 규정 대조" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("사실과 샷 저장 후 규정 대조", async () => {
    // 명시적 제출은 PATCH 다음 POST 순서
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response("CREATED", 201)).mockResolvedValueOnce(response("CREATED", 201));
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<FactPanel analysisId="analysis" candidate={{ ...candidate(0), shots: [shot] }} onReview={refresh} />);
    selection();
    fireEvent.click(screen.getByRole("button", { name: "사실 확인 후 규정 대조" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls.map(([, options]) => options?.method)).toEqual(["PATCH", "POST"]);
    const payload = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(payload.expectedFactRevisionId).toBeNull();
    expect(payload.facts.push.contactDetected.shotIds).toEqual([shot.id]);
    // 화면에서 확인한 원심 재개 방식까지 저장
    expect(payload.facts.observed.restartType).toBe("DIRECT_FREE_KICK");
  });

  it("저장 실패 시 평가 차단과 멱등 재시도", async () => {
    // 모호한 네트워크 실패에도 동일 키로 재전송
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response("REPLAYED")).mockResolvedValueOnce(response("CREATED", 201));
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<FactPanel analysisId="analysis" candidate={{ ...candidate(0), shots: [shot] }} onReview={refresh} />);
    selection();
    const button = screen.getByRole("button", { name: "사실 확인 후 규정 대조" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).idempotencyKey)
      .toBe(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).idempotencyKey);
  });

  it("이전 사실을 유지한 평가 재시도", async () => {
    // DB JSON 키 순서가 달라도 이미 저장된 사실에는 새 Revision을 만들지 않음
    const source = structuredClone(judgment.facts);
    for (const value of [source.push.contactDetected, source.push.severity, source.push.opponentDisplacement, source.push.insidePenaltyArea]) value.shotIds = [shot.id];
    const saved = { observed: source.observed, variable: source.variable, push: {
      cameraSufficiency: source.push.cameraSufficiency, insidePenaltyArea: source.push.insidePenaltyArea,
      opponentDisplacement: source.push.opponentDisplacement, severity: source.push.severity,
      contactDetected: source.push.contactDetected,
    } };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response("CREATED", 201));
    render(<FactPanel analysisId="analysis" candidate={{ ...candidate(0), shots: [shot], facts: saved, factRevisionId: revision }} onReview={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByLabelText("밀기 유형으로 검토할 장면임을 확인"));
    fireEvent.click(screen.getByRole("button", { name: "사실 확인 후 규정 대조" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]?.[0]).toContain("/evaluate");
  });
});
