// Shapes of the MemeDB API (see server/internal/model). Times are ISO 8601 strings.

export type Role = 'user' | 'admin'
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  username: string
  email: string
  role: Role
  status: UserStatus
  created_at: string
  updated_at: string
}

export interface UserRef {
  id: string
  username: string
}

export type TokenScope = 'read' | 'write' | 'admin'

export interface ApiToken {
  id: string
  name: string
  /** Last characters of the secret */
  hint: string
  scope: TokenScope
  expires_at: string | null
  /** Recorded to the minute */
  last_used_at: string | null
  created_at: string
}

export interface CreatedToken extends ApiToken {
  /** Only ever returned on creation */
  secret: string
}

export interface UserStats {
  files: number
  folders: number
  favorites: number
}

export type ProcessStatus = 'pending' | 'processing' | 'success' | 'failed'
export type MediaKind = 'image' | 'gif' | 'video' | 'lottie'
export type Visibility = 'private' | 'public' | 'inherited'

export interface MemeTag {
  id: string
  name: string
  mine: boolean
  /** On too few memes to show on cards */
  rare: boolean
}

export interface EntryRef {
  id: string
  folder_id: string | null
}

export interface MemeThumb {
  id: string
  url: string
  mime_type: string
}

export interface Meme extends MemeThumb {
  file_size: number
  width: number
  height: number
  status: ProcessStatus
  fail_reason: string | null
  ocr_text: string
  keywords: string[]
  tags: MemeTag[]
  is_public: boolean
  favorite_count: number
  library_count: number
  is_favorite: boolean
  entry: EntryRef | null
  created_at: string
  analyzed_at: string | null
}

export interface Folder {
  id: string
  parent_id: string | null
  name: string
  visibility: Visibility
  owner: UserRef
  item_count: number
  previews: MemeThumb[]
  favorite_count: number
  is_favorite: boolean
  created_at: string
}

export interface Entry {
  id: string
  parent_id: string | null
  name: string
  visibility: Visibility
  meme: Meme
  created_at: string
}

/** An entry opened by its link, which may be in another user's public folder */
export interface EntryDetail extends Entry {
  owner: UserRef
  /** The viewer-visible folders above it, root first */
  ancestors: Crumb[]
}

export interface Crumb {
  id: string
  name: string
}

export interface LibraryView {
  /** Null at the root of the library */
  folder: Folder | null
  /** The viewer-visible folders above it, root first */
  ancestors: Crumb[]
  folders: Folder[]
  entries: Entry[]
}

/** A folder opened by its link, which may be another user's public one */
export interface FolderPage extends LibraryView {
  folder: Folder
}

export interface Profile {
  user: UserRef & { created_at: string }
  folders: Folder[]
  memes: Meme[]
}

export interface Favorites {
  memes: Meme[]
  folders: Folder[]
  stale_memes: string[]
  stale_folders: string[]
}

export interface SearchResult {
  meme: Meme
  recall_type: string
  score: number
  similarity: number
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface UploadConfig {
  max_size_mb: number
  accept: string
}

/* ---------------------------------- admin ---------------------------------- */

export interface AdminUser extends User, UserStats {}

export interface UserDetail extends AdminUser {
  /** The user's latest uploads. */
  recent: Meme[]
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
/** Task status as shown to admins: a pending task after a failed attempt is "retrying". */
export type TaskState = 'pending' | 'retrying' | 'running' | 'completed' | 'failed'

export interface Task {
  id: string
  parent_task_id: string | null
  job_type: string
  payload: Record<string, unknown>
  status: TaskStatus
  error_message: string | null
  priority: number
  cron: string | null
  attempts: number
  run_at: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  /** Finished attempts, oldest first. */
  history: TaskAttempt[]
}

export interface TaskAttempt {
  at: string
  ok: boolean
  error: string | null
}

export interface TaskDetail extends Task {
  runs: Task[]
}

export interface TaskTypeCounts {
  job_type: string
  pending: number
  retrying: number
  running: number
  completed: number
  failed: number
  completed_in_range: number
  failed_in_range: number
}

export interface TagUsage {
  id: string
  name: string
  /** Other spellings that resolve to this tag */
  aliases: string[]
  hidden: boolean
  /** On so many memes that it hardly tells them apart */
  common: boolean
  usage: number
  created_at: string
}

export interface Overview {
  users: { total: number; admins: number; new: number }
  memes: { total: number; storage_bytes: number; public: number; analyzed: number; pending: number; failed: number }
  library: { folders: number; files: number; public_nodes: number; tags: number }
  tasks: TaskTypeCounts[]
  trend: { day: string; uploads: number; users: number; completed: number; failed: number }[]
  services: { name: string; ok: boolean; detail: string }[]
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: string
  level: LogLevel
  message: string
  attrs: Record<string, string>
}
