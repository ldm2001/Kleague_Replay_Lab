import { jobs } from "../../../../../bootstrap/jobs";
import { claim } from "../../../../../apis/job";

export const runtime = "nodejs";

// 작업 선점 API 진입점
export async function POST(request: Request): Promise<Response> {
  return claim(request, jobs());
}
