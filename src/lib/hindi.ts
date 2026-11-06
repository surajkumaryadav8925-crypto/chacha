const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

/** 33 → "३३" */
export function toDevanagari(value: number): string {
  return String(value).replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] ?? digit);
}

/** "१ / ३३" */
export function counterLabel(index: number, total: number): string {
  return `${toDevanagari(index + 1)} / ${toDevanagari(total)}`;
}
