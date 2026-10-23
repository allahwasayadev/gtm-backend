import {
  canonicalizePhoneNumber,
  canonicalizeUsPhoneNumber,
  isUsE164,
  stripPhoneSeparators,
  toUsNationalDigits,
  US_COUNTRY_CODE,
} from './phone.util';

/**
 * US entry is the default path, so every spelling a user might type for one
 * number has to land on one canonical string. Deduplication, the uniqueness
 * check at signup and reset-by-phone all depend on that.
 */
describe('phone.util', () => {
  describe('toUsNationalDigits', () => {
    it.each([
      ['2015550123', '2015550123'],
      ['(201) 555-0123', '2015550123'],
      ['201 555 0123', '2015550123'],
      ['201.555.0123', '2015550123'],
      ['201-555-0123', '2015550123'],
      // An en dash, which a phone keyboard or a paste from a web page can produce.
      ['201–555–0123', '2015550123'],
      ['  2015550123  ', '2015550123'],
      // Eleven digits: the user typed the country code without a '+'.
      ['12015550123', '2015550123'],
      ['1 (201) 555-0123', '2015550123'],
      ['+12015550123', '2015550123'],
      ['+1 201 555 0123', '2015550123'],
    ])('reads %s as %s', (input, expected) => {
      expect(toUsNationalDigits(input)).toBe(expected);
    });

    it.each([
      [''],
      ['   '],
      ['201555012'], // nine digits
      ['20155501234'], // eleven digits not starting with the country code
      ['abcdefghij'],
      ['+442015550123'], // a '+' commits to a country code, and it is not ours
      ['+442015550123456'],
      ['2015550123x12'],
    ])('refuses %s', (input) => {
      expect(toUsNationalDigits(input)).toBeNull();
    });
  });

  describe('canonicalizeUsPhoneNumber', () => {
    it('produces canonical E.164', () => {
      expect(canonicalizeUsPhoneNumber('(201) 555-0123')).toBe('+12015550123');
    });

    it('is idempotent', () => {
      const once = canonicalizeUsPhoneNumber('2015550123')!;
      expect(canonicalizeUsPhoneNumber(once)).toBe(once);
    });

    it('collapses every spelling of one number to one string', () => {
      const spellings = [
        '2015550123',
        '(201) 555-0123',
        '201-555-0123',
        '1 201 555 0123',
        '+1 (201) 555-0123',
      ];
      const canonical = new Set(spellings.map(canonicalizeUsPhoneNumber));
      expect([...canonical]).toEqual(['+12015550123']);
    });
  });

  describe('canonicalizePhoneNumber', () => {
    it('reads ten digits as a US number', () => {
      expect(canonicalizePhoneNumber('2015550123')).toBe('+12015550123');
    });

    // Existing accounts hold non-US numbers. The US default is an input
    // convenience; it must not make those numbers unreadable.
    it.each([
      ['+442079460958', '+442079460958'],
      ['+44 20 7946 0958', '+442079460958'],
      ['+92 300 1234567', '+923001234567'],
    ])('keeps the explicit country code in %s', (input, expected) => {
      expect(canonicalizePhoneNumber(input)).toBe(expected);
    });

    it.each([
      ['', 'empty'],
      ['   ', 'blank'],
      ['nonsense', 'letters'],
      ['+1', 'country code alone'],
      ['+12015', 'too short'],
      ['+0123456789', 'zero country code'],
      ['555', 'three digits'],
    ])('returns null for %s (%s) rather than throwing', (input) => {
      expect(() => canonicalizePhoneNumber(input)).not.toThrow();
      expect(canonicalizePhoneNumber(input)).toBeNull();
    });
  });

  describe('isUsE164', () => {
    it('accepts a canonical US number', () => {
      expect(isUsE164('+12015550123')).toBe(true);
    });

    it.each([
      ['+1201555012'],
      ['+120155501234'],
      ['2015550123'],
      ['+442079460958'],
    ])('rejects %s', (value) => {
      expect(isUsE164(value)).toBe(false);
    });
  });

  it('exposes +1 as the default country code', () => {
    expect(US_COUNTRY_CODE).toBe('+1');
  });

  it('leaves a leading + in place while stripping punctuation', () => {
    expect(stripPhoneSeparators('+1 (201) 555-0123')).toBe('+12015550123');
  });
});
