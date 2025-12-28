import { User, getAuthToken, clearAuth } from "@/store/auth";

interface RequestOptions extends RequestInit {
    params?: Record<string, string | number | boolean>;
    json?: any;
    form?: FormData;
}

export class ApiError extends Error {
    status?: number;

    constructor(status: number, message?: string) {
        super(message || `Request failed with status ${status}`);
        this.status = status;
    }
}

export async function request(path: string, options: RequestOptions = {}): Promise<any> {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE || '';

    // Add auth token if available
    const token = getAuthToken();
    const headers: Record<string, any> = {
        ...options.headers,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };

    let url = `${baseUrl}${path}`;
    if (options.params) {
        const urlParams = new URLSearchParams();
        for (const [key, value] of Object.entries(options.params)) {
            urlParams.append(key, String(value));
        }
        url += `?${urlParams.toString()}`;
    }

    if (options.json) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.json);
    }

    if (options.form) {
        delete headers['Content-Type'];
        options.body = options.form;
    }

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        if (response.status === 401) clearAuth();
        const errorMessage = await response.text();
        throw new ApiError(response.status, errorMessage || `Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
        return null;
    }

    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.includes('application/json')) {
        return await response.json();
    }

    return await response.text();
}

export const fetcher = (url: string) => request(url);

/* Authentication APIs */
interface LoginRequest {
    email: string;
    password: string;
}

interface LoginResponse {
    token: string;
    user: User;
}

export function authLogin(data: LoginRequest): Promise<LoginResponse> {
    return request('/api/auth/login', {
        method: 'POST',
        json: data,
    });
}

interface RegisterRequest {
    username: string;
    password: string;
    email: string;
}

export function authRegister(data: RegisterRequest): Promise<LoginResponse> {
    return request('/api/auth/register', {
        method: 'POST',
        json: data,
    });
}

/* FileSystem APIs */
export interface Node {
    id: string;
    name: string;
    type: 'FOLDER' | 'FILE';
    visibility: 'PRIVATE' | 'PUBLIC';
    parent_id?: string;
    is_favorite: boolean;
    created_at: string;
    updated_at: string;
    meme?: Meme;
}

export interface GetNodeResponse {
    node?: Node;
    children: Node[];
    breadcrumbs: Node[];
}

export function nodeList(id: string = ''): Promise<GetNodeResponse> {
    return request(`/api/fs/nodes/${id}`);
}

export function nodeCreate(data: { name: string; type: 'FOLDER' | 'FILE'; parent_id: string }): Promise<Node> {
    return request('/api/fs/nodes', {
        method: 'POST',
        json: data,
    });
}

export function nodeBulkDelete(ids: string[]): Promise<void> {
    return request('/api/fs/nodes', {
        method: 'DELETE',
        json: { ids },
    });
}

export function nodeBulkUpdate(items: Partial<Node>[]): Promise<Node[]> {
    return request('/api/fs/nodes', {
        method: 'PATCH',
        json: { items },
    });
}

export function nodeBulkMove(ids: string[], destParentId: string): Promise<void> {
    return request('/api/fs/nodes/move', {
        method: 'POST',
        json: { ids, dest_parent_id: destParentId },
    });
}

export function nodeBulkCopy(ids: string[], destParentId: string): Promise<void> {
    return request('/api/fs/nodes/copy', {
        method: 'POST',
        json: { ids, dest_parent_id: destParentId },
    });
}

export function nodeUpload(
    file: File,
    parentId: string,
    onProgress?: (progress: number) => void
): Promise<Node> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `${process.env.NEXT_PUBLIC_API_BASE || ''}/api/fs/upload`;

        xhr.open('POST', url);

        // Add auth token
        const token = getAuthToken();
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        if (onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    onProgress(percentComplete);
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    resolve(response);
                } catch (e) {
                    resolve(xhr.responseText as any);
                }
            } else {
                if (xhr.status === 401) clearAuth();
                reject(new ApiError(xhr.status, xhr.responseText));
            }
        };

        xhr.onerror = () => {
            reject(new Error('Network error'));
        };

        const formData = new FormData();
        formData.append('file', file);
        formData.append('parent_id', parentId);
        xhr.send(formData);
    });
}

/* Meme APIs */
export interface Tag {
    id: string;
    name: string;
    type?: 'SYSTEM' | 'USER' | 'GLOBAL';
    created_at: string;
}

export interface Meme {
    asset_id: string;
    width: number;
    height: number;
    file_size: number;
    mime_type: string;
    extension: string;
    processing_status: 'pending' | 'processing' | 'success' | 'failed';
    in_library: boolean;
    is_favorite: boolean;
    tags: Tag[];
    url: string;
    created_at: string;
    analyzed_at: string | null;
}

export interface SearchRequest {
    q?: string;
    image?: File;
    scope?: 'global' | 'my';
    folder_id?: string;
    limit?: number;
}

export interface SearchResult {
    meme: Meme;
    recall_type: string;
    score: number;
    similarity: number;
}

export function memeSearch(params: SearchRequest): Promise<SearchResult[]> {
    const formData = new FormData();
    if (params.q) formData.append('q', params.q);
    if (params.image) formData.append('image', params.image);
    if (params.scope) formData.append('scope', params.scope);
    if (params.folder_id) formData.append('folder_id', params.folder_id);
    if (params.limit) formData.append('limit', String(params.limit));

    return request('/api/search', {
        method: 'POST', // Use POST for multipart search
        form: formData,
    });
}

export function memeGetSimilar(id: string, limit?: number): Promise<SearchResult[]> {
    return request(`/api/memes/${id}/similar`, {
        method: 'GET',
        params: limit ? { limit } : undefined,
    });
}

export function memeGet(id: string): Promise<Meme> {
    return request(`/api/memes/${id}`);
}

export function memeRetry(ids: string[]): Promise<void> {
    return request('/api/memes/retry', {
        method: 'POST',
        json: { ids },
    });
}

export function memeAdd(id: string): Promise<Node> {
    return request(`/api/memes/${id}/add`, {
        method: 'POST',
    });
}

/* Tag APIs */
export function tagListByMeme(id: string): Promise<Tag[]> {
    return request(`/api/memes/${id}/tags`);
}

export function tagAddToMeme(id: string, name: string): Promise<Tag> {
    return request(`/api/memes/${id}/tags`, {
        method: 'POST',
        json: { name },
    });
}

export function tagRemoveFromMeme(memeId: string, tagId: string): Promise<void> {
    return request(`/api/memes/${memeId}/tags/${tagId}`, {
        method: 'DELETE',
    });
}

export function tagSearch(query: string): Promise<Tag[]> {
    return request('/api/tags/search', {
        method: 'GET',
        params: { q: query },
    });
}

export interface GetTagMemesResponse {
    tag: Tag;
    memes: Meme[];
}

export function tagGetMemes(id: string): Promise<GetTagMemesResponse> {
    return request(`/api/tags/${id}`);
}

/* Favorite APIs */
export interface ListFavoritesResponse {
    memes: Meme[];
    folders: Node[];
}

export function favoriteList(): Promise<ListFavoritesResponse> {
    return request('/api/favorites');
}

export interface ToggleFavoriteItem {
    id: string;
    type: 'MEME' | 'FOLDER';
    favorite: boolean;
}

export function favoriteToggle(
    items: ToggleFavoriteItem[]
): Promise<void> {
    return request('/api/favorites', {
        method: 'POST',
        json: items,
    });
}

/* Explore APIs */
export interface ListExploreFoldersResponse {
    featured: Node[];
    popular: Node[];
    all: Node[];
}

export function exploreList(): Promise<ListExploreFoldersResponse> {
    return request('/api/explore');
}
