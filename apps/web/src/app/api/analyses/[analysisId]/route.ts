// 분석 결과 API 연결
// 결과 API 연결
import { analysis } from "../../../../apis/result";
// 결과 의존성 조립
import { resultView } from "../../../../bootstrap/result";

export const runtime = "nodejs";

// 분석 결과 요청
export async function GET(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
): Promise<Response> {
  // 분석 식별자 해석
  const params = await context.params;
  // 분석 결과 API 호출
  return analysis(request, params, resultView());
}
