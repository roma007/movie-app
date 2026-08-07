export interface CategoryFilterData {
  subTypes: string[];
  years: number[];
  areas: string[];
}

const filterCache = new Map<string, CategoryFilterData>();
const shortDramaCache = new Map<string, boolean>();

export function getFilterCache(type: string): CategoryFilterData | undefined {
  return filterCache.get(type);
}

export function setFilterCache(type: string, data: CategoryFilterData): void {
  filterCache.set(type, data);
}

export function getShortDramaCache(type: string): boolean | undefined {
  return shortDramaCache.get(type);
}

export function setShortDramaCache(type: string, value: boolean): void {
  shortDramaCache.set(type, value);
}

export function clearCategoryFilterCache(): void {
  filterCache.clear();
  shortDramaCache.clear();
}
