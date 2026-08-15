-- Skills Hub — initial schema
-- Module: db (P1). Contract: specs/SPEC-db.md
--
-- Conventions:
--   * All timestamps are ISO-8601 UTC text. SQLite has no date type; we
--     normalize on write so lexical sort == chronological sort.
--   * SQLite has no boolean; integer 0/1.
--   * Artifacts are never deleted. Deactivate with an explicit inactive_reason.
--   * Every index below is ORDERING-ALIGNED with a real query. Do not add an
--     index without the query, or a hot query without the index.

CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text,
	`description` text,
	`source_url` text NOT NULL,
	`repo_full_name` text,
	`repo_host` text,
	`homepage_url` text,
	`license` text,
	`author` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`install_target` text DEFAULT '[]' NOT NULL,
	`version` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`forks` integer DEFAULT 0 NOT NULL,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`quality_breakdown` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`source_updated_at` text,
	`enriched_at` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`inactive_reason` text,
	CHECK (`kind` IN ('skill','mcp','ruleset','subagent','command')),
	CHECK (`is_active` IN (0,1)),
	-- An inactive row must say why. Enforced, not merely documented.
	CHECK (`is_active` = 1 OR `inactive_reason` IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_source_url_unique` ON `artifacts` (`source_url`);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_slug_unique` ON `artifacts` (`slug`);
--> statement-breakpoint
-- Hot query: public list/browse by kind, best first.
CREATE INDEX `idx_artifacts_active_kind_score` ON `artifacts` (`is_active`, `kind`, `quality_score` DESC);
--> statement-breakpoint
-- Hot query: "recently added" feed.
CREATE INDEX `idx_artifacts_active_seen` ON `artifacts` (`is_active`, `last_seen_at` DESC);
--> statement-breakpoint
-- Curator work queue: least-recently-enriched first. NULLs sort first in
-- SQLite ASC, which is exactly right — never-enriched rows get priority.
CREATE INDEX `idx_artifacts_enrich_queue` ON `artifacts` (`is_active`, `enriched_at`);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_repo` ON `artifacts` (`repo_full_name`);
--> statement-breakpoint

CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adapter` text NOT NULL,
	`locator` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`cadence_hours` integer DEFAULT 6 NOT NULL,
	`last_run_at` text,
	`last_cursor` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`health` text DEFAULT 'unknown' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	CHECK (`enabled` IN (0,1)),
	CHECK (`health` IN ('healthy','degraded','failing','unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_adapter_locator_unique` ON `sources` (`adapter`, `locator`);
--> statement-breakpoint
-- Scout work queue: enabled sources due for a run.
CREATE INDEX `idx_sources_due` ON `sources` (`enabled`, `last_run_at`);
--> statement-breakpoint

CREATE TABLE `source_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`agent` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE SET NULL,
	CHECK (`status` IN ('ok','partial','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_runs_source_time` ON `source_runs` (`source_id`, `started_at` DESC);
--> statement-breakpoint
CREATE INDEX `idx_runs_agent_time` ON `source_runs` (`agent`, `started_at` DESC);
--> statement-breakpoint

CREATE TABLE `artifact_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` integer NOT NULL,
	`checked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`http_status` integer,
	`ok` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`reason` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE,
	CHECK (`ok` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_checks_artifact_time` ON `artifact_checks` (`artifact_id`, `checked_at` DESC);
--> statement-breakpoint
-- Sentinel work queue: oldest-checked active artifacts first.
CREATE INDEX `idx_checks_time` ON `artifact_checks` (`checked_at`);
--> statement-breakpoint

CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`kind` text,
	`description` text,
	`artifact_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);
--> statement-breakpoint

-- Cooperative lock. Pulse agents take this before writing so two overlapping
-- workflow runs cannot interleave. TTL makes a crashed holder self-healing:
-- a lock whose expires_at has passed is reclaimable by the next caller.
CREATE TABLE `run_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`holder` text
);
--> statement-breakpoint

CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` integer NOT NULL,
	`clicked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`referer_host` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_clicks_artifact` ON `clicks` (`artifact_id`, `clicked_at` DESC);
--> statement-breakpoint

-- Full-text search. External-content table: rows live in `artifacts`, the FTS
-- index stores only the tokens. Triggers keep them in sync — never maintain
-- this from application code.
CREATE VIRTUAL TABLE `artifacts_fts` USING fts5(
	`name`,
	`summary`,
	`description`,
	`tags`,
	content='artifacts',
	content_rowid='id',
	tokenize='porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `artifacts_fts_ai` AFTER INSERT ON `artifacts` BEGIN
	INSERT INTO `artifacts_fts` (`rowid`, `name`, `summary`, `description`, `tags`)
	VALUES (new.`id`, new.`name`, new.`summary`, new.`description`, new.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_fts_ad` AFTER DELETE ON `artifacts` BEGIN
	INSERT INTO `artifacts_fts` (`artifacts_fts`, `rowid`, `name`, `summary`, `description`, `tags`)
	VALUES ('delete', old.`id`, old.`name`, old.`summary`, old.`description`, old.`tags`);
END;
--> statement-breakpoint
CREATE TRIGGER `artifacts_fts_au` AFTER UPDATE ON `artifacts` BEGIN
	INSERT INTO `artifacts_fts` (`artifacts_fts`, `rowid`, `name`, `summary`, `description`, `tags`)
	VALUES ('delete', old.`id`, old.`name`, old.`summary`, old.`description`, old.`tags`);
	INSERT INTO `artifacts_fts` (`rowid`, `name`, `summary`, `description`, `tags`)
	VALUES (new.`id`, new.`name`, new.`summary`, new.`description`, new.`tags`);
END;
