export function formatCurrency(value: number, showSign = false): string {
  const abs = Math.abs(Math.round(value));
  const formatted = `$${abs.toLocaleString('en-US')}`;
  if (value < 0) return `-${formatted}`;
  if (showSign && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatCurrencyExact(value: number, showSign = false): string {
  const rounded = Math.round(value * 100) / 100;
  const abs = Math.abs(rounded);
  const formatted = `$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  if (rounded < 0) return `-${formatted}`;
  if (showSign && rounded > 0) return `+${formatted}`;
  return formatted;
}

export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatFilingStatus(status: string): string {
  switch (status) {
    case 'married_filing_jointly':
      return 'Married Filing Jointly';
    case 'single':
      return 'Single';
    case 'head_of_household':
      return 'Head of Household';
    case 'married_filing_separately':
      return 'Married Filing Separately';
    default:
      return status;
  }
}
