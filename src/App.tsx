import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { getMovie, isTmdbConfigured, posterUrl, searchMovies } from './lib/tmdb';
import { storage } from './lib/storage';
import type { AlbumEntry, AlbumRecord, Movie } from './lib/types';

const SECTIONS = ['All Movies', 'By Director', 'By Genre', 'By Decade'] as const;
type Section = typeof SECTIONS[number];

function yearOf(movie?: Movie) { return movie?.release_date?.slice(0, 4) || ''; }
function decadeOf(movie?: Movie) { const year = Number(yearOf(movie)); return year ? `${Math.floor(year / 10) * 10}s` : 'Unknown year'; }
function compareTitle(a: AlbumRecord, b: AlbumRecord) { return (a.movie?.title || '').localeCompare(b.movie?.title || '', 'en'); }
function trapDialogTab(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) return;
  const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function Icon({ name, size = 18 }: { name: 'search' | 'plus' | 'left' | 'right' | 'close' | 'arrow' | 'film' | 'check' | 'trash' | 'info'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>, plus: <><path d="M12 5v14M5 12h14"/></>,
    left: <><path d="m15 18-6-6 6-6"/></>, right: <><path d="m9 18 6-6-6-6"/></>, close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>, film: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>, trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [movies, setMovies] = useState<Record<number, Movie>>({});
  const [section, setSection] = useState<Section>('All Movies');
  const [sub, setSub] = useState('All');
  const [page, setPage] = useState(0);
  const [turnDirection, setTurnDirection] = useState<'next' | 'previous' | null>(null);
  const [busy, setBusy] = useState(true);
  const [setupError, setSetupError] = useState(isTmdbConfigured() ? '' : 'TMDB access is not configured.');
  const [activeMovie, setActiveMovie] = useState<number | null>(null);
  const [movieError, setMovieError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia('(max-width: 650px)').matches);
  const turnTimeoutRef = useRef<number | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const albumRef = useRef<HTMLDivElement>(null);
  const pageSize = mobileLayout ? 6 : 12;

  useEffect(() => {
    const query = window.matchMedia('(max-width: 650px)');
    const update = () => setMobileLayout(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const loadMovies = useCallback(async (ids: number[]) => {
    await Promise.all(ids.map(async id => {
      if (movies[id]) return;
      try {
        const movie = await getMovie(id);
        setMovies(current => ({ ...current, [id]: movie }));
      } catch (error) {
        if (error instanceof Error) setSetupError(error.message);
      }
    }));
  }, [movies]);

  useEffect(() => {
    storage.list().then(async rows => {
      setEntries(rows);
      await loadMovies(rows.map(row => row.tmdb_id));
    }).catch(() => setSetupError('Local movie storage is unavailable in this browser.')).finally(() => setBusy(false));
  }, []); // Load the local album once on startup.

  const records = useMemo<AlbumRecord[]>(() => entries.map(entry => ({ ...entry, movie: movies[entry.tmdb_id] })), [entries, movies]);
  const choices = useMemo(() => {
    if (section === 'All Movies') return ['All', 'Watched', 'Unwatched'];
    if (section === 'By Director') return [...new Set(records.map(item => item.movie?.director).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'en'));
    if (section === 'By Genre') {
      const names = new Set<string>();
      records.forEach(item => item.movie?.genres?.forEach(genre => names.add(genre.name)));
      return [...names].sort((a, b) => a.localeCompare(b, 'en'));
    }
    return [...new Set(records.map(item => item.movie ? decadeOf(item.movie) : 'Unknown year'))].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  }, [section, records]);

  useEffect(() => {
    if (!choices.includes(sub)) setSub(choices[0] || 'All');
    setPage(0);
  }, [section, choices]);

  const filtered = useMemo(() => {
    const matching = records.filter(item => {
      if (section === 'All Movies') return sub === 'All' || (sub === 'Watched' ? item.watched : !item.watched);
      if (section === 'By Director') return item.movie?.director === sub;
      if (section === 'By Genre') return item.movie?.genres?.some(genre => genre.name === sub);
      return (item.movie ? decadeOf(item.movie) : 'Unknown year') === sub;
    });
    return matching.sort((a, b) => section === 'All Movies' && sub === 'All' ? b.added_at.localeCompare(a.added_at) : compareTitle(a, b));
  }, [records, section, sub]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRecords = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const leftPage = visibleRecords.slice(0, 6);
  const rightPage = mobileLayout ? [] : visibleRecords.slice(6, 12);
  const activeRecord = records.find(item => item.tmdb_id === activeMovie);
  const activeDetails = activeMovie ? movies[activeMovie] : undefined;

  useEffect(() => {
    setPage(current => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  // Warm the next spread's poster responses while preserving lazy rendering for the rest of the album.
  useEffect(() => {
    const next = filtered.slice((currentPage + 1) * pageSize, (currentPage + 2) * pageSize);
    next.forEach(item => {
      const path = movies[item.tmdb_id]?.poster_path;
      if (!path) return;
      const image = new Image();
      image.src = posterUrl(path, 'w342') || '';
    });
  }, [currentPage, filtered, movies, pageSize]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const goSection = (next: Section) => {
    if (turnTimeoutRef.current !== null) window.clearTimeout(turnTimeoutRef.current);
    turnTimeoutRef.current = null;
    setTurnDirection(null);
    setSection(next);
    setSub(next === 'All Movies' ? 'All' : '');
    setPage(0);
  };

  const changePage = (direction: number) => {
    if (turnDirection) return;
    const target = Math.max(0, Math.min(pageCount - 1, currentPage + direction));
    if (target === currentPage) return;
    setTurnDirection(direction > 0 ? 'next' : 'previous');
    turnTimeoutRef.current = window.setTimeout(() => {
      setPage(target);
      setTurnDirection(null);
      turnTimeoutRef.current = null;
    }, 1240);
    albumRef.current?.focus({ preventScroll: true });
  };

  const onAlbumKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') changePage(-1);
    if (event.key === 'ArrowRight') changePage(1);
  };

  const addMovie = async (movie: Movie) => {
    setIsSaving(true);
    try {
      await storage.add(movie.id);
      const rows = await storage.list();
      setEntries(rows);
      setMovies(current => ({ ...current, [movie.id]: movie }));
      setActiveMovie(null);
      setNotice('Added to your album');
    } catch {
      setNotice('This movie is already in your album');
    } finally { setIsSaving(false); }
  };

  const toggleWatched = async () => {
    if (!activeRecord) return;
    const nextWatched = !activeRecord.watched;
    setEntries(current => current.map(item => item.tmdb_id === activeRecord.tmdb_id ? { ...item, watched: nextWatched, watched_at: nextWatched ? new Date().toISOString() : null } : item));
    try {
      await storage.updateWatched(activeRecord, nextWatched);
      setNotice(nextWatched ? 'Added to your watched collection' : 'Marked as unwatched');
    } catch {
      setEntries(current => current.map(item => item.tmdb_id === activeRecord.tmdb_id ? activeRecord : item));
      setNotice('Could not save that change. Please try again.');
    }
  };

  const removeMovie = async () => {
    if (!activeRecord?.id) return;
    try {
      await storage.remove(activeRecord.id);
      setEntries(current => current.filter(item => item.id !== activeRecord.id));
      setActiveMovie(null);
      setConfirmDelete(false);
      setNotice('Removed from your album');
    } catch { setNotice('Could not remove this movie. Please try again.'); }
  };

  useEffect(() => {
    if (!activeMovie) return;
    setMovieError('');
    getMovie(activeMovie).then(movie => setMovies(current => ({ ...current, [activeMovie]: movie }))).catch(error => setMovieError(error instanceof Error ? error.message : 'Could not load movie details.'));
  }, [activeMovie]);

  useEffect(() => {
    if (!searchOpen && !activeMovie) searchButtonRef.current?.focus();
  }, [searchOpen, activeMovie]);

  const closeOverlay = () => { setSearchOpen(false); setActiveMovie(null); setConfirmDelete(false); };

  return <div className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="#album" aria-label="Movie Album home" onClick={event => { event.preventDefault(); goSection('All Movies'); }}>
        <span className="wordmark-icon"><Icon name="film" size={20}/></span>
        <span>movie<span className="wordmark-light">album</span><i>.</i></span>
      </a>
      <div className="topbar-right">
        <span className="private-label"><span className="private-dot"/> PUBLIC COLLECTION</span>
        <button ref={searchButtonRef} className="icon-button search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search movies"><Icon name="search"/></button>
        <button className="add-button" onClick={() => setSearchOpen(true)}><Icon name="plus" size={17}/><span>Add a movie</span></button>
      </div>
    </header>

    <main id="album" className="main-content">
      <div className="intro-row">
        <div><p className="eyebrow">YOUR PERSONAL CINEMA</p><h1>A life in <em>movies.</em></h1></div>
        <CollectionPlaque stats={{
          label: section === 'All Movies' && sub === 'All' ? 'The collection' : sub,
          total: filtered.length,
          watched: filtered.filter(item => item.watched).length,
          toWatch: filtered.filter(item => !item.watched).length,
        }} />
      </div>

      <nav className="primary-tabs" aria-label="Album sections">
        {SECTIONS.map((item, index) => <button key={item} className={`primary-tab ${section === item ? 'active' : ''}`} onClick={() => goSection(item)} aria-current={section === item ? 'page' : undefined}>
          <span className="tab-index">0{index + 1}</span>{item}
        </button>)}
      </nav>

      <div className="album-layout">
        <aside className="secondary-nav" aria-label={`${section} filters`}>
          {choices.length === 0 ? <p className="side-empty">Groups appear as your collection grows.</p> : choices.map(choice => {
            const count = section === 'All Movies' ? records.filter(item => choice === 'All' || (choice === 'Watched' ? item.watched : !item.watched)).length : records.filter(item => section === 'By Director' ? item.movie?.director === choice : section === 'By Genre' ? item.movie?.genres?.some(genre => genre.name === choice) : (item.movie ? decadeOf(item.movie) : 'Unknown year') === choice).length;
            return <button key={choice} className={`secondary-tab ${sub === choice ? 'active' : ''}`} onClick={() => { if (turnTimeoutRef.current !== null) window.clearTimeout(turnTimeoutRef.current); turnTimeoutRef.current = null; setTurnDirection(null); setSub(choice); setPage(0); }}>
              <span>{choice}</span><small>{count.toString().padStart(2, '0')}</small>{sub === choice && <span className="side-active-line"/>}
            </button>;
          })}
          {section !== 'All Movies' && <button className="clear-filter" onClick={() => goSection('All Movies')}>← All movies</button>}
        </aside>

        <section className="album-stage" aria-label="Movie album">
          {setupError && !isTmdbConfigured() && <div className="setup-note"><div className="setup-note-icon"><Icon name="info"/></div><div><strong>Connect TMDB to get started</strong><p>For a published site, configure the Supabase TMDB function. For local use, add the API Read Access Token to <code>.env.local</code>.</p><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Get a TMDB key <Icon name="arrow" size={13}/></a></div><button aria-label="Dismiss setup note" onClick={() => setSetupError('')}><Icon name="close" size={16}/></button></div>}
          {setupError && isTmdbConfigured() && <div className="inline-error" role="status">{setupError} <button onClick={() => { setSetupError(''); void loadMovies(entries.map(item => item.tmdb_id)); }}>Try again</button></div>}
          <div className="album-book" ref={albumRef} tabIndex={0} onKeyDown={onAlbumKeyDown} aria-label={`Album spread ${currentPage + 1} of ${pageCount}. Use left and right arrow keys to turn pages.`}>
            <div className={`book-spread ${turnDirection ? `turn-${turnDirection}` : ''}`} key={`${section}-${sub}-${currentPage}`}>
              <AlbumPage records={leftPage} side="left" loading={busy} onOpen={id => setActiveMovie(id)} />
              <div className="book-gutter" aria-hidden="true"><span/></div>
              <AlbumPage records={rightPage} side="right" loading={busy} onOpen={id => setActiveMovie(id)} />
            </div>
            {filtered.length === 0 && !busy && <div className="empty-overlay"><div className="empty-icon"><Icon name="film" size={25}/></div><h2>{entries.length === 0 ? 'Your album is waiting.' : 'A fresh page.'}</h2><p>{entries.length === 0 ? 'Start collecting the films that stay with you.' : 'There are no movies in this section yet.'}</p><button className="add-button" onClick={() => setSearchOpen(true)}><Icon name="plus" size={17}/> Find a movie</button></div>}
            {busy && <div className="loading-overlay"><span className="spinner"/><span>Opening your album…</span></div>}
          </div>
          <div className="album-footer"><span className="footer-note"><span className="footer-line"/> A LITTLE SPACE FOR EVERY STORY</span><div className="pager-controls"><button aria-label="Previous spread" disabled={currentPage === 0} onClick={() => changePage(-1)}><Icon name="left" size={16}/></button><span>{String(currentPage + 1).padStart(2, '0')} <i>—</i> {String(pageCount).padStart(2, '0')}</span><button aria-label="Next spread" disabled={currentPage >= pageCount - 1} onClick={() => changePage(1)}><Icon name="right" size={16}/></button></div></div>
        </section>
      </div>
    </main>

    <footer className="app-footer"><span>MADE FOR THE LOVE OF FILM</span><span className="tmdb-credit">Movie data and images from <strong>TMDB</strong></span></footer>
    {searchOpen && <SearchDialog entries={entries} onClose={closeOverlay} onAdd={addMovie} onOpenMovie={id => { setSearchOpen(false); setActiveMovie(id); }} isSaving={isSaving}/>}
    {activeMovie !== null && <MovieDialog movie={activeDetails} record={activeRecord} loadError={movieError} onRetry={() => { setMovieError(''); void getMovie(activeMovie).then(movie => setMovies(current => ({ ...current, [activeMovie]: movie }))).catch(error => setMovieError(error instanceof Error ? error.message : 'Could not load movie details.')); }} onClose={closeOverlay} onWatched={toggleWatched} onRemove={() => setConfirmDelete(true)} onAdd={addMovie} confirmDelete={confirmDelete} onCancelDelete={() => setConfirmDelete(false)} onConfirmDelete={removeMovie} isSaving={isSaving}/>}
    {notice && <div className="toast" role="status"><span className="toast-check"><Icon name="check" size={15}/></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}
  </div>;
}

type PageStats = { label: string; total: number; watched: number; toWatch: number };

function CollectionPlaque({ stats }: { stats: PageStats }) {
  return <div className="collection-plaque">
    <div className="plaque-heading"><span>PERSONAL ARCHIVE</span></div>
    <div className="plaque-title"><h2>{stats.label}</h2><span><strong>{String(stats.total).padStart(2, '0')}</strong> films</span></div>
    <div className="plaque-stats"><span>WATCHED <b>{String(stats.watched).padStart(2, '0')}</b></span><span>TO WATCH <b>{String(stats.toWatch).padStart(2, '0')}</b></span></div>
  </div>;
}

function AlbumPage({ records, side, loading, onOpen }: { records: AlbumRecord[]; side: 'left' | 'right'; loading: boolean; onOpen: (id: number) => void }) {
  return <div className={`album-page ${side}`}>
    <span className="page-corner" aria-hidden="true"/><div className="page-filmstrip" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    {loading ? <div className="poster-grid">{Array.from({ length: 4 }).map((_, index) => <div className="poster-skeleton" key={index}/>)}</div> : <div className="poster-grid">{records.map((record, index) => {
      const movie = record.movie;
      return <button className={`poster-card ${record.watched ? 'watched' : 'unwatched'}`} key={record.tmdb_id} onClick={() => onOpen(record.tmdb_id)} aria-label={`${movie?.title || 'Movie'}${record.watched ? ', watched' : ', not watched'}`} title={movie?.title || undefined}>
        <span className="poster-frame"><PosterArtwork movie={movie}/>{record.watched && <span className="sticker-mark"><Icon name="check" size={13}/></span>}</span>
        <span className="poster-caption"><strong>{movie?.title || 'Loading title…'}</strong></span>
        <span className="poster-number">{String(index + 1).padStart(2, '0')}</span>
      </button>;
    })}</div>}
    <span className="page-number">{side === 'left' ? 'M · A' : 'M · A'}</span>
  </div>;
}

function PosterArtwork({ movie }: { movie?: Movie }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [movie?.poster_path]);
  if (movie?.poster_path && !failed) {
    return <img src={posterUrl(movie.poster_path)} alt={`${movie.title} poster`} loading="lazy" decoding="async" onError={() => setFailed(true)}/>;
  }
  return <span className="poster-placeholder"><Icon name="film" size={26}/><span>{movie?.title || 'Poster unavailable'}</span></span>;
}

function SearchDialog({ entries, onClose, onAdd, onOpenMovie, isSaving }: { entries: AlbumEntry[]; onClose: () => void; onAdd: (movie: Movie) => Promise<void>; onOpenMovie: (id: number) => void; isSaving: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const entryIds = useMemo(() => new Set(entries.map(entry => entry.tmdb_id)), [entries]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setError(''); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const timeout = window.setTimeout(() => {
      searchMovies(term, 1, controller.signal).then(data => setResults(data.results)).catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Search failed.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [query]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClose();
    trapDialogTab(event);
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={onKeyDown}>
    <section className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title">
      <div className="dialog-topline"><span className="dialog-kicker">ADD TO YOUR ALBUM</span><button className="icon-button close-button" onClick={onClose} aria-label="Close search"><Icon name="close"/></button></div>
      <h2 id="search-title">Find a <em>film.</em></h2><p className="dialog-description">Search the TMDB library and add a story to your collection.</p>
      <label className="search-field"><Icon name="search"/><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by title…" aria-label="Search movie titles"/><kbd>ESC</kbd></label>
      <div className="search-results" aria-live="polite">
        {loading && <div className="search-message"><span className="spinner"/> Searching the film library…</div>}
        {!loading && error && <div className="search-message error-message">{error}</div>}
        {!loading && !error && query.trim().length < 2 && <div className="search-message muted-message">Enter at least two characters to begin.</div>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && <div className="search-message muted-message">No films found. Try another title.</div>}
        {!loading && results.map(movie => {
          const added = entryIds.has(movie.id);
          return <div className="result-row" key={movie.id}>
            <button className="result-main" onClick={() => onOpenMovie(movie.id)}><span className="result-poster">{movie.poster_path ? <img src={posterUrl(movie.poster_path, 'w185')} alt="" loading="lazy"/> : <Icon name="film"/>}</span><span className="result-text"><strong>{movie.title}</strong><small>{yearOf(movie) || 'Release year unknown'}{movie.original_title && movie.original_title !== movie.title ? ` · ${movie.original_title}` : ''}</small></span></button>
            <button className={`result-add ${added ? 'already-added' : ''}`} disabled={added || isSaving} onClick={() => void onAdd(movie)}>{added ? <><Icon name="check" size={15}/> In album</> : <><Icon name="plus" size={15}/> Add</>}</button>
          </div>;
        })}
      </div>
      <p className="tmdb-attribution">Movie information and artwork supplied by TMDB.</p>
    </section>
  </div>;
}

function MovieDialog({ movie, record, loadError, onRetry, onClose, onWatched, onRemove, onAdd, confirmDelete, onCancelDelete, onConfirmDelete, isSaving }: { movie?: Movie; record?: AlbumRecord; loadError: string; onRetry: () => void; onClose: () => void; onWatched: () => void; onRemove: () => void; onAdd: (movie: Movie) => Promise<void>; confirmDelete: boolean; onCancelDelete: () => void; onConfirmDelete: () => void; isSaving: boolean }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !confirmDelete) onClose();
    trapDialogTab(event);
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !confirmDelete) onClose(); }} onKeyDown={keyDown}>
    <section className="movie-dialog" role="dialog" aria-modal="true" aria-labelledby="movie-title">
      <button ref={closeButton} className="icon-button movie-close" onClick={onClose} aria-label="Close movie details"><Icon name="close"/></button>
      {movie ? <>
        <div className="detail-poster-wrap"><div className="detail-poster">{movie.poster_path ? <img className={record?.watched ? 'detail-color' : 'detail-gray'} src={posterUrl(movie.poster_path, 'w500')} alt={`${movie.title} poster`}/> : <span className="poster-placeholder"><Icon name="film" size={34}/></span>}</div><span className="detail-poster-caption">A FILM IN YOUR ALBUM</span></div>
        <div className="movie-detail-content"><p className="dialog-kicker">{record ? (record.watched ? 'IN YOUR COLLECTION · WATCHED' : 'IN YOUR COLLECTION · UNWATCHED') : 'FROM THE FILM LIBRARY'}</p><h2 id="movie-title">{movie.title}</h2><p className="detail-subtitle">{yearOf(movie) || 'Year unknown'}{movie.runtime ? ` · ${movie.runtime} min` : ''}{movie.vote_average ? ` · TMDB ${movie.vote_average.toFixed(1)}` : ''}</p>
          <p className="movie-overview">{movie.overview || 'No synopsis is available for this film.'}</p>
          <div className="detail-meta"><div><span>DIRECTOR</span><strong>{movie.director || 'Not listed'}</strong></div><div><span>GENRE</span><strong>{movie.genres?.map(genre => genre.name).join(', ') || 'Not listed'}</strong></div></div>
          <div className="detail-actions">{record ? <>
            <button className={`watched-action ${record.watched ? 'is-watched' : ''}`} onClick={onWatched}><span className="action-check"><Icon name="check" size={15}/></span>{record.watched ? 'Watched' : 'Mark as watched'}</button>
            <button className="remove-action" onClick={onRemove}><Icon name="trash" size={15}/> Remove from album</button>
          </> : <button className="add-button detail-add" disabled={isSaving} onClick={() => void onAdd(movie)}><Icon name="plus" size={17}/>{isSaving ? 'Adding…' : 'Add to album'}</button>}</div>
          <p className="tmdb-attribution">Movie information and artwork supplied by TMDB.</p>
        </div>
      </> : <div className="detail-loading">{loadError ? <div className="detail-load-error"><Icon name="info"/><p>{loadError}</p><button onClick={onRetry}>Try again</button></div> : <><span className="spinner"/><p>Finding the film…</p></>}</div>}
      {confirmDelete && <div className="confirm-layer"><div className="confirm-card"><span className="confirm-icon"><Icon name="trash"/></span><h3>Remove this film?</h3><p>It will be removed from your album. You can add it again later.</p><div><button className="cancel-button" onClick={onCancelDelete}>Keep film</button><button className="confirm-button" onClick={onConfirmDelete}>Remove film</button></div></div></div>}
    </section>
  </div>;
}

export default App;
