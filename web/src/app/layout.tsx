import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "K리그 판정 보조",
  description: "영상 근거와 규정 대조를 제공하는 판정 보조 시스템",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
