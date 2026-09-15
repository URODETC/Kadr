import type {SkipSegment} from './segments';
export type Title = { id: string; title: string; original: string; type: 'movie' | 'serial'; year: number; genre: string; plot: string; poster: string; quality: number; rating?: number; demo?: boolean };
export type Episode = { key: string; season: number; number: number; title: string; mediaId?: number };
export type Detail = { item: Title; episodes: Episode[] };
export type Playback = { segments?: SkipSegment[]; sources: { url: string; quality: number; mime: string }[]; subtitles: { url: string; lang: string; label: string; mime: string; shift: number }[]; audios: { lang: string; label: string; original: boolean }[]; demo?: boolean };
