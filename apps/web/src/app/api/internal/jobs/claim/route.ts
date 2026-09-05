// 작업 의존성 조립
import { jobs } from "../../../../../bootstrap/jobs";
// 작업 선점 API 연결
import { claim } from "../../../../../apis/job";

export const runtime = "nodejs";

// 작업 선점 API 진입점
// 작업 선점 요청
export async function POST(request: Request): Promise<Response> {
  return claim(request, jobs());
}
