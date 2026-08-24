export type Hasher = Readonly<{
  /**
   * Computes SHA-256 over the UTF-8 encoding of `value`.
   *
   * Returned bytes are borrowed and may be reused by the implementation. A caller
   * that retains a digest must copy it before invoking the hasher again.
   */
  sha256: (value: string) => Promise<Uint8Array>;
}>;
