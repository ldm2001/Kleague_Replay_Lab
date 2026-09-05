// 증거 API 연결
import { evidence } from "../../../../../../apis/evidence";
// 증거 의존성 조립
import { mediaEvidence } from "../../../../../../bootstrap/evidence";

export const runtime = "nodejs";

// 증거 조회 요청
export async function GET(
  request: Request,
  context: { params: Promise<{ analysisId: string; evidenceId: string }> },
): Promise<Response> {
  return evidence(request, await context.params, mediaEvidence());
}
