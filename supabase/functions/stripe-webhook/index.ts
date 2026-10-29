// Velah Books · recebe os eventos do Stripe e entrega os livros (ou cria a prenda).
// Segredo necessário: STRIPE_WEBHOOK_SECRET. Eventos: checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, charge.refunded.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const enc = new TextEncoder();
async function verify(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = parts["t"]; const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((a, c, i) => a | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get("stripe-signature") || "", secret))) return new Response("bad signature", { status: 400 });

  const evt = JSON.parse(payload);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const obj = evt.data?.object || {};
  const orderId = obj.metadata?.order_id || obj.client_reference_id;

  if (evt.type === "checkout.session.completed" || evt.type === "checkout.session.async_payment_succeeded") {
    if (obj.payment_status !== "paid" || !orderId) return new Response("ok");
    const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!o || o.status === "paid") return new Response("ok"); // idempotente
    await admin.from("orders").update({ status: "paid", paid_at: new Date().toISOString(), amount_cents: obj.amount_total ?? o.amount_cents }).eq("id", o.id);
    if (o.is_gift) {
      await admin.from("gifts").insert({ order_id: o.id, book_ids: o.book_ids, from_name: o.gift?.from || "", to_name: o.gift?.to || "", message: o.gift?.message || "", created_by: o.user_id });
    } else if (o.user_id) {
      const source = o.book_ids.length > 1 ? "bundle" : "purchase";
      await admin.from("entitlements").upsert(o.book_ids.map((b: string) => ({ user_id: o.user_id, book_id: b, source, order_id: o.id })), { onConflict: "user_id,book_id", ignoreDuplicates: true });
    }
    if (o.marketing_ok && o.user_id) await admin.from("profiles").update({ marketing_ok: true }).eq("id", o.user_id);
  } else if (evt.type === "checkout.session.async_payment_failed" && orderId) {
    await admin.from("orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending");
  } else if (evt.type === "charge.refunded") {
    const id = obj.metadata?.order_id;
    if (id) {
      await admin.from("orders").update({ status: "refunded" }).eq("id", id);
      await admin.from("entitlements").delete().eq("order_id", id);
    }
  }
  return new Response("ok");
});
