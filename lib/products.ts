import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, t } from "@/lib/db";

export type Product = typeof t.products.$inferSelect;

export function listProducts(): Product[] {
  return getDb().select().from(t.products).orderBy(asc(t.products.name)).all();
}

export function getProduct(sku: string): Product | undefined {
  return getDb().select().from(t.products).where(eq(t.products.sku, sku)).get();
}

export function catalogItems() {
  return listProducts().map(({ sku, name, description, brand, model, upc }) => ({ sku, name, description, brand, model, upc }));
}
