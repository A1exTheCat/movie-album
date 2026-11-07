import type { Movie, SearchPage } from './types';

const BASE = 'https://api.themoviedb.org/3';
const token = import.meta.env.VITE_TMDB_TOKEN?.trim();
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const genreCache = new Map<number, string>();
const detailCache = new Map<number, Movie>();

export function isTmdbConfigured() {
  return Boolean(token || (supabaseUrl && supabaseAnonKey));
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!isTmdbConfigured()) throw new Error('Configure the TMDB proxy in Supabase, or add a TMDB API Read Access Token to .env.local for local use.');
  const usingProxy = Boolean(supabaseUrl && supabaseAnonKey);
  const response = await fetch(usingProxy
    ? `${supabaseUrl}/functions/v1/tmdb?path=${encodeURIComponent(path)}`
    : `${BASE}${path}`, {
    signal,
    headers: usingProxy
      ? { apikey: supabaseAnonKey!, accept: 'application/json' }
      : { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('TMDB did not accept this token. Check VITE_TMDB_TOKEN in .env.local.');
    if (response.status === 429) throw new Error('TMDB is receiving too many requests. Please wait a moment and try again.');
    throw new Error(`TMDB request failed (${response.status}). Please try again.`);
  }
  return response.json() as Promise<T>;
}

export async function getGenres(): Promise<Map<number, string>> {
  if (genreCache.size) return genreCache;
  const result = await request<{ genres: { id: number; name: string }[] }>('/genre/movie/list?language=en-US');
  result.genres.forEach(genre => genreCache.set(genre.id, genre.name));
  return genreCache;
}

export async function searchMovies(query: string, page = 1, signal?: AbortSignal): Promise<SearchPage> {
  return request<SearchPage>(`/search/movie?include_adult=false&language=en-US&page=${page}&query=${encodeURIComponent(query)}`, signal);
}

export async function getMovie(id: number, signal?: AbortSignal): Promise<Movie> {
  const cached = detailCache.get(id);
  if (cached) return cached;
  const movie = await request<Movie & { credits?: { crew?: { job: string; name: string }[] } }>(`/movie/${id}?append_to_response=credits&language=en-US`, signal);
  const director = movie.credits?.crew?.find(person => person.job === 'Director')?.name;
  const normalized: Movie = { ...movie, director };
  detailCache.set(id, normalized);
  return normalized;
}

export function posterUrl(path?: string | null, size = 'w342'): string | undefined {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}
