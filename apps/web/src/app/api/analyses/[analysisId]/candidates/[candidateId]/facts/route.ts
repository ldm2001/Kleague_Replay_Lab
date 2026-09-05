// 사실 API 연결
import { facts } from "../../../../../../../apis/candidate";
// 평가 의존성 조립
import { evaluation } from "../../../../../../../bootstrap/evaluation";

export const runtime = "nodejs";

// 사실 수정 요청
export async function PATCH(
  request: Request,
  context: { params: Promise<{ analysisId: string; candidateId: string }> },
): Promise<Response> {
  // 분석과 후보 식별자 해석
  const params = await context.params;
  // 사실 수정 API 호출
  return facts(request, params, evaluation());
}
