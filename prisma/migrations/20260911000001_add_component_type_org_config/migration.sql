-- Stage 20 Batch 1: ComponentTypeOrgConfig
-- Splits field *shape* (fieldsSchema) from field *values* (fieldOptionsConfig).
-- SuperAdmin continues to own fieldsSchema (shape + dependsOn wiring);
-- this new table gives each org its own dropdown/radio option values.
-- Migration posture: BACKFILL (decision #1) — not a clean break.
-- See design-docs/04-data-model.md — ComponentTypeOrgConfig.

-- ── 1. Create the new table ───────────────────────────────────────────────────

CREATE TABLE "ComponentTypeOrgConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "componentTypeId" TEXT NOT NULL,
    "fieldOptionsConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentTypeOrgConfig_pkey" PRIMARY KEY ("id")
);

-- Unique constraint required for the 1:1 Prisma relation (one config per ComponentType).
CREATE UNIQUE INDEX "ComponentTypeOrgConfig_componentTypeId_key"
    ON "ComponentTypeOrgConfig"("componentTypeId");

-- Composite unique index for org-admin Catalog queries (org-scoped lookups).
CREATE UNIQUE INDEX "ComponentTypeOrgConfig_organizationId_componentTypeId_key"
    ON "ComponentTypeOrgConfig"("organizationId", "componentTypeId");

-- Foreign keys
ALTER TABLE "ComponentTypeOrgConfig"
    ADD CONSTRAINT "ComponentTypeOrgConfig_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ComponentTypeOrgConfig"
    ADD CONSTRAINT "ComponentTypeOrgConfig_componentTypeId_fkey"
    FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. Backfill: lift existing fieldsSchema.options per org into config rows ──
-- For each ComponentType that has any dropdown/radio field with an options array,
-- create a ComponentTypeOrgConfig row collecting { key: { options: [...] } }.
-- Then strip the options arrays from fieldsSchema entries.
--
-- This backfill runs once; subsequent new-org creation goes through
-- lib/component-catalog-seed.ts + createOrganizationWithDefaults, which writes
-- the config row at org-creation time (no options in fieldsSchema from now on).

DO $$
DECLARE
  ct RECORD;
  field_entry JSONB;
  field_options_config JSONB;
  field_key TEXT;
  field_opts JSONB;
  new_fields_schema JSONB;
  stripped_entry JSONB;
BEGIN
  FOR ct IN
    SELECT id, "organizationId", "fieldsSchema"
    FROM "ComponentType"
    WHERE "fieldsSchema" IS NOT NULL
      AND jsonb_typeof("fieldsSchema"::jsonb) = 'array'
  LOOP
    field_options_config := '{}'::jsonb;

    -- Build fieldOptionsConfig from any options arrays present in fieldsSchema.
    FOR field_entry IN
      SELECT value FROM jsonb_array_elements(ct."fieldsSchema"::jsonb)
    LOOP
      IF (field_entry ? 'options')
         AND jsonb_typeof(field_entry -> 'options') = 'array'
         AND jsonb_array_length(field_entry -> 'options') > 0
      THEN
        field_key := field_entry ->> 'key';
        field_opts := field_entry -> 'options';
        field_options_config := field_options_config
          || jsonb_build_object(
               field_key,
               jsonb_build_object('options', field_opts)
             );
      END IF;
    END LOOP;

    -- Insert a config row only when there is at least one lifted option list.
    IF field_options_config != '{}'::jsonb THEN
      INSERT INTO "ComponentTypeOrgConfig"
        ("id", "organizationId", "componentTypeId", "fieldOptionsConfig", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid()::text, ct."organizationId", ct.id, field_options_config,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("componentTypeId") DO NOTHING;
    END IF;

    -- Strip the options key from every fieldsSchema entry.
    new_fields_schema := '[]'::jsonb;
    FOR field_entry IN
      SELECT value FROM jsonb_array_elements(ct."fieldsSchema"::jsonb)
    LOOP
      stripped_entry := field_entry - 'options';
      new_fields_schema := new_fields_schema || jsonb_build_array(stripped_entry);
    END LOOP;

    UPDATE "ComponentType"
    SET "fieldsSchema" = new_fields_schema
    WHERE id = ct.id;

  END LOOP;
END $$;
