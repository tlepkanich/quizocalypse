import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { z } from "zod";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import {
  listCatalog,
  createManualProduct,
  deleteManualProduct,
  importCsv,
  isManualId,
} from "../lib/catalog.server";
import { QzPage, QzPageHeader, QzCard, QzField, QzInput, QzTextarea, QzBadge } from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const products = await listCatalog(shop.id);
  return json({
    products: products.map((p) => ({
      productId: p.productId,
      title: p.title,
      imageUrl: p.imageUrl,
      url: p.url,
      price: p.priceMin ? Number(p.priceMin) : null,
      tags: p.tags,
      manual: isManualId(p.productId),
    })),
  });
};

function zodMessage(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => `${i.path.join(".") || "field"}: ${i.message}`).join("; ");
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "add") {
    try {
      await createManualProduct(shop.id, {
        title: String(form.get("title") ?? ""),
        price: String(form.get("price") ?? ""),
        url: String(form.get("url") ?? ""),
        imageUrl: String(form.get("imageUrl") ?? ""),
        tags: String(form.get("tags") ?? "")
          .split(/[|,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        description: String(form.get("description") ?? ""),
      });
      return json({ ok: true, intent, message: "Product added." });
    } catch (err) {
      return json({ ok: false, intent, message: zodMessage(err) }, { status: 400 });
    }
  }

  if (intent === "delete") {
    await deleteManualProduct(shop.id, String(form.get("productId") ?? ""));
    return json({ ok: true, intent, message: "Product removed." });
  }

  if (intent === "import-csv") {
    const res = await importCsv(shop.id, String(form.get("csv") ?? ""));
    const errNote = res.errors.length
      ? ` ${res.errors.length} row(s) skipped: ${res.errors.slice(0, 3).map((e) => `row ${e.row} (${e.message})`).join("; ")}`
      : "";
    return json({ ok: true, intent, message: `Imported ${res.created} product(s).${errNote}` });
  }

  return json({ ok: false, intent, message: "Unknown action." }, { status: 400 });
};

export default function StudioProducts() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Catalog"
        title="Products"
        subtitle="Add products by hand or import a CSV — the catalog your quizzes recommend from."
      />

      {actionData?.message ? (
        <div
          className={`qz-banner ${actionData.ok ? "qz-banner-ok" : "qz-banner-crit"}`}
          style={{ marginBottom: 18 }}
          role="status"
        >
          <div className="qz-banner-body">{actionData.message}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <QzCard style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="qz-label">Add a product</div>
          <Form method="post" replace style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="intent" value="add" />
            <QzField label="Title">
              <QzInput name="title" required placeholder="Hydrating Serum" />
            </QzField>
            <div className="qz-row" style={{ gap: 12, alignItems: "flex-end" }}>
              <QzField label="Price"><QzInput name="price" type="number" min="0" step="0.01" placeholder="29.00" /></QzField>
              <QzField label="Tags (comma-separated)"><QzInput name="tags" placeholder="dry-skin, fragrance-free" /></QzField>
            </div>
            <QzField label="Product URL (Shop now link)"><QzInput name="url" type="url" placeholder="https://yourstore.com/products/serum" /></QzField>
            <QzField label="Image URL"><QzInput name="imageUrl" type="url" placeholder="https://…/serum.jpg" /></QzField>
            <QzField label="Description"><QzTextarea name="description" rows={2} placeholder="What it's for, who it's for…" /></QzField>
            <button type="submit" className="qz-btn qz-btn-primary" disabled={busy} style={{ alignSelf: "flex-start" }}>
              {busy ? "Saving…" : "Add product"}
            </button>
          </Form>
        </QzCard>

        <QzCard style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="qz-label">Import CSV</div>
          <p className="qz-muted" style={{ margin: 0, fontSize: 13 }}>
            Paste rows with a header. Columns: <code>title</code> (required), <code>url</code>,{" "}
            <code>price</code>, <code>image_url</code>, <code>tags</code> (| or , separated),{" "}
            <code>description</code>.
          </p>
          <Form method="post" replace style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="intent" value="import-csv" />
            <QzTextarea
              name="csv"
              rows={7}
              placeholder={"title,price,tags,url\nHydrating Serum,29,dry-skin|serum,https://store.com/serum"}
              style={{ fontFamily: "var(--qz-font-mono)", fontSize: 12.5 }}
            />
            <button type="submit" className="qz-btn qz-btn-accent" disabled={busy} style={{ alignSelf: "flex-start" }}>
              {busy ? "Importing…" : "Import CSV"}
            </button>
          </Form>
        </QzCard>
      </div>

      <section style={{ marginTop: 28 }}>
        <div className="qz-section-head">
          <h2 className="qz-h2">{products.length} product{products.length === 1 ? "" : "s"}</h2>
        </div>
        {products.length === 0 ? (
          <QzCard dashed style={{ textAlign: "center", padding: "44px 28px" }}>
            <p className="qz-muted" style={{ margin: 0 }}>No products yet — add one above or import a CSV.</p>
          </QzCard>
        ) : (
          <QzCard flush>
            <table className="qz-table">
              <thead>
                <tr><th>Product</th><th>Price</th><th>Tags</th><th></th></tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      <div className="qz-row" style={{ gap: 12 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 40, height: 40, flex: "0 0 auto", borderRadius: 8,
                            background: p.imageUrl ? `center/cover url("${p.imageUrl}")` : "var(--qz-cream-2)",
                            border: "1px solid var(--qz-rule)",
                          }}
                        />
                        <div>
                          <div className="qz-cell-name">{p.title}</div>
                          {p.url ? (
                            <a className="qz-cell-sub" href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--qz-accent)" }}>
                              {p.url.replace(/^https?:\/\//, "").slice(0, 40)}
                            </a>
                          ) : (
                            <div className="qz-cell-sub">{p.manual ? "no link" : "synced"}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>{p.price != null ? `$${p.price.toFixed(2)}` : "—"}</td>
                    <td>
                      <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
                        {p.tags.slice(0, 4).map((t) => <QzBadge key={t} tone="draft">{t}</QzBadge>)}
                        {p.tags.length > 4 ? <span className="qz-dim" style={{ fontSize: 12 }}>+{p.tags.length - 4}</span> : null}
                      </div>
                    </td>
                    <td className="qz-cell-actions">
                      {p.manual ? (
                        <Form method="post" replace style={{ display: "inline" }}>
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="productId" value={p.productId} />
                          <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm" disabled={busy} aria-label={`Delete ${p.title}`}>
                            Delete
                          </button>
                        </Form>
                      ) : (
                        <span className="qz-dim" style={{ fontSize: 12 }}>synced</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QzCard>
        )}
      </section>
    </QzPage>
  );
}
