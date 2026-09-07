-- CreateEnum
CREATE TYPE "age_group" AS ENUM ('young', 'adult');

-- CreateTable
CREATE TABLE "color_class" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    -- COLLATE "C" (manual): guarantees ascending code sorting is byte/Unicode-code-point
    -- stable and identical across requests, independent of the database locale (Req 1.5).
    -- Prisma has no PSL collation attribute for PostgreSQL VarChar, so this is added by hand.
    "code" VARCHAR(50) COLLATE "C" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "color_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_color" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" UUID NOT NULL,
    "age_group" "age_group" NOT NULL,
    -- COLLATE "C" (manual): see color_class.code above. class_id (UUID) is compared as
    -- text under C and age_group orders by native enum declaration order (young before adult) (Req 2.6).
    "code" VARCHAR(50) COLLATE "C" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "official_color_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "official_color_class_id_idx" ON "official_color"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "official_color_class_id_code_age_group_key" ON "official_color"("class_id", "code", "age_group");

-- AddForeignKey
ALTER TABLE "official_color" ADD CONSTRAINT "official_color_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "color_class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
