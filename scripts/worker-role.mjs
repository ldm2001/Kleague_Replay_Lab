import { tmpdir } from "node:os";
import { join } from "node:path";

// 공통 환경과 독립된 역할별 실행 환경 반환
export function role(env, name) {
    // 인자 없는 기존 실행 환경 보존
    if (name === undefined) return { ...env };
    // 실행 전에 허용되지 않은 역할 거부
    if (name !== "validate" && name !== "analyze") {
        throw new Error("WORKER_ROLE-invalid");
    }
    // 역할별 전용 설정 접두어 계산
    const prefix = `WORKER_${name.toUpperCase()}`;
    // 공통 식별자와 임시 경로를 전용 값으로 덮어쓴 환경 반환
    return {
        ...env,
        WORKER_JOB_TYPE: name === "validate" ? "VALIDATE_VIDEO" : "ANALYZE_VIDEO",
        WORKER_ID: env[`${prefix}_ID`]?.trim() || `video-worker-${name}-1`,
        WORKER_TEMP_DIR: env[`${prefix}_TEMP_DIR`]?.trim()
            || join(tmpdir(), `replay-lab-worker-${name}`)
    };
}
