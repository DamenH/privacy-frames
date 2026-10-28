/** Supply hashing without exposing the native Crypto or SubtleCrypto objects. */
export function preparationCrypto(nativeCrypto: {
  subtle: Pick<SubtleCrypto, 'digest'>;
}) {
  const subtle = nativeCrypto.subtle;
  const digest = subtle.digest;
  const apply = Reflect.apply;
  return {
    subtle: {
      digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        return apply(digest, subtle, [algorithm, data]);
      },
    },
  };
}
