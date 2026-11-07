CREATE TABLE `browser_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prospect_id` text NOT NULL,
	`storage_state_encrypted` text NOT NULL,
	`last_url` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_sessions_prospect_unique` ON `browser_sessions` (`prospect_id`);
--> statement-breakpoint
CREATE INDEX `browser_sessions_user_idx` ON `browser_sessions` (`user_id`);
