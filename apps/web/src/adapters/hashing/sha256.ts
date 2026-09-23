// 비밀 토큰과 파일 해시의 암호 기능 가져옴
import { createHash as digest } from "node:crypto";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type { Hasher } from "@replay/application";

// 서버 보안 해시 어댑터
export class Sha256 implements Hasher {
    // 입력 바이트의 보안 해시 계산
    public async sha256(value: string): Promise<Uint8Array> {
        // 보안 해시 계산
        return Uint8Array.from(digest("sha256").update(value, "utf8").digest());
    }
}

// 해시 어댑터 생성
export const hash = (): Hasher => new Sha256();
