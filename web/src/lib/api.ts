import { User, getAuthToken, clearAuth } from "./auth";

interface RequestOptions extends RequestInit {
    params?: Record<string, string | number | boolean>;
    json?: any;
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

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        if (response.status === 401) clearAuth();
        throw new ApiError(response.status, await response.text());
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
    visibility: 'PRIVATE' | 'PUBLIC' | 'LINK';
    parent_id?: string;
    asset_id?: string;
    url?: string;
    username?: string;
    tags?: string[];
    is_favorite: boolean;
    created_at: string;
    updated_at: string;
}

export interface GetNodeResponse {
    node?: Node;
    children: Node[];
    breadcrumbs: Node[];
}

export function fetchNodes(id: string = ''): Promise<GetNodeResponse> {
    return request(`/api/fs/nodes/${id}`);
}

export function createNode(data: { name: string; type: 'FOLDER' | 'FILE'; parent_id: string }): Promise<Node> {
    return request('/api/fs/nodes', {
        method: 'POST',
        json: data,
    });
}

export function updateNode(id: string, data: Partial<Node>): Promise<Node> {
    return request(`/api/fs/nodes/${id}`, {
        method: 'PATCH',
        json: data,
    });
}

export function bulkDeleteNodes(ids: string[]): Promise<void> {
    return request('/api/fs/nodes', {
        method: 'DELETE',
        json: { ids },
    });
}

export function bulkMoveNodes(ids: string[], destParentId: string): Promise<void> {
    return request('/api/fs/nodes/move', {
        method: 'POST',
        json: { ids, dest_parent_id: destParentId },
    });
}

export function uploadMeme(
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
    created_at: string;
}

export interface Meme {
    asset_id: string;
    title: string; // added for UI display
    width: number;
    height: number;
    tags: Tag[];
    url: string | null;
    is_favorite: boolean; // added for UI heart icon
    analyzed_at: string | null;
}

export interface SearchRequest {
    q: string;
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

export function searchMemes(params: SearchRequest): Promise<SearchResult[]> {
    return request('/api/search', {
        method: 'GET',
        params: params as any,
    });
}
