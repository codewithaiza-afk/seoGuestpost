CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`target_url` text NOT NULL,
	`target_anchor` text NOT NULL,
	`niche` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_user_created_idx` ON `campaigns` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outreach_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`prospect_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resend_email_id` text,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outreach_logs_prospect_sent_idx` ON `outreach_logs` (`prospect_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `password_resets_user_id_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE TABLE `prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`domain` text NOT NULL,
	`contact_email` text,
	`da_dr_score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Discovered' NOT NULL,
	`live_backlink_url` text,
	`submission_url` text,
	`submission_approved` integer DEFAULT false NOT NULL,
	`submission_completed_at` text,
	`login_url` text,
	`signup_url` text,
	`submission_details` text DEFAULT '[]' NOT NULL,
	`workflow_status` text DEFAULT 'Discovered' NOT NULL,
	`is_dofollow` integer DEFAULT false NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "prospects_status_check" CHECK("prospects"."status" in ('Discovered', 'Pitched', 'Replied', 'Live', 'Rejected')),
	CONSTRAINT "prospects_workflow_status_check" CHECK("prospects"."workflow_status" in (
        'Discovered', 'Awaiting Approval', 'Approved', 'Login Required',
        'Signup Required', 'Authenticated', 'Submission Form Detected',
        'Article Prepared', 'Awaiting Final Approval', 'Submitted',
        'Pending Editorial Review', 'Published', 'Submission Verified',
        'Email Outreach', 'Rejected', 'Failed', 'Manual Action Required'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prospects_campaign_domain_unique` ON `prospects` (`campaign_id`,`domain`);--> statement-breakpoint
CREATE INDEX `prospects_campaign_created_idx` ON `prospects` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `prospects_status_idx` ON `prospects` (`status`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_sessions_user_id_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`full_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);