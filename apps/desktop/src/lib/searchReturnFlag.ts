let searchFromDetail = false;

export function markSearchFromDetail(): void {
  searchFromDetail = true;
}

export function consumeSearchFromDetail(): boolean {
  const v = searchFromDetail;
  searchFromDetail = false;
  return v;
}

export function resetSearchFromDetail(): void {
  searchFromDetail = false;
}
