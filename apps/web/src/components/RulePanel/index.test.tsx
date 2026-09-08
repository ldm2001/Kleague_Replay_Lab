// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analysis, candidate, judgment } from "../../../test/fixtures/result";
import { RulePanel } from "./index";

describe("RulePanel", () => {
  afterEach(() => {
    // 테스트 DOM 정리
    cleanup();
  });

  it("shows a pending state without inventing a decision", () => {
    // 사실 대기 후보 렌더링
    render(<RulePanel analysis={analysis()} candidate={candidate(0)} />);
    expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
    expect(screen.queryByText(/확인하면/)).not.toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
  });

  it("separates facts IFAB K League and VAR evidence", () => {
    // 판정이 있는 후보 렌더링
    render(<RulePanel analysis={analysis()} candidate={candidate(1, judgment)} />);
    expect(screen.getByRole("region", { name: "확인된 사실" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "IFAB 규정" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "K리그 대회요강" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "VAR 검토" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "관측 판정 비교" })).toHaveTextContent("재개와 카드 비교");
  });

  it("displays the server filter instead of legacy model or user judgments", () => {
    render(<RulePanel analysis={analysis()} candidate={{ ...candidate(1, judgment), filter: {
      filterVersion: "pipeline-rules-v1", status: "UNDETERMINED",
      reasonCodes: ["RULE_CONTEXT_UNVERIFIED", "CONTACT_UNOBSERVED"],
      missingFields: ["contact"], ruleReferences: [], evidenceIds: [],
    } }} />);
    expect(screen.getByText("규정 판단 근거 부족")).toBeInTheDocument();
    expect(screen.getByText("경기와 적용 규정 판본이 확인되지 않았습니다")).toBeInTheDocument();
    expect(screen.queryByText("파울 가능성 있음")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("긴 인용을 접어서 핵심 조항을 먼저 표시", () => {
    // 핵심 세 건 이후 인용은 펼쳐보기로 제공
    const citations = Array.from({ length: 6 }, (_, index) => ({ ...judgment.citations[0]!, ruleId: `ifab-${index}`, section: String(index + 1) }));
    const { container } = render(<RulePanel analysis={analysis()} candidate={candidate(1, { ...judgment, citations })} />);
    expect(screen.getByText("추가 조항 3개")).toBeInTheDocument();
    expect(container.querySelector(".citation-more")).not.toHaveAttribute("open");
    expect(container.querySelector("section[aria-label='IFAB 규정'] > .citation-list")?.children).toHaveLength(3);
  });
});
