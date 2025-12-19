// Mock data for the application
export interface Meme {
  id: string
  title: string
  url: string
  format?: string
  description: string
  tags: string[]
  userId: string
  username: string
  folderId?: string
  folderName?: string
  isPublic: boolean
  createdAt: string
  isFavorite?: boolean
  processingStatus?: "processing" | "complete" | "failed"
}

export interface Folder {
  id: string
  name: string
  userId: string
  username: string
  parentId?: string
  isPublic: boolean
  memeCount: number
  createdAt: string
  isFavorite?: boolean
}

// Generate mock memes
export const mockMemes: Meme[] = [
  {
    id: "1",
    title: "Distracted Boyfriend",
    url: "/distracted-boyfriend.png",
    description: "Classic meme about distractions",
    tags: ["classic", "relationship", "funny"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder1",
    folderName: "Classics",
    isPublic: true,
    createdAt: "2025-01-10",
    processingStatus: "complete",
    format: "png",
  },
  {
    id: "2",
    title: "Drake Hotline Bling",
    url: "/drake-hotline-bling-meme.png",
    description: "Drake approves and disapproves",
    tags: ["drake", "reaction", "choice"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder1",
    folderName: "Classics",
    isPublic: true,
    createdAt: "2025-01-11",
    processingStatus: "complete",
  },
  {
    id: "3",
    title: "Woman Yelling at Cat",
    url: "/woman-yelling-at-cat-meme.png",
    description: "Woman yelling at confused cat",
    tags: ["cat", "argument", "viral"],
    userId: "user2",
    username: "cat_person",
    folderId: "folder2",
    folderName: "Animals",
    isPublic: true,
    createdAt: "2025-01-12",
    processingStatus: "complete",
  },
  {
    id: "4",
    title: "This Is Fine",
    url: "/this-is-fine-dog.png",
    description: "Dog in burning room saying this is fine",
    tags: ["dog", "fire", "cope"],
    userId: "user2",
    username: "cat_person",
    folderId: "folder2",
    folderName: "Animals",
    isPublic: true,
    createdAt: "2025-01-13",
    processingStatus: "complete",
  },
  {
    id: "5",
    title: "Galaxy Brain",
    url: "/galaxy-brain-expanding-meme.jpg",
    description: "Expanding brain meme",
    tags: ["smart", "brain", "enlightenment"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder3",
    folderName: "Reactions",
    isPublic: true,
    createdAt: "2025-01-14",
    processingStatus: "complete",
  },
  {
    id: "6",
    title: "Stonks",
    url: "/stonks-rising-meme.jpg",
    description: "Business stonks rising",
    tags: ["stonks", "business", "money"],
    userId: "user3",
    username: "trader123",
    folderId: "folder4",
    folderName: "Business",
    isPublic: true,
    createdAt: "2025-01-15",
    processingStatus: "complete",
  },
  {
    id: "7",
    title: "Is This a Pigeon?",
    url: "/is-this-a-pigeon-anime-meme.jpg",
    description: "Anime character misidentifying butterfly",
    tags: ["anime", "confusion", "butterfly"],
    userId: "user3",
    username: "trader123",
    isPublic: true,
    createdAt: "2025-01-16",
    processingStatus: "complete",
  },
  {
    id: "8",
    title: "Two Buttons",
    url: "/two-buttons-sweating-meme.jpg",
    description: "Man sweating over two button choices",
    tags: ["decision", "pressure", "choice"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder3",
    folderName: "Reactions",
    isPublic: true,
    createdAt: "2025-01-17",
    processingStatus: "complete",
  },
  {
    id: "9",
    title: "Surprised Pikachu",
    url: "/surprised-pikachu-meme.png",
    description: "Pikachu with surprised face",
    tags: ["pikachu", "reaction", "surprise", "viral"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder1",
    folderName: "Classics",
    isPublic: true,
    createdAt: "2025-01-18",
    processingStatus: "complete",
  },
  {
    id: "10",
    title: "Hide the Pain Harold",
    url: "/hide-pain-harold.png",
    description: "Man smiling while hiding pain",
    tags: ["harold", "pain", "smile", "classic"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder1",
    folderName: "Classics",
    isPublic: true,
    createdAt: "2025-01-19",
    processingStatus: "complete",
  },
  {
    id: "11",
    title: "Evil Kermit",
    url: "/memes/evil-kermit.png",
    description: "Kermit talking to hooded Kermit",
    tags: ["kermit", "evil", "decision", "reaction"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder3",
    folderName: "Reactions",
    isPublic: true,
    createdAt: "2025-01-20",
    processingStatus: "complete",
  },
  {
    id: "12",
    title: "Success Kid",
    url: "/success-kid-fist-pump-meme.jpg",
    description: "Baby with fist pump",
    tags: ["success", "baby", "win", "classic"],
    userId: "user2",
    username: "cat_person",
    isPublic: true,
    createdAt: "2025-01-21",
    processingStatus: "complete",
  },
  {
    id: "13",
    title: "Doge",
    url: "/doge-shiba-inu-meme.png",
    description: "Shiba Inu with comic sans text",
    tags: ["doge", "dog", "shiba", "classic"],
    userId: "user2",
    username: "cat_person",
    folderId: "folder2",
    folderName: "Animals",
    isPublic: true,
    createdAt: "2025-01-22",
    processingStatus: "complete",
  },
  {
    id: "14",
    title: "Roll Safe",
    url: "/roll-safe-thinking-meme.jpg",
    description: "Man tapping temple thinking",
    tags: ["smart", "thinking", "reaction"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder3",
    folderName: "Reactions",
    isPublic: true,
    createdAt: "2025-01-23",
    processingStatus: "complete",
  },
  {
    id: "15",
    title: "Mocking SpongeBob",
    url: "/memes/mocking-spongebob.png",
    description: "SpongeBob with alternating caps text",
    tags: ["spongebob", "mocking", "reaction"],
    userId: "user1",
    username: "meme_lord",
    folderId: "folder3",
    folderName: "Reactions",
    isPublic: true,
    createdAt: "2025-01-24",
    processingStatus: "complete",
  },
]

export const mockFolders: Folder[] = [
  {
    id: "folder1",
    name: "Classics",
    userId: "user1",
    username: "meme_lord",
    isPublic: true,
    memeCount: 15,
    createdAt: "2025-01-01",
  },
  {
    id: "folder2",
    name: "Animals",
    userId: "user2",
    username: "cat_person",
    isPublic: true,
    memeCount: 23,
    createdAt: "2025-01-02",
  },
  {
    id: "folder3",
    name: "Reactions",
    userId: "user1",
    username: "meme_lord",
    parentId: "folder1",
    isPublic: true,
    memeCount: 10,
    createdAt: "2025-01-03",
  },
  {
    id: "folder4",
    name: "Business",
    userId: "user3",
    username: "trader123",
    isPublic: true,
    memeCount: 8,
    createdAt: "2025-01-04",
  },
  {
    id: "folder5",
    name: "Programming",
    userId: "user1",
    username: "meme_lord",
    isPublic: true,
    memeCount: 12,
    createdAt: "2025-01-05",
  },
]

// Function to search memes
export function searchMemes(query: string, scope: "global" | "library", userId?: string): Meme[] {
  let results = mockMemes

  // Filter by scope
  if (scope === "library" && userId) {
    results = results.filter((m) => m.userId === userId)
  } else {
    results = results.filter((m) => m.isPublic)
  }

  // Filter by query
  if (query) {
    const lowerQuery = query.toLowerCase()
    results = results.filter(
      (m) =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.description.toLowerCase().includes(lowerQuery) ||
        m.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
    )
  }

  return results
}
