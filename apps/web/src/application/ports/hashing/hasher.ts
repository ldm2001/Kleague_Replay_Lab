export type Hasher = Readonly<{
  // UTF-8 문자열의 SHA-256 바이트
  sha256: (value: string) => Promise<Uint8Array>;
}>;
