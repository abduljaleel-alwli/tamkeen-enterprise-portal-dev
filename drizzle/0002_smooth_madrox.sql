CREATE TABLE `associations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`branch` text DEFAULT 'المقر الرئيسي' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `associations_name_unique` ON `associations` (`name`);--> statement-breakpoint
CREATE TABLE `sales_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`association_id` text NOT NULL,
	`year` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_case_files` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`uploader_email` text NOT NULL,
	`name` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`requester_email` text NOT NULL,
	`association_id` text,
	`request_type` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`amount` real,
	`period` text,
	`current_stage` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decision_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_revenue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`association_id` text,
	`entry_date` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`donor_count` integer DEFAULT 0 NOT NULL,
	`receipt_ref` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`association_id` text,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`target_amount` real DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
