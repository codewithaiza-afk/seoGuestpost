CREATE TABLE `gmail_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`connected_email` text NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_connections_email_unique` ON `gmail_connections` (`connected_email`);
--> statement-breakpoint
CREATE TABLE `gmail_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`return_path` text DEFAULT '/campaigns' NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gmail_oauth_states_expiry_idx` ON `gmail_oauth_states` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `inbound_email_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`prospect_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`classification` text NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_email_replies_message_unique` ON `inbound_email_replies` (`gmail_message_id`);
--> statement-breakpoint
CREATE INDEX `inbound_email_replies_prospect_date_idx` ON `inbound_email_replies` (`prospect_id`,`received_at`);
