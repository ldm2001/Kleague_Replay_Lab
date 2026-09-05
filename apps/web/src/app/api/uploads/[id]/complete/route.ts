// 업로드 완료 API 연결
import { completion } from "../../../../../apis/upload";
// 업로드 의존성 조립
import { container } from "../../../../../bootstrap/container";

export const runtime = "nodejs";

// 업로드 완료 요청
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // 업로드 의도 식별자 해석
  const { id } = await context.params;
  // 업로드 완료 API 호출
  return completion(request, { intentId: id }, container());
}
