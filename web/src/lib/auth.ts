import { authLogin, authRegister } from "./api"
import { mutate } from "swr"

const TOKEN_KEY = "auth_token"
export interface User {
  id: string
  email: string
  username: string
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function hasAuthToken(): boolean {
  return !!getAuthToken()
}

function saveAuth(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function handleAuthResponse(response: { token: string; user: User }): Promise<User> {
  saveAuth(response.token)
  await mutate("/api/auth/me", response.user)
  return response.user
}

export async function login(email: string, password: string): Promise<User> {
  const response = await authLogin({ email, password })
  return handleAuthResponse(response)
}

export async function register(email: string, username: string, password: string): Promise<User> {
  const response = await authRegister({ email, username, password })
  return handleAuthResponse(response)
}

export function logout(): void {
  clearAuth()
}
