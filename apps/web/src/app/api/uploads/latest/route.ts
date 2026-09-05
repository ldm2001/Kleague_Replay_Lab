// 최근 영상 API 연결
import { recent } from "../../../../apis/status";
// 상태 의존성 조립
import { mediaStatus } from "../../../../bootstrap/status";

export const runtime = "nodejs";

// 최근 영상 요청
export async function GET(request: Request): Promise<Response> {
  // 최근 영상 API 호출
  return recent(request, mediaStatus());
}
