export enum SortOption {
  NAME = "name",
  DATE = "date",
}

export const ACCEPTED_FILE_TYPES = [
  "image/*",
  "video/webm",
  "video/mp4",
  ".tgs",
] as const
