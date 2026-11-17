import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/setup-required"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = publicPaths.some((path) => pathname === path || pathname.startsWith(path + "/"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname === "/setup-required" || pathname.startsWith("/_next/")) return NextResponse.next();
    if (isPublicPath) return NextResponse.next();
    return NextResponse.redirect(new URL("/setup-required", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if ((error || !user) && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
