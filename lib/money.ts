const amountFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Display paise consistently without rounding earnings to whole rupees. */
export function formatAmount(amount: number, symbol = "₹") {
  return `${symbol}${amountFormat.format(amount)}`;
}
