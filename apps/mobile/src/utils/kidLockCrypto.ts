import * as Crypto from 'expo-crypto';

/** 移动端 PIN 哈希：SHA-256(盐:密码)，与桌面端 Web Crypto 格式一致（十六进制小写）。 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`).then(
    (hex) => hex.toLowerCase(),
  );
}

export async function randomSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}