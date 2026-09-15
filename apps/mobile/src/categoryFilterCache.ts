export interface CategoryFilterData {
  subTypes: string[];
  years: number[];
  areas: string[];
}

const filterCache = new Map<string, CategoryFilterData>();
const shortDramaCache = new Map<string, boolean>();

export function getFilterCache(type: string, kidMode: string): CategoryFilterData | undefined {
  return filterCache.get(`${kidMode}:${type}`);
}

export function setFilterCache(type: string, kidMode: string, data: CategoryFilterData): void {
  filterCache.set(`${kidMode}:${type}`, data);
}

export function getShortDramaCache(type: string, kidMode: string): boolean | undefined {
  return shortDramaCache.get(`${kidMode}:${type}`);
}

export function setShortDramaCache(type: string, kidMode: string, value: boolean): void {
  shortDramaCache.set(`${kidMode}:${type}`, value);
}

export function clearCategoryFilterCache(): void {
  filterCache.clear();
  shortDramaCache.clear();
}
