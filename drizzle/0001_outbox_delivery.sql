ALTER TABLE `outbox` ADD `kind` text DEFAULT 'notice' NOT NULL;--> statement-breakpoint
ALTER TABLE `outbox` ADD `html` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `delivered_to` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `error` text;--> statement-breakpoint
ALTER TABLE `outbox` ADD `sent_at` integer;