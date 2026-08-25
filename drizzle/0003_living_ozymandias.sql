CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`department_scope` text DEFAULT 'all' NOT NULL,
	`starts_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `announcements_active_idx` ON `announcements` (`status`,`starts_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `development_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`improvement_area` text NOT NULL,
	`actions` text NOT NULL,
	`due_date` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `development_employee_idx` ON `development_plans` (`employee_email`,`status`);--> statement-breakpoint
CREATE TABLE `external_receipt_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_email` text NOT NULL,
	`association_id` text,
	`period` text NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`receipt_count` integer DEFAULT 0 NOT NULL,
	`pdf_storage_key` text NOT NULL,
	`status` text DEFAULT 'pending_accounts' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `receipt_reports_requester_idx` ON `external_receipt_reports` (`requester_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `external_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`name` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `external_receipt_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meeting_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`employee_email` text NOT NULL,
	`attendance_status` text DEFAULT 'invited' NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meeting_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`title` text NOT NULL,
	`owner_email` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`agenda` text,
	`meeting_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`location` text,
	`organizer_email` text NOT NULL,
	`audience` text DEFAULT 'management' NOT NULL,
	`results_destination` text,
	`minutes` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meetings_date_idx` ON `meetings` (`meeting_date`,`status`);--> statement-breakpoint
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_email` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
