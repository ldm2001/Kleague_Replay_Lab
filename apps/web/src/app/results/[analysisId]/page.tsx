// 결과 페이지 조립
import { ResultView } from "../../../views/Result";

// 페이지 구성
export default async function Page({ params }: {
    // 주소 경로에서 전달받는 식별자 묶음
    params: Promise<{ analysisId: string }>;
}) {
    // 분석 식별자와 표시 조건 해석
    const { analysisId } = await params;
    // 결과 화면 출력
    return <ResultView key={analysisId} analysisId={analysisId} />;
}
