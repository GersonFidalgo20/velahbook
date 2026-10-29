// Velah Books · cria uma sessão Stripe Checkout para um livro ou pack.
// Segredos necessários: STRIPE_SECRET_KEY. Opcional: STRIPE_AUTOMATIC_TAX=true (Stripe Tax ativo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const STRIPE = Deno.env.get("STRIPE_SECRET_KEY");
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) return json({ error: "login_required" }, 401);
  const user = u.user;

  let body: { item?: string; gift?: { to?: string; message?: string; from?: string } | null; marketing_ok?: boolean; return_url?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const item = String(body.item || "");
  if (!/^[a-z0-9]+$/.test(item)) return json({ error: "bad_item" }, 400);

  // preço vem sempre da base de dados, nunca do navegador
  let title = "", price = 0, bookIds: string[] = [], isBundle = false;
  const { data: bundle } = await admin.from("bundles").select("*").eq("slug", item).eq("active", true).maybeSingle();
  if (bundle) {
    isBundle = true; title = bundle.title; price = bundle.price_cents;
    const { data: bs } = await admin.from("books").select("id,status").in("slug", bundle.book_slugs);
    bookIds = (bs || []).map((b) => b.id);
  } else {
    const { data: b } = await admin.from("books").select("id,short,price_cents,status").eq("slug", item).maybeSingle();
    if (!b || !["ready", "presale"].includes(b.status)) return json({ error: "not_for_sale" }, 404);
    title = b.short; price = b.price_cents; bookIds = [b.id];
  }
  if (!bookIds.length || price <= 0) return json({ error: "not_for_sale" }, 404);

  const gift = body.gift ? {
    to: String(body.gift.to || "").slice(0, 40),
    message: String(body.gift.message || "").slice(0, 160),
    from: String(body.gift.from || "").slice(0, 40),
  } : null;

  const { data: order, error: oe } = await admin.from("orders").insert({
    user_id: user.id, item_slug: item, book_ids: bookIds, amount_cents: price,
    is_gift: !!gift, gift, marketing_ok: !!body.marketing_ok,
  }).select("id").single();
  if (oe) return json({ error: "order_failed" }, 500);

  if (!STRIPE) return json({ error: "payments_not_configured", order_id: order.id }, 503);

  const origin = (body.return_url || req.headers.get("origin") || "").replace(/#.*$/, "").replace(/\/$/, "");
  const f = new URLSearchParams();
  f.set("mode", "payment");
  f.set("client_reference_id", order.id);
  f.set("metadata[order_id]", order.id);
  f.set("payment_intent_data[metadata][order_id]", order.id);
  if (user.email) f.set("customer_email", user.email);
  f.set("locale", "pt");
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "eur");
  f.set("line_items[0][price_data][unit_amount]", String(price));
  f.set("line_items[0][price_data][product_data][name]", (gift ? "Prenda · " : "") + title + (isBundle ? "" : " (livro digital)"));
  if (Deno.env.get("STRIPE_AUTOMATIC_TAX") === "true") {
    f.set("automatic_tax[enabled]", "true");
    f.set("line_items[0][price_data][tax_behavior]", "inclusive");
    f.set("line_items[0][price_data][product_data][tax_code]", "txcd_10302000"); // e-books
    f.set("billing_address_collection", "required");
  }
  f.set("success_url", `${origin}/#obrigado-${order.id}`);
  f.set("cancel_url", `${origin}/#livro-${isBundle ? "loja" : item}`.replace("#livro-loja", "#loja"));

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: f,
  });
  const s = await r.json();
  if (!r.ok) { console.error("stripe", s?.error?.message); return json({ error: "stripe_error" }, 502); }
  await admin.from("orders").update({ stripe_session_id: s.id }).eq("id", order.id);
  return json({ url: s.url, order_id: order.id });
});
