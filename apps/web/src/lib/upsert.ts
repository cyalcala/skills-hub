// Single-artifact upsert — keyed on source_url.
//
// Owned by the `ingest` module (specs/SPEC-ingest.md). All SQL lives in
// `db.ts`; this module exists so the module's project structure (a distinct
// `upsert.ts`) matches the spec while keeping a single implementation.

export { upsertArtifact, slugifyName, type ArtifactRow } from "./db";