export type AlbumEntry = {
  id?: number;
  tmdb_id: number;
  watched: boolean;
  added_at: string;
  watched_at: string | null;
};

export type Movie = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  vote_average?: number;
  director?: string;
};

export type SearchPage = { results: Movie[]; total_pages: number; total_results: number };
export type AlbumRecord = AlbumEntry & { movie?: Movie };
