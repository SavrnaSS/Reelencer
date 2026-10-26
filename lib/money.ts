const amountFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Display paise consistently without rounding earnings to whole rupees. */
export function formatAmount(amount: number, symbol = "₹") {
  return `${symbol}${amountFormat.format(amount)}`;
}

const paiseFormat = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole amounts stay whole ("₹49"); any paise always show both digits ("₹7,073.10", never "₹7,073.1"). */
export function formatMoney(amount: number, symbol = "₹") {
  return `${symbol}${Number.isInteger(Math.round(amount * 100) / 100) ? amountFormat.format(amount) : paiseFormat.format(amount)}`;
}
