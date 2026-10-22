import { NextResponse, type NextRequest } from "next/server";

// Быстрая проверка наличия сессии. Полная проверка сессии и прав выполняется на сервере в каждой странице/действии.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login")) return NextResponse.next();
  // Серверные действия проверяют сессию сами и возвращают понятное сообщение; HTML-редирект на /login
  // в ответ на POST действия клиент React разобрать не может («unexpected response»), а форма теряет данные
  if (req.method === "POST" && req.headers.has("next-action")) return NextResponse.next();
  if (!req.cookies.get("cr_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
