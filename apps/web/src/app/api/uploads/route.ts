// 업로드 의존성 조립
import { container } from "../../../bootstrap/container";
// 업로드 요청 경로 연결
import { upload } from "../../../apis/upload";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 업로드 요청 경로 진입점
export async function POST(request: Request): Promise<Response> {
    // 업로드 요청 경로 호출
    return upload(request, container());
}
