// 영상 상태 요청 경로 연결
import { media } from "../../../../apis/status";
// 상태 의존성 조립
import { mediaStatus } from "../../../../bootstrap/status";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 영상 상태 요청
export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
): Promise<Response> {
    // 영상 식별자 해석
    const { id } = await context.params;
    // 영상 상태 요청 경로 호출
    return media(request, { videoAssetId: id }, mediaStatus());
}
