import { auth } from "@/auth";
import { SignJWT } from "jose";

const API_URL = process.env.API_URL ?? "http://localhost:8000";
const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);

export async function apiFetch(path: string, init?: RequestInit) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const token = await new SignJWT({ sub: session.user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1m")
    .sign(secret);

  const isFormData = init?.body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}
