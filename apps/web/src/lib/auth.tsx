"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { User, LoginInput, RegisterInput, AuthPayload, ApiResponse } from "@gitlive/shared";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Load token from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("gitlive_token");
    if (storedToken) {
      setToken(storedToken);
      fetchMe(storedToken);
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchMe = async (currentToken: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      const data: ApiResponse<User> = await res.json();
      
      if (res.ok && data.success && data.data) {
        setUser(data.data);
      } else {
        // Token is invalid/expired
        localStorage.removeItem("gitlive_token");
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (input: LoginInput) => {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    
    const data: ApiResponse<AuthPayload> = await res.json();
    
    if (!res.ok || !data.success || !data.data) {
      throw new Error(data.error || "Login failed");
    }

    localStorage.setItem("gitlive_token", data.data.token);
    setToken(data.data.token);
    setUser(data.data.user);
    router.push("/");
  };

  const register = async (input: RegisterInput) => {
    const res = await fetch(`${SERVER_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    
    const data: ApiResponse<AuthPayload> = await res.json();
    
    if (!res.ok || !data.success || !data.data) {
      throw new Error(data.error || "Registration failed");
    }

    localStorage.setItem("gitlive_token", data.data.token);
    setToken(data.data.token);
    setUser(data.data.user);
    router.push("/");
  };

  const loginAsGuest = async () => {
    const res = await fetch(`${SERVER_URL}/api/auth/guest`, {
      method: "POST",
    });
    
    const data: ApiResponse<AuthPayload> = await res.json();
    
    if (!res.ok || !data.success || !data.data) {
      throw new Error(data.error || "Guest login failed");
    }

    localStorage.setItem("gitlive_token", data.data.token);
    setToken(data.data.token);
    setUser(data.data.user);
    router.push("/");
  };

  const logout = () => {
    localStorage.removeItem("gitlive_token");
    setToken(null);
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, loginAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
