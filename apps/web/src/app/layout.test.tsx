// @vitest-environment jsdom
import * as React from "react";
import { describe, expect, it } from "vitest";
import Layout from "./layout.js";

describe("root layout", () => {
  it("provides the html and body boundaries required by Next.js", () => {
    const tree = Layout({ children: <main>content</main> });
    const children = React.Children.toArray(tree.props.children);

    expect(tree.type).toBe("html");
    expect(children[0]).toMatchObject({ type: "body" });
  });
});
