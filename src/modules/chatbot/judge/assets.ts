import { findIn, normalize, views, type View, type ViewKind } from "./normalize";

/** Assets shorter than this (after normalisation) are ignored: too short to match without false positives. */
export const MIN_ASSET_CHARS = 4;

export interface AssetMatch {
  /** Number of distinct protected assets found. Values are never returned. */
  count: number;
  /** Forms they were found in, e.g. ["plain", "base64"]. */
  forms: ViewKind[];
}

/** Protected assets found in a reply, with the same normalisation and decoding as the canary check. */
export function matchAssets(reply: string, assets: readonly string[], replyViews: View[] = views(reply)): AssetMatch {
  const seen = new Set<string>();
  const forms = new Set<ViewKind>();
  for (const asset of assets) {
    const needle = normalize(asset);
    if (needle.length < MIN_ASSET_CHARS || seen.has(needle)) continue;
    const form = findIn(replyViews, asset);
    if (form) {
      seen.add(needle);
      forms.add(form);
    }
  }
  return { count: seen.size, forms: [...forms] };
}
