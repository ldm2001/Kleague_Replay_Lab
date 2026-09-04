import { ResultPage } from "../../../views/Result";

export default async function Page({ params }: { params: Promise<{ analysisId: string }> }) {
  const { analysisId } = await params;
  return <ResultPage analysisId={analysisId} />;
}
