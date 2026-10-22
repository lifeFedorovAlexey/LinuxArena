import { formatAddress as coreFormatAddress } from '../../core/placement/index.mjs';
import { localeTag, t } from '../shared/i18n/index.mjs';

/** Reuse core's exact BigInt representation; localization never rounds an address. */
export function formatAddress(value) {
  const formatted = coreFormatAddress(value);
  const match = /^([\d,]+) (байт|МиБ|КиБ)$/.exec(formatted);
  if (!match) return formatted;
  const decimal = new Intl.NumberFormat(localeTag())
    .formatToParts(1.5)
    .find((part) => part.type === 'decimal').value;
  return `${match[1].replace(',', decimal)} ${t(match[2])}`;
}
