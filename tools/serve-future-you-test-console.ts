const root = new URL("./future-you-test-console/", import.meta.url);

Deno.serve({ port: 8787 }, async (request) => {
  const path = new URL(request.url).pathname === "/"
    ? "index.html"
    : new URL(request.url).pathname.slice(1);
  if (!/^[a-zA-Z0-9._-]+$/.test(path)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const file = await Deno.readFile(new URL(path, root));
    const contentType = path.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
    return new Response(file, {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});
