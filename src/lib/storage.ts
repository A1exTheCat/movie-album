import { createClient } from '@supabase/supabase-js';
import type { AlbumEntry } from './types';

const DB_NAME = 'movie-album';
const STORE = 'album_entries';
const MIGRATION_KEY = 'movie-album:supabase-import-v1';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('tmdb_id', 'tmdb_id', { unique: true });
        store.createIndex('added_at', 'added_at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

const localStorageAdapter = {
  list: () => run<AlbumEntry[]>('readonly', store => store.getAll()),
  add: (tmdb_id: number) => run<IDBValidKey>('readwrite', store => store.add({
    tmdb_id, watched: false, added_at: new Date().toISOString(), watched_at: null,
  })),
  updateWatched: async (entry: AlbumEntry, watched: boolean) => {
    const next = { ...entry, watched, watched_at: watched ? new Date().toISOString() : null };
    return run<IDBValidKey>('readwrite', store => store.put(next));
  },
  remove: (id: number) => run<undefined>('readwrite', store => store.delete(id)),
};

type RemoteRow = Omit<AlbumEntry, 'id'> & { id: number };

async function remoteList(): Promise<RemoteRow[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('album_entries')
    .select('id, tmdb_id, watched, added_at, watched_at')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data as RemoteRow[];
}

async function listRemoteWithLocalImport(): Promise<AlbumEntry[]> {
  if (!supabase) return localStorageAdapter.list();

  let rows = await remoteList();
  if (rows.length > 0 || localStorage.getItem(MIGRATION_KEY) === 'done') {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return rows;
  }

  const localRows = await localStorageAdapter.list();
  if (localRows.length > 0) {
    const { error } = await supabase.from('album_entries').upsert(
      localRows.map(({ tmdb_id, watched, added_at, watched_at }) => ({ tmdb_id, watched, added_at, watched_at })),
      { onConflict: 'tmdb_id' },
    );
    if (error) throw error;
    rows = await remoteList();
  }
  localStorage.setItem(MIGRATION_KEY, 'done');
  return rows;
}

export const storage = {
  list: listRemoteWithLocalImport,
  add: async (tmdb_id: number) => {
    if (!supabase) return localStorageAdapter.add(tmdb_id);
    const { data, error } = await supabase.from('album_entries')
      .insert({ tmdb_id, watched: false, added_at: new Date().toISOString(), watched_at: null })
      .select('id').single();
    if (error) throw error;
    return data.id as number;
  },
  updateWatched: async (entry: AlbumEntry, watched: boolean) => {
    if (!supabase) return localStorageAdapter.updateWatched(entry, watched);
    const { error } = await supabase.from('album_entries')
      .update({ watched, watched_at: watched ? new Date().toISOString() : null })
      .eq('id', entry.id);
    if (error) throw error;
    return entry.id as number;
  },
  remove: async (id: number) => {
    if (!supabase) return localStorageAdapter.remove(id);
    const { error } = await supabase.from('album_entries').delete().eq('id', id);
    if (error) throw error;
  },
};
