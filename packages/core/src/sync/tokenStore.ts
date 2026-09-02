import type { OAuthTokens } from '../types';

/**
 * 同步令牌存储抽象（II-1）：令牌只进平台安全区（桌面 keychain / 移动 secure-store）。
 * 接口由两端注入实现，内核不感知具体安全区。
 */
export interface TokenStore {
  get(): Promise<OAuthTokens | null>;
  set(tokens: OAuthTokens): Promise<void>;
  clear(): Promise<void>;
}