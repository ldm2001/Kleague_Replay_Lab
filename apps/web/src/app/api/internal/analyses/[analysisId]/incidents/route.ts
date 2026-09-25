import { incidents } from "../../../../../../apis/incidents";
import { incidentDependencies } from "../../../../../../bootstrap/incidents";

export const runtime = "nodejs";

// 내부 인증과 소유 범위를 요구하는 비공개 사건 조회 연결
export async function GET(request: Request, context: { params: Promise<{ analysisId: string }> }) {
    const { analysisId } = await context.params;
    return incidents(request, analysisId, incidentDependencies());
}
