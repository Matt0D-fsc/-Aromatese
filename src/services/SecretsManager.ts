import crypto from 'crypto';

export interface TenantSecretPayload {
  metaAppSecret?: string;
  metaVerifyToken?: string;
  metaAccessToken?: string;
  bkashAppKey?: string;
  bkashAppSecret?: string;
  nagadMerchantId?: string;
  pathaoClientId?: string;
  pathaoClientSecret?: string;
  customKeys?: Record<string, string>;
}

export class SecretsManager {
  private masterKey: string;

  constructor(masterKey?: string) {
    // Falls back to a deterministic key for dev/test if env is not set
    this.masterKey = masterKey || process.env.ENCRYPTION_MASTER_KEY || 'default-mattic-dev-master-key-32b';
  }

  /**
   * Encrypts plain secrets object to AES-256-GCM cipher string.
   */
  public encrypt(secrets: TenantSecretPayload): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.masterKey, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const jsonText = JSON.stringify(secrets);
    let encrypted = cipher.update(jsonText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({
      iv: iv.toString('hex'),
      encryptedData: encrypted,
      authTag,
    });
  }

  /**
   * Decrypts AES-256-GCM cipher string back to TenantSecretPayload object.
   */
  public decrypt(cipherPayloadString: string): TenantSecretPayload {
    try {
      const payload = JSON.parse(cipherPayloadString);
      const iv = Buffer.from(payload.iv, 'hex');
      const authTag = Buffer.from(payload.authTag, 'hex');
      const key = crypto.scryptSync(this.masterKey, 'salt', 32);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (err) {
      throw new Error(`Failed to decrypt tenant secrets: ${(err as Error).message}`);
    }
  }
}
