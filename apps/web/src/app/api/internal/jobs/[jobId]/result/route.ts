// 작업 결과 API 연결
import { result } from "../../../../../../apis/job";
// 작업 의존성 조립
import { jobs } from "../../../../../../bootstrap/jobs";

export const runtime = "nodejs";

// 작업 결과 요청
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return result(request, await context.params, jobs());
}
