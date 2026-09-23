// 작업 의존성 조립
import { jobs } from "../../../../../bootstrap/jobs";
// 작업 선점 요청 경로 연결
import { claim } from "../../../../../apis/job";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 작업 선점 요청 경로 진입점
// 작업 선점 요청
export async function POST(request: Request): Promise<Response> {
    // 작업 선점 요청 경로 호출
    return claim(request, jobs());
}
