// 최근 영상 요청 경로 연결
import { recent } from "../../../../apis/status";
// 상태 의존성 조립
import { mediaStatus } from "../../../../bootstrap/status";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 최근 영상 요청
export async function GET(request: Request): Promise<Response> {
    // 최근 영상 요청 경로 호출
    return recent(request, mediaStatus());
}
