export enum SortOption {
  NAME = "name",
  DATE = "date",
}

export const ACCEPTED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "video/webm",
  ".tgs",
] as const