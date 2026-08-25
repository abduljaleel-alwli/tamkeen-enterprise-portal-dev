CREATE TABLE `portal_access` (
	`email` text PRIMARY KEY NOT NULL,
	`code_digest` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`email`) REFERENCES `employees`(`email`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_sessions_token_hash_unique` ON `portal_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `portal_sessions_email_idx` ON `portal_sessions` (`email`);--> statement-breakpoint
CREATE INDEX `portal_sessions_expires_at_idx` ON `portal_sessions` (`expires_at`);