export interface ParsedBDAddress {
  isValidPhone: boolean;
  phoneNormalized?: string;
  isInsideDhaka: boolean;
  courierFeeBdt: number;
  district?: string;
  thana?: string;
  rawAddressText: string;
}

export class AddressParserBD {
  /**
   * Validate Bangladeshi 11-digit mobile number (013 - 019 prefix).
   */
  public static validateBDPhone(phoneRaw: string): { isValid: boolean; normalized?: string } {
    if (!phoneRaw) return { isValid: false };

    // Strip spaces, dashes, country code +88
    let cleaned = phoneRaw.replace(/[\s\-\+]/g, '');
    if (cleaned.startsWith('880')) {
      cleaned = cleaned.substring(2);
    }

    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    const isValid = bdPhoneRegex.test(cleaned);

    return {
      isValid,
      normalized: isValid ? cleaned : undefined,
    };
  }

  /**
   * Parse Bangladeshi raw address into structured courier payload and calculate tiered delivery fee.
   */
  public static parseAddress(addressRaw: string, phoneRaw: string): ParsedBDAddress {
    const phoneInfo = this.validateBDPhone(phoneRaw);
    const text = (addressRaw || '').toLowerCase();

    // Check Inside Dhaka vs Outside Dhaka
    const isInsideDhaka =
      text.includes('dhaka') ||
      text.includes('mirpur') ||
      text.includes('gulshan') ||
      text.includes('banani') ||
      text.includes('dhanmondi') ||
      text.includes('uttara') ||
      text.includes('mohammadpur') ||
      text.includes('badda') ||
      text.includes('motijheel');

    // Courier rates: Inside Dhaka = 70 BDT, Outside Dhaka = 130 BDT
    const courierFeeBdt = isInsideDhaka ? 70 : 130;

    return {
      isValidPhone: phoneInfo.isValid,
      phoneNormalized: phoneInfo.normalized,
      isInsideDhaka,
      courierFeeBdt,
      rawAddressText: addressRaw,
    };
  }
}
