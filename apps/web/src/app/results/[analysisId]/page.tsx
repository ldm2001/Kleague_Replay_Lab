// 결과 페이지 조립
import { ResultView } from "../../../views/Result";

export default async function Page({ params, searchParams }: {
  params: Promise<{ analysisId: string }>;
  searchParams: Promise<{ low?: string | string[] }>;
}) {
  // 분석 식별자와 표시 조건 해석
  const { analysisId } = await params;
  const { low } = await searchParams;
  // 결과 화면 출력
  return <ResultView key={`${analysisId}:${low !== "0"}`} analysisId={analysisId} low={low !== "0"} />;
}
