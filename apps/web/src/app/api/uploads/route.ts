// 업로드 의존성 조립
import { container } from "../../../bootstrap/container";
// 업로드 API 연결
import { upload } from "../../../apis/upload";

export const runtime = "nodejs";

// 업로드 API 진입점
export async function POST(request: Request): Promise<Response> {
  return upload(request, container());
}
