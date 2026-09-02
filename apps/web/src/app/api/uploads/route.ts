import { container } from "../../../bootstrap/container";
import { upload } from "../../../apis/upload";

export const runtime = "nodejs";

// 업로드 API 진입점
export async function POST(request: Request): Promise<Response> {
  return upload(request, container());
}
