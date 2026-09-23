// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import Layout from "./layout.js";

describe("root layout", () => {
    it("provides the html and body boundaries required by Next.js", () => {
        // 시험자료 시험용 시험자료 결과 준비
        const tree = Layout({ children: <main>content</main> });
        // 시험자료 시험용 시험자료 배열 결과 준비
        const children = React.Children.toArray(tree.props.children);

        // 시험자료 유형의 기대값 지정 문자열 일치 확인
        expect(tree.type).toBe("html");
        // 배열 반환값 중 선택 항목의 유형 본문 자료의 필드 일치 확인
        expect(children[0]).toMatchObject({ type: "body" });
    });
});
