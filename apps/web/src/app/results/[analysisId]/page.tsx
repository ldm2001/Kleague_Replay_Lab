// 결과 페이지 조립
import { ResultView } from "../../../views/Result";

export default async function Page({ params, searchParams }: {
  params: Promise<{ analysisId: string }>;
  searchParams: Promise<{ low?: string | string[] }>;
}) {
  const { analysisId } = await params;
  const { low } = await searchParams;
  return <ResultView key={`${analysisId}:${low !== "0"}`} analysisId={analysisId} low={low !== "0"} />;
}
