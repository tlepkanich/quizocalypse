-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'shopify',
ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'shopify';
