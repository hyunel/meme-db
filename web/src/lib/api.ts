import { User, getAuthToken, clearAuth } from "./auth";

interface RequestOptions extends RequestInit {
    params?: Record<string, string | number | boolean>;
    json?: any;
}

export async function request(path: string, options: RequestOptions = {}): Promise<any> {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE || '';

    // Add auth token if available
    const token = getAuthToken();
    const headers = {
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
        (headers as any)['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.json);
    }

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        if (response.status === 401) clearAuth();
        const errorText = await response.text();
        throw new Error(errorText || `Request failed with status ${response.status}`);
    }

    return await response.json();
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
