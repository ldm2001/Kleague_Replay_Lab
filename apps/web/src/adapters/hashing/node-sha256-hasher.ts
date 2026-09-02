import { createHash as digest } from "node:crypto";
import type { Hasher } from "@replay/application";

// Node SHA-256 어댑터
export class Sha256Hasher implements Hasher {
  public async sha256(value: string): Promise<Uint8Array> {
    // SHA-256 계산
    return Uint8Array.from(digest("sha256").update(value, "utf8").digest());
  }
}

// 해시 어댑터 생성
export const hash = (): Hasher => new Sha256Hasher();
