/**
 * Google Places (New) reputation client.
 *
 * Port of Oz Dealer Tools' GooglePlaces library. Fetches a business's live
 * Google rating, review count, status, and (richer than ODT) up to 5 recent
 * reviews — via the Places API (New) REST endpoint
 * (`GET /v1/places/{placeId}` with an `X-Goog-FieldMask`). One agency API key in
 * env; each account maps to a Google place id (+ optional competitor) via
 * `GOOGLE_PLACES_MAP`.
 *
 * Full review-level history/trends (every review over time, reply rates) come
 * from ODT's `ozrep` reviews pipeline, not the Places API — that arrives with
 * the dealer-DB import track.
 */

const PLACES_BASE = 'https://places.googleapis.com/v1/places';
const FIELD_MASK =
  'id,displayName,formattedAddress,rating,userRatingCount,googleMapsUri,websiteUri,businessStatus,reviews';

/** Agency Google Places/Maps API key from env (matches ODT's GOOGLE_MAPS_API_KEY). */
export function getPlacesApiKey(): string | null {
  const key = (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY)?.trim();
  return key || null;
}

export function isPlacesConfigured(): boolean {
  return getPlacesApiKey() !== null;
}

export type PlacesErrorCode = 'not_configured' | 'no_place' | 'api_error';

export class PlacesError extends Error {
  code: PlacesErrorCode;
  httpStatus?: number;
  constructor(message: string, code: PlacesErrorCode, httpStatus?: number) {
    super(message);
    this.name = 'PlacesError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface PlaceConfig {
  placeId: string;
  competitorPlaceId?: string;
}

/**
 * Resolve a sub-account → its Google place id (+ optional competitor). Reads
 * `GOOGLE_PLACES_MAP`; each value is either a place-id string or
 * `{ "placeId": "...", "competitorPlaceId": "..." }`. `null` when unmapped.
 */
export function resolvePlaceConfig(accountKey: string): PlaceConfig | null {
  const raw = process.env.GOOGLE_PLACES_MAP?.trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<
      string,
      string | { placeId?: string; competitorPlaceId?: string }
    >;
    const v = map[accountKey];
    if (!v) return null;
    if (typeof v === 'string') return v ? { placeId: v } : null;
    return v.placeId ? { placeId: v.placeId, competitorPlaceId: v.competitorPlaceId || undefined } : null;
  } catch {
    return null;
  }
}

export interface PlaceReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  /** 1..5, or null when the place has no rating yet. */
  rating: number | null;
  reviewCount: number;
  mapsUrl: string;
  website: string;
  /** OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | '' */
  businessStatus: string;
  /** Up to 5 recent reviews the Places API returns inline. */
  reviews: PlaceReview[];
}

interface PlacesApiResponse {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  businessStatus?: string;
  reviews?: Array<{
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
    relativePublishTimeDescription?: string;
  }>;
  error?: { message?: string };
}

/** Fetch live Google details for a place id. */
export async function getPlaceDetails(apiKey: string, placeId: string): Promise<PlaceDetails> {
  let res: Response;
  try {
    res = await fetch(`${PLACES_BASE}/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new PlacesError(
      `Could not reach the Google Places API: ${err instanceof Error ? err.message : 'network error'}`,
      'api_error',
    );
  }
  const json = (await res.json().catch(() => null)) as PlacesApiResponse | null;
  if (!res.ok) {
    throw new PlacesError(`Google Places: ${json?.error?.message || `HTTP ${res.status}`}`, 'api_error', res.status);
  }
  const reviews: PlaceReview[] = Array.isArray(json?.reviews)
    ? json!.reviews!.map((r) => ({
        author: r?.authorAttribution?.displayName ?? 'Anonymous',
        rating: Number(r?.rating ?? 0),
        text: r?.text?.text ?? r?.originalText?.text ?? '',
        relativeTime: r?.relativePublishTimeDescription ?? '',
      }))
    : [];
  return {
    placeId,
    name: json?.displayName?.text ?? '',
    address: json?.formattedAddress ?? '',
    rating: typeof json?.rating === 'number' ? json.rating : null,
    reviewCount: Number(json?.userRatingCount ?? 0),
    mapsUrl: json?.googleMapsUri ?? '',
    website: json?.websiteUri ?? '',
    businessStatus: json?.businessStatus ?? '',
    reviews,
  };
}
