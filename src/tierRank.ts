export function tierRank(tier: string): string {
  return tier.toUpperCase().replace('-TIER', '').trim();
}
